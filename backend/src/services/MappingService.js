/**
 * Mapping Service
 * Handles persistence and retrieval of customer-to-pocket mappings
 */

const { query, transaction } = require('../config/database');
const logger = require('../config/logger');

const BATCH_SIZE = 1000;
const VALUES_PER_ROW = 12;
const UPSERT_COLUMNS = Object.freeze([
  'job_id',
  'customer_id',
  'customer_lat',
  'customer_lon',
  'pocket_id',
  'distance_customer_to_pocket',
  'nearest_branch_id',
  'distance_pocket_to_branch',
  'distance_customer_to_branch',
  'uploaded_branch_code',
  'existing_branch_id',
  'distance_customer_to_existing_branch',
]);
const UPSERT_UPDATE_COLUMNS = Object.freeze(
  UPSERT_COLUMNS.filter((column) => column !== 'customer_id')
);

const buildSavepointName = (batchNumber) => `mapping_batch_${batchNumber}`;

const dedupeBatchByCustomerId = (batch) => {
  const deduped = new Map();

  batch.forEach((mapping) => {
    deduped.set(String(mapping.customerId), mapping);
  });

  return Array.from(deduped.values());
};

class MappingService {
  /**
   * Save customer-to-pocket mappings in bulk
   * @param {string} jobId - The batch job UUID
   * @param {Array<Object>} mappings - Array of mapping objects
   * @param {string} mappings[].customerId - Customer identifier
   * @param {number} mappings[].customerLat - Customer latitude
   * @param {number} mappings[].customerLon - Customer longitude
   * @param {string} mappings[].pocketId - Pocket identifier
   * @param {number} mappings[].distanceCustomerToPocket - Distance from customer to pocket center (meters)
   * @param {string} mappings[].nearestBranchId - Nearest branch identifier
   * @param {number} mappings[].distancePocketToBranch - Distance from pocket to branch (meters)
   * @param {number} mappings[].distanceCustomerToBranch - Distance from customer to branch (meters)
   * @param {string|null} [mappings[].uploadedBranchCode] - Raw branch_code from uploaded file
   * @param {string|null} [mappings[].existingBranchId] - Existing mapped branch resolved from branch_code
   * @param {number|null} [mappings[].distanceCustomerToExistingBranch] - Distance from customer to existing branch (meters)
   * @returns {Promise<{success: boolean, insertedCount: number, errors: Array<string>}>}
   */
  async saveMappings(jobId, mappings) {
    if (!jobId || !mappings || !Array.isArray(mappings)) {
      throw new Error('Invalid parameters: jobId and mappings array are required');
    }

    if (mappings.length === 0) {
      return { success: true, insertedCount: 0, errors: [] };
    }

    let totalInserted = 0;
    const errors = [];
    const totalBatches = Math.ceil(mappings.length / BATCH_SIZE);

    logger.info('Starting bulk mapping insert', {
      jobId,
      totalMappings: mappings.length,
      batchSize: BATCH_SIZE,
    });

    await transaction(async (client) => {
      for (let i = 0; i < mappings.length; i += BATCH_SIZE) {
        const rawBatch = mappings.slice(i, i + BATCH_SIZE);
        const batch = dedupeBatchByCustomerId(rawBatch);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const savepointName = buildSavepointName(batchNumber);

        await client.query(`SAVEPOINT ${savepointName}`);

        try {
          const insertedCount = await this._insertBatch(client, jobId, batch);
          totalInserted += insertedCount;
          await client.query(`RELEASE SAVEPOINT ${savepointName}`);

          logger.debug('Batch insert successful', {
            jobId,
            batchNumber,
            totalBatches,
            batchSize: rawBatch.length,
            upsertedCount: insertedCount,
            dedupedCount: batch.length,
          });
        } catch (error) {
          await client.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
          await client.query(`RELEASE SAVEPOINT ${savepointName}`);

          const errorMsg = `Batch ${batchNumber}/${totalBatches} failed: ${error.message}`;
          logger.error('Batch insert failed', {
            jobId,
            batchNumber,
            totalBatches,
            batchSize: rawBatch.length,
            dedupedCount: batch.length,
            error: error.message,
            stack: error.stack,
          });
          errors.push(errorMsg);
        }
      }
    });

    const success = errors.length === 0;
    
    logger.info('Bulk mapping insert completed', {
      jobId,
      totalMappings: mappings.length,
      totalInserted,
      success,
      errorCount: errors.length,
    });

    return {
      success,
      insertedCount: totalInserted,
      errors,
    };
  }

