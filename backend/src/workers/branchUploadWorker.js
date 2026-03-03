const xlsx = require('xlsx');
const { query, transaction } = require('../config/database');
const { encodePocketId } = require('../utils/geometry');
const logger = require('../config/logger');
const { branchUploadQueue } = require('../config/queue');

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

/**
 * Process branch upload job
 * @param {Object} job - Bull job object
 * @param {Buffer} job.data.fileBuffer - Excel file buffer
 * @param {string} job.data.fileName - Original file name
 */
async function processBranchUpload(job) {
  const { fileBuffer, fileName } = job.data;

  logger.info('Starting branch upload processing', {
    jobId: job.id,
    fileName,
  });

  try {
    const normalizedBuffer = ensureBuffer(fileBuffer);

    // Parse Excel file
    const workbook = xlsx.read(normalizedBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet, { defval: '' });

    if (data.length === 0) {
      throw new Error('Excel file is empty');
    }

    // Update progress: parsing complete
    await job.progress(10);

    // Get current configuration
    const configResult = await query('SELECT * FROM config WHERE id = 1');
    const config = {
      originLat: configResult.rows[0].origin_lat,
      originLon: configResult.rows[0].origin_lon,
      alphabet: configResult.rows[0].alphabet,
    };

    // Validate and process branches
    const branches = [];
    const errors = [];
    const totalRows = data.length;

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowNum = i + 2; // Excel row number (1-indexed + header)

      // Map column names (case-insensitive)
      const id = getFieldValue(row, ['ID', 'Branch ID', 'BranchID']);
      const city = getFieldValue(row, ['City']) || '';
      const lat = parseFloat(getFieldValue(row, ['Latitude', 'Lat']));
      const lon = parseFloat(getFieldValue(row, ['Longitude', 'Lon', 'Lng', 'Long']));

      // Validate
      if (!id) {
        errors.push({ row: rowNum, error: 'Missing Branch ID' });
        continue;
      }
      if (isNaN(lat) || lat < -90 || lat > 90) {
        errors.push({ row: rowNum, error: 'Invalid latitude' });
        continue;
      }
      if (isNaN(lon) || lon < -180 || lon > 180) {
        errors.push({ row: rowNum, error: 'Invalid longitude' });
        continue;
      }

      // Calculate Pocket ID
      const { pocketId } = encodePocketId(lat, lon, config);

      branches.push({ id, city, lat, lon, pocketId });

      // Update progress every 10 rows
      if (i % 10 === 0) {
        const progress = 10 + Math.floor((i / totalRows) * 70); // 10-80%
        await job.progress(progress);
      }
    }

    if (errors.length > 0 && branches.length === 0) {
      throw new Error(`All rows have errors: ${JSON.stringify(errors)}`);
    }

    // Update progress: validation complete
    await job.progress(80);

    // Insert branches in transaction
    const result = await transaction(async (client) => {
      const inserted = [];
      const skipped = [];
      const totalBranches = branches.length;

      for (let i = 0; i < branches.length; i++) {
        const branch = branches[i];
        try {
          const res = await client.query(
            `INSERT INTO branches (id, city, lat, lon, pocket_id)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO UPDATE
             SET city = $2, lat = $3, lon = $4, pocket_id = $5
             RETURNING id`,
            [branch.id, branch.city, branch.lat, branch.lon, branch.pocketId]
          );
          inserted.push(res.rows[0].id);
        } catch (err) {
          skipped.push({ id: branch.id, error: err.message });
        }

        // Update progress every 10 inserts
        if (i % 10 === 0) {
          const progress = 80 + Math.floor((i / totalBranches) * 20); // 80-100%
          await job.progress(progress);
        }
      }

      return { inserted, skipped };
    });

    // Final progress
    await job.progress(100);

    const summary = {
      total: data.length,
      inserted: result.inserted.length,
      skipped: result.skipped.length,
      errors: errors.length,
    };

    logger.info('Branch upload completed', {
      jobId: job.id,
      fileName,
      summary,
    });

    return {
      success: true,
      summary,
      errors: errors.length > 0 ? errors : undefined,
      skipped: result.skipped.length > 0 ? result.skipped : undefined,
    };
  } catch (error) {
    logger.error('Branch upload failed', {
      jobId: job.id,
      fileName,
      error: error.message,
    });
    throw error;
  }
}

// Register the worker
branchUploadQueue.process(5, processBranchUpload); // Process up to 5 jobs concurrently

logger.info('Branch upload worker started');

module.exports = {
  processBranchUpload,
};
