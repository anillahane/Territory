const xlsx = require('xlsx');
const { query, transaction } = require('../config/database');
const { encodePocketId } = require('../utils/geometry');
const logger = require('../config/logger');
const { branchUploadQueue } = require('../config/queue');
const jobStatusService = require('../services/JobStatusService');

function ensureBuffer(input) {
  if (Buffer.isBuffer(input)) {
    return input;
  }

  if (input && input.type === 'Buffer' && Array.isArray(input.data)) {
    return Buffer.from(input.data);
  }

  if (ArrayBuffer.isView(input)) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }

  if (input instanceof ArrayBuffer) {
    return Buffer.from(input);
  }

  throw new Error('Invalid uploaded file payload');
}

function normalizeHeaderKey(key) {
  return String(key || '')
    .replace(/\u00a0/g, ' ')
    .trim()
    .toLowerCase();
}

function getFieldValue(row, aliases) {
  const normalizedAliasSet = new Set(aliases.map((alias) => normalizeHeaderKey(alias)));
  for (const [key, value] of Object.entries(row)) {
    if (normalizedAliasSet.has(normalizeHeaderKey(key))) {
      return value;
    }
  }
  return undefined;
}

function toNumber(value) {
  if (typeof value === 'number') {
    return value;
  }

  if (value === null || value === undefined) {
    return Number.NaN;
  }

  const normalized = String(value).replace(/,/g, '').trim();
  if (!normalized) {
    return Number.NaN;
  }

  return Number.parseFloat(normalized);
}

function getScopedBranchIds(branches) {
  return Array.from(
    new Set(
      (Array.isArray(branches) ? branches : [])
        .map((branch) => String(branch?.id || '').trim())
        .filter(Boolean)
    )
  );
}

function resolveBranchOverwriteScope(uploadMode, confirmWipeAll, branches) {
  if (uploadMode !== 'overwrite') {
    return { deleteMode: 'none', branchIds: [] };
  }

  if (confirmWipeAll) {
    return { deleteMode: 'global', branchIds: [] };
  }

  const branchIds = getScopedBranchIds(branches);
  if (branchIds.length === 0) {
    throw new Error(
      'overwrite mode requires at least one branch ID in the upload, or confirmWipeAll=true for a global wipe'
    );
  }

  return { deleteMode: 'scoped', branchIds };
}

/**
 * Process branch upload job
 * @param {Object} job - Bull job object
 * @param {Buffer} job.data.fileBuffer - Excel file buffer
 * @param {string} job.data.fileName - Original file name
 */