  /**
   * Retrieve customer-to-pocket mappings with filtering and pagination
   * @param {Object} filters - Filter options
   * @param {string} [filters.jobId] - Filter by batch job UUID
   * @param {string} [filters.customerId] - Filter by customer ID (partial match)
   * @param {string} [filters.pocketId] - Filter by pocket ID
   * @param {Object} pagination - Pagination options
   * @param {number} [pagination.page=1] - Page number (1-indexed)
   * @param {number} [pagination.pageSize=100] - Number of records per page
   * @returns {Promise<{data: Array<Object>, pagination: Object}>}
   */
  async getMappings(filters = {}, pagination = {}) {
    const page = Math.max(1, pagination.page || 1);
    const pageSize = Math.max(1, Math.min(1000, pagination.pageSize || 100));
    const offset = (page - 1) * pageSize;

    // Build WHERE clause
    const whereClauses = [];
    const queryParams = [];
    let paramIndex = 1;

    if (filters.jobId !== undefined && filters.jobId !== null) {
      whereClauses.push(`cpm.job_id = $${paramIndex}`);
      queryParams.push(filters.jobId);
      paramIndex++;
    }

    if (filters.customerId !== undefined && filters.customerId !== null && filters.customerId !== '') {
      whereClauses.push(`cpm.customer_id ILIKE $${paramIndex}`);
      queryParams.push(`%${filters.customerId}%`);
      paramIndex++;
    }

    if (filters.pocketId !== undefined && filters.pocketId !== null) {
      whereClauses.push(`cpm.pocket_id = $${paramIndex}`);
      queryParams.push(filters.pocketId);
      paramIndex++;
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Count total records
    const countQuery = `
      SELECT COUNT(*) as total
      FROM customer_pocket_mappings cpm
      ${whereClause}
    `;

    const countResult = await query(countQuery, queryParams);
    const totalRecords = parseInt(countResult.rows[0].total, 10);
    const totalPages = Math.ceil(totalRecords / pageSize);

    const statsQuery = `
      WITH base_data AS (
        SELECT
          cpm.customer_id,
          cpm.pocket_id,
          CASE
            WHEN cpm.pocket_id IS NULL OR btrim(cpm.pocket_id) = '' THEN NULL
            ELSE array_to_string((string_to_array(cpm.pocket_id, '-'))[1:4], '-')
          END AS pocket_id_5km,
          cpm.nearest_branch_id,
          COALESCE(cpm.existing_branch_id, cpm.nearest_branch_id) AS effective_existing_branch_id,
          cpm.distance_customer_to_pocket,
          COALESCE(cpm.distance_customer_to_existing_branch, cpm.distance_customer_to_branch) AS effective_original_distance,
          cpm.distance_customer_to_branch AS changed_distance
        FROM customer_pocket_mappings cpm
        ${whereClause}
      )
      SELECT
        COUNT(DISTINCT base_data.customer_id) AS unique_customers,
        COUNT(DISTINCT base_data.pocket_id_5km) AS unique_pockets,
        COUNT(DISTINCT base_data.nearest_branch_id) AS unique_branches,
        COALESCE(AVG(base_data.distance_customer_to_pocket), 0) AS avg_distance,
        COUNT(*) AS comparable_accounts,
        COUNT(*) FILTER (
          WHERE base_data.effective_existing_branch_id = base_data.nearest_branch_id
        ) AS same_branch_accounts,
        COUNT(*) FILTER (
          WHERE base_data.effective_existing_branch_id <> base_data.nearest_branch_id
        ) AS different_branch_accounts,
        COUNT(DISTINCT base_data.nearest_branch_id) FILTER (
          WHERE base_data.effective_existing_branch_id = base_data.nearest_branch_id
        ) AS same_branch_count,
        COUNT(DISTINCT base_data.nearest_branch_id) FILTER (
          WHERE base_data.effective_existing_branch_id <> base_data.nearest_branch_id
        ) AS different_branch_count,
        COUNT(DISTINCT base_data.nearest_branch_id) AS total_branch_count,
        COALESCE(AVG(base_data.effective_original_distance), 0) AS avg_existing_branch_distance,
        COALESCE(AVG(base_data.changed_distance), 0) AS avg_revised_branch_distance,
        COALESCE(AVG(base_data.effective_original_distance - base_data.changed_distance), 0) AS avg_distance_reduction,
        COALESCE(SUM(base_data.effective_original_distance - base_data.changed_distance), 0) AS total_distance_reduction,
        COUNT(*) FILTER (
          WHERE (base_data.effective_original_distance - base_data.changed_distance) > 0
        ) AS improved_accounts,
        COUNT(*) FILTER (
          WHERE ABS(base_data.effective_original_distance - base_data.changed_distance) <= 0.01
        ) AS unchanged_distance_accounts,
        COUNT(*) FILTER (
          WHERE (base_data.effective_original_distance - base_data.changed_distance) < 0
        ) AS worsened_accounts,
        COALESCE(AVG(base_data.effective_original_distance) FILTER (
          WHERE base_data.effective_existing_branch_id = base_data.nearest_branch_id
        ), 0) AS same_branch_avg_original_distance,
        COALESCE(AVG(base_data.changed_distance) FILTER (
          WHERE base_data.effective_existing_branch_id = base_data.nearest_branch_id
        ), 0) AS same_branch_avg_changed_distance,
        COALESCE(AVG(base_data.effective_original_distance) FILTER (
          WHERE base_data.effective_existing_branch_id <> base_data.nearest_branch_id
        ), 0) AS different_branch_avg_original_distance,
        COALESCE(AVG(base_data.changed_distance) FILTER (
          WHERE base_data.effective_existing_branch_id <> base_data.nearest_branch_id
        ), 0) AS different_branch_avg_changed_distance,
        COALESCE(AVG(base_data.effective_original_distance - base_data.changed_distance) FILTER (
          WHERE base_data.effective_existing_branch_id = base_data.nearest_branch_id
        ), 0) AS same_branch_avg_impact,
        COALESCE(AVG(base_data.effective_original_distance - base_data.changed_distance) FILTER (
          WHERE base_data.effective_existing_branch_id <> base_data.nearest_branch_id
        ), 0) AS different_branch_avg_impact
      FROM base_data
    `;

    const statsResult = await query(statsQuery, queryParams);
    const statsRow = statsResult.rows[0] || {};

    const branchImpactQuery = `
      SELECT
        cpm.existing_branch_id,
        existing_branch.city AS existing_branch_name,
        COUNT(*)::int AS comparable_accounts,
        COUNT(*) FILTER (
          WHERE cpm.existing_branch_id = cpm.nearest_branch_id
        )::int AS same_branch_accounts,
        COUNT(*) FILTER (
          WHERE cpm.existing_branch_id <> cpm.nearest_branch_id
        )::int AS different_branch_accounts,
        COALESCE(AVG(cpm.distance_customer_to_existing_branch), 0) AS avg_existing_branch_distance,
        COALESCE(AVG(cpm.distance_customer_to_branch), 0) AS avg_revised_branch_distance,
        COALESCE(AVG(cpm.distance_customer_to_existing_branch - cpm.distance_customer_to_branch), 0) AS avg_distance_reduction,
        COALESCE(SUM(cpm.distance_customer_to_existing_branch - cpm.distance_customer_to_branch), 0) AS total_distance_reduction
      FROM customer_pocket_mappings cpm
      LEFT JOIN branches existing_branch
        ON cpm.existing_branch_id = existing_branch.id
      ${whereClause ? `${whereClause} AND cpm.existing_branch_id IS NOT NULL` : 'WHERE cpm.existing_branch_id IS NOT NULL'}
      GROUP BY cpm.existing_branch_id, existing_branch.city
      ORDER BY comparable_accounts DESC, cpm.existing_branch_id ASC
      LIMIT 500
    `;
    const branchImpactResult = await query(branchImpactQuery, queryParams);

    // Fetch paginated data with branch name
    const dataQuery = `
      SELECT 
        cpm.id,
        cpm.job_id,
        cpm.customer_id,
        cpm.customer_lat,
        cpm.customer_lon,
        cpm.pocket_id,
        cpm.distance_customer_to_pocket,
        cpm.nearest_branch_id,
        revised_branch.city AS branch_name,
        cpm.uploaded_branch_code,
        cpm.existing_branch_id,
        existing_branch.city AS existing_branch_name,
        cpm.distance_customer_to_existing_branch,
        CASE
          WHEN cpm.existing_branch_id IS NULL THEN 'not_comparable'
          WHEN cpm.existing_branch_id = cpm.nearest_branch_id THEN 'same'
          ELSE 'different'
        END AS branch_change_type,
        CASE
          WHEN cpm.existing_branch_id IS NULL THEN NULL
          ELSE cpm.distance_customer_to_existing_branch - cpm.distance_customer_to_branch
        END AS distance_reduction,
        cpm.distance_pocket_to_branch,
        cpm.distance_customer_to_branch,
        cpm.created_at
      FROM customer_pocket_mappings cpm
      LEFT JOIN branches revised_branch
        ON cpm.nearest_branch_id = revised_branch.id
      LEFT JOIN branches existing_branch
        ON cpm.existing_branch_id = existing_branch.id
      ${whereClause}
      ORDER BY cpm.id ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const dataParams = [...queryParams, pageSize, offset];
    const dataResult = await query(dataQuery, dataParams);

    logger.debug('Retrieved customer mappings', {
      filters,
      page,
      pageSize,
      totalRecords,
      returnedRecords: dataResult.rows.length,
    });

    return {
      data: dataResult.rows.map(row => ({
        id: row.id,
        jobId: row.job_id,
        customerId: row.customer_id,
        customerLat: parseFloat(row.customer_lat),
        customerLon: parseFloat(row.customer_lon),
        pocketId: row.pocket_id,
        distanceCustomerToPocket: parseFloat(row.distance_customer_to_pocket),
        nearestBranchId: row.nearest_branch_id,
        branchName: row.branch_name,
        uploadedBranchCode: row.uploaded_branch_code,
        existingBranchId: row.existing_branch_id,
        existingBranchName: row.existing_branch_name,
        distanceCustomerToExistingBranch:
          row.distance_customer_to_existing_branch === null
            ? null
            : parseFloat(row.distance_customer_to_existing_branch),
        branchChangeType: row.branch_change_type,
        distanceReduction:
          row.distance_reduction === null
            ? null
            : parseFloat(row.distance_reduction),
        distancePocketToBranch: parseFloat(row.distance_pocket_to_branch),
        distanceCustomerToBranch: parseFloat(row.distance_customer_to_branch),
        createdAt: row.created_at,
      })),
      pagination: {
        page,
        pageSize,
        totalRecords,
        totalPages,
      },
      stats: {
        uniqueCustomers: parseInt(statsRow.unique_customers || '0', 10),
        uniquePockets: parseInt(statsRow.unique_pockets || '0', 10),
        uniqueBranches: parseInt(statsRow.unique_branches || '0', 10),
        avgDistance: parseFloat(statsRow.avg_distance || '0'),
        impact: {
          comparableAccounts: parseInt(statsRow.comparable_accounts || '0', 10),
          sameBranchAccounts: parseInt(statsRow.same_branch_accounts || '0', 10),
          differentBranchAccounts: parseInt(statsRow.different_branch_accounts || '0', 10),
          sameBranchCount: parseInt(statsRow.same_branch_count || '0', 10),
          differentBranchCount: parseInt(statsRow.different_branch_count || '0', 10),
          totalBranchCount: parseInt(statsRow.total_branch_count || '0', 10),
          avgExistingBranchDistance: parseFloat(statsRow.avg_existing_branch_distance || '0'),
          avgRevisedBranchDistance: parseFloat(statsRow.avg_revised_branch_distance || '0'),
          avgDistanceReduction: parseFloat(statsRow.avg_distance_reduction || '0'),
          totalDistanceReduction: parseFloat(statsRow.total_distance_reduction || '0'),
          improvedAccounts: parseInt(statsRow.improved_accounts || '0', 10),
          unchangedDistanceAccounts: parseInt(statsRow.unchanged_distance_accounts || '0', 10),
          worsenedAccounts: parseInt(statsRow.worsened_accounts || '0', 10),
          sameBranchAvgOriginalDistance: parseFloat(statsRow.same_branch_avg_original_distance || '0'),
          sameBranchAvgChangedDistance: parseFloat(statsRow.same_branch_avg_changed_distance || '0'),
          differentBranchAvgOriginalDistance: parseFloat(statsRow.different_branch_avg_original_distance || '0'),
          differentBranchAvgChangedDistance: parseFloat(statsRow.different_branch_avg_changed_distance || '0'),
          sameBranchAvgImpact: parseFloat(statsRow.same_branch_avg_impact || '0'),
          differentBranchAvgImpact: parseFloat(statsRow.different_branch_avg_impact || '0'),
        },
        byExistingBranch: branchImpactResult.rows.map((row) => ({
          existingBranchId: row.existing_branch_id,
          existingBranchName: row.existing_branch_name,
          comparableAccounts: parseInt(row.comparable_accounts || '0', 10),
          sameBranchAccounts: parseInt(row.same_branch_accounts || '0', 10),
          differentBranchAccounts: parseInt(row.different_branch_accounts || '0', 10),
          avgExistingBranchDistance: parseFloat(row.avg_existing_branch_distance || '0'),
          avgRevisedBranchDistance: parseFloat(row.avg_revised_branch_distance || '0'),
          avgDistanceReduction: parseFloat(row.avg_distance_reduction || '0'),
          totalDistanceReduction: parseFloat(row.total_distance_reduction || '0'),
        })),
      },
    };
  }

  /**
   * Delete customer-to-pocket mappings based on retention policy
   * @param {Date|string} olderThan - Delete mappings created before this date
   * @param {string} [jobId] - Optional: Delete mappings for specific job only
   * @returns {Promise<number>} Number of records deleted
   */
  async deleteMappings(olderThan, jobId = null) {
    if (!olderThan) {
      throw new Error('olderThan date is required');
    }

    // Convert to Date if string
    const deleteDate = olderThan instanceof Date ? olderThan : new Date(olderThan);
    
    if (isNaN(deleteDate.getTime())) {
      throw new Error('Invalid date format for olderThan');
    }

    // Build WHERE clause
    const whereClauses = ['created_at < $1'];
    const queryParams = [deleteDate];

    if (jobId !== null && jobId !== undefined) {
      whereClauses.push('job_id = $2');
      queryParams.push(jobId);
    }

    const whereClause = whereClauses.join(' AND ');

    const deleteQuery = `
      DELETE FROM customer_pocket_mappings
      WHERE ${whereClause}
    `;

    logger.info('Deleting customer mappings', {
      olderThan: deleteDate.toISOString(),
      jobId: jobId || 'all jobs',
    });

    try {
      const result = await query(deleteQuery, queryParams);
      const deletedCount = result.rowCount;

      logger.info('Customer mappings deleted', {
        olderThan: deleteDate.toISOString(),
        jobId: jobId || 'all jobs',
        deletedCount,
      });

      return deletedCount;
    } catch (error) {
      logger.error('Failed to delete customer mappings', {
        olderThan: deleteDate.toISOString(),
        jobId: jobId || 'all jobs',
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Insert a single batch of mappings using parameterized query
   * @private
   * @param {Object} client - Transaction client
   * @param {string} jobId - The batch job UUID
   * @param {Array<Object>} batch - Batch of mapping objects
   * @returns {Promise<number>} Number of records inserted
   */
  async _insertBatch(client, jobId, batch) {
    // Build parameterized query for bulk insert
    const values = [];
    const placeholders = [];
    const updateAssignments = UPSERT_UPDATE_COLUMNS
      .map((column) => `${column} = EXCLUDED.${column}`)
      .concat('created_at = CURRENT_TIMESTAMP')
      .join(',\n        ');
    
    batch.forEach((mapping, index) => {
      const baseIndex = index * VALUES_PER_ROW;
      
      // Add values for this row
      values.push(
        jobId,
        mapping.customerId,
        mapping.customerLat,
        mapping.customerLon,
        mapping.pocketId,
        mapping.distanceCustomerToPocket,
        mapping.nearestBranchId,
        mapping.distancePocketToBranch,
        mapping.distanceCustomerToBranch,
        mapping.uploadedBranchCode || null,
        mapping.existingBranchId || null,
        mapping.distanceCustomerToExistingBranch ?? null
      );
      
      // Create placeholder string for this row: ($1, $2, ..., $12)
      const rowPlaceholders = [
        `$${baseIndex + 1}`,
        `$${baseIndex + 2}`,
        `$${baseIndex + 3}`,
        `$${baseIndex + 4}`,
        `$${baseIndex + 5}`,
        `$${baseIndex + 6}`,
        `$${baseIndex + 7}`,
        `$${baseIndex + 8}`,
        `$${baseIndex + 9}`,
        `$${baseIndex + 10}`,
        `$${baseIndex + 11}`,
        `$${baseIndex + 12}`,
      ];
      
      placeholders.push(`(${rowPlaceholders.join(', ')})`);
    });

    const queryText = `
      INSERT INTO customer_pocket_mappings (
        ${UPSERT_COLUMNS.join(',\n        ')}
      )
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (customer_id) DO UPDATE SET
        ${updateAssignments}
    `;

    try {
      const result = await client.query(queryText, values);
      return result.rowCount;
    } catch (error) {
      // Log detailed error information
      logger.error('Database insert error', {
        jobId,
        batchSize: batch.length,
        error: error.message,
        code: error.code,
        detail: error.detail,
      });
      throw error;
    }
  }
}

module.exports = new MappingService();