async function processBranchUpload(job) {
  const {
    fileBuffer,
    fileName,
    uploadMode: requestedUploadMode,
    confirmWipeAll = false,
  } = job.data;
  const uploadMode = requestedUploadMode === 'add' ? 'add' : 'overwrite';

  logger.info('Starting branch upload processing', {
    jobId: job.id,
    fileName,
    uploadMode,
  });

  try {
    const normalizedBuffer = ensureBuffer(fileBuffer);

    // Parse Excel file (all sheets)
    const workbook = xlsx.read(normalizedBuffer, { type: 'buffer' });
    const rowsWithSheet = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const sheetRows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
      for (let i = 0; i < sheetRows.length; i++) {
        rowsWithSheet.push({
          sheetName,
          rowNum: i + 2, // Header is row 1
          row: sheetRows[i],
        });
      }
    }

    if (rowsWithSheet.length === 0) {
      throw new Error('Excel file is empty');
    }

    await jobStatusService.markJobActive(job.id, {
      total: rowsWithSheet.length,
      data: {
        fileName,
        uploadMode,
        confirmWipeAll,
      },
    });

    // Update progress: parsing complete
    await job.progress(10);
    await jobStatusService.updateJobProgress(job.id, { progress: 10, total: rowsWithSheet.length });

    // Get current configuration
    const configResult = await query('SELECT * FROM config WHERE id = 1');
    const config = {
      originLat: configResult.rows[0].origin_lat,
      originLon: configResult.rows[0].origin_lon,
      alphabet: configResult.rows[0].alphabet,
    };

    // Validate and process branches
    const branchesById = new Map();
    const errors = [];
    const totalRows = rowsWithSheet.length;

    for (let i = 0; i < rowsWithSheet.length; i++) {
      const { sheetName, rowNum, row } = rowsWithSheet[i];
      const rowRef = `${sheetName}!${rowNum}`;

      // Map column names (case-insensitive)
      const id = getFieldValue(row, ['ID', 'Branch ID', 'BranchID']);
      const city = getFieldValue(row, ['City']) || '';
      const lat = toNumber(getFieldValue(row, ['Latitude', 'Lat']));
      const lon = toNumber(getFieldValue(row, ['Longitude', 'Lon', 'Lng', 'Long']));
      const normalizedId = String(id || '').trim();

      // Validate
      if (!normalizedId) {
        errors.push({ row: rowRef, error: 'Missing Branch ID' });
        continue;
      }
      if (isNaN(lat) || lat < -90 || lat > 90) {
        errors.push({ row: rowRef, error: 'Invalid latitude' });
        continue;
      }
      if (isNaN(lon) || lon < -180 || lon > 180) {
        errors.push({ row: rowRef, error: 'Invalid longitude' });
        continue;
      }

      // Calculate Pocket ID
      const { pocketId } = encodePocketId(lat, lon, config);

      // Last occurrence wins for duplicate IDs in file
      branchesById.set(normalizedId, { id: normalizedId, city, lat, lon, pocketId });

      // Update progress every 10 rows
      if (i % 10 === 0) {
        const progress = 10 + Math.floor((i / totalRows) * 70); // 10-80%
        await job.progress(progress);
        await jobStatusService.updateJobProgress(job.id, { progress, total: totalRows });
      }
    }

    const branches = Array.from(branchesById.values());
    const duplicateRows = totalRows - errors.length - branches.length;

    if (errors.length > 0 && branches.length === 0) {
      throw new Error(`All rows have errors: ${JSON.stringify(errors)}`);
    }

    // Update progress: validation complete
    await job.progress(80);
    await jobStatusService.updateJobProgress(job.id, { progress: 80, total: totalRows });

    const overwriteScope = resolveBranchOverwriteScope(uploadMode, confirmWipeAll, branches);

    // Apply insert mode in one transaction.
    const result = await transaction(async (client) => {
      const inserted = [];
      let existingBranchCount = 0;
      let clearedMappings = 0;
      let skippedExisting = 0;

      if (uploadMode === 'overwrite') {
        const existingBranchCountQuery =
          overwriteScope.deleteMode === 'global'
            ? 'SELECT COUNT(*)::int AS count FROM branches'
            : 'SELECT COUNT(*)::int AS count FROM branches WHERE id = ANY($1::text[])';
        const existingBranchCountParams =
          overwriteScope.deleteMode === 'global' ? [] : [overwriteScope.branchIds];
        const existingBranchCountResult = await client.query(
          existingBranchCountQuery,
          existingBranchCountParams
        );
        existingBranchCount = existingBranchCountResult.rows[0].count;

        try {
          const deleteMappingsResult =
            overwriteScope.deleteMode === 'global'
              ? await client.query('DELETE FROM customer_pocket_mappings')
              : await client.query(
                  `
                    DELETE FROM customer_pocket_mappings
                    WHERE COALESCE(existing_branch_id, nearest_branch_id) = ANY($1::text[])
                  `,
                  [overwriteScope.branchIds]
                );
          clearedMappings = deleteMappingsResult.rowCount || 0;
        } catch (err) {
          // Some environments may not have this table migrated yet.
          if (err.code !== '42P01') {
            throw err;
          }
        }

        if (overwriteScope.deleteMode === 'global') {
          await client.query('DELETE FROM branches');
        } else {
          await client.query('DELETE FROM branches WHERE id = ANY($1::text[])', [
            overwriteScope.branchIds,
          ]);
        }
      }

      const totalBranches = branches.length;

      for (let i = 0; i < branches.length; i++) {
        const branch = branches[i];
        if (uploadMode === 'overwrite') {
          const res = await client.query(
            `INSERT INTO branches (id, city, lat, lon, pocket_id)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [branch.id, branch.city, branch.lat, branch.lon, branch.pocketId]
          );
          inserted.push(res.rows[0].id);
        } else {
          const res = await client.query(
            `INSERT INTO branches (id, city, lat, lon, pocket_id)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO NOTHING
             RETURNING id`,
            [branch.id, branch.city, branch.lat, branch.lon, branch.pocketId]
          );

          if (res.rows.length > 0) {
            inserted.push(res.rows[0].id);
          } else {
            skippedExisting += 1;
          }
        }

        // Update progress every 10 inserts
        if (i % 10 === 0) {
          const progress = 80 + Math.floor((i / totalBranches) * 20); // 80-100%
          await job.progress(progress);
          await jobStatusService.updateJobProgress(job.id, { progress, total: totalRows });
        }
      }

      return {
        inserted,
        replaced: existingBranchCount,
        clearedMappings,
        skippedExisting,
      };
    });

    const summary = {
      mode: uploadMode,
      total: totalRows,
      inserted: result.inserted.length,
      replaced: result.replaced,
      clearedMappings: result.clearedMappings,
      skippedExisting: result.skippedExisting,
      overwriteScope: overwriteScope.deleteMode,
      duplicatesInFile: duplicateRows,
      errors: errors.length,
    };

    // Final progress
    await job.progress(100);
    await jobStatusService.markJobCompleted(job.id, {
      total: totalRows,
      data: {
        fileName,
        uploadMode,
        confirmWipeAll,
        result: {
          success: true,
          summary,
          errors: errors.length > 0 ? errors : undefined,
        },
      },
    });

    logger.info('Branch upload completed', {
      jobId: job.id,
      fileName,
      summary,
    });

    return {
      success: true,
      summary,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    logger.error('Branch upload failed', {
      jobId: job.id,
      fileName,
      error: error.message,
    });
    await jobStatusService.markJobFailed(job.id, error.message, {
      data: {
        fileName,
        uploadMode,
        confirmWipeAll,
      },
    });
    throw error;
  }
}

// Register the worker
branchUploadQueue.process(5, processBranchUpload); // Process up to 5 jobs concurrently

logger.info('Branch upload worker started');

module.exports = {
  processBranchUpload,
  getScopedBranchIds,
  resolveBranchOverwriteScope,
};
