/**
 * Mapping Service
 * Handles persistence and retrieval of customer-to-pocket mappings
 */

const { query, transaction } = require('../config/database');
const logger = require('../config/logger');

class MappingService {
  /**
   * Save customer-to-pocket mappings in bulk
   * @param {number} jobId - The batch job ID
   * @param {Array<Object>} mappings - Array of mapping objects
   * @param {string} mappings[].customerId - Customer identifier
   * @param {number} mappings[].customerLat - Customer latitude
   * @param {number} mappings[].customerLon - Customer longitude
   * @param {string} mappings[].pocketId - Pocket identifier
   * @param {number} mappings[].distanceCustomerToPocket - Distance from customer to pocket center (meters)
   * @param {string} mappings[].nearestBranchId - Nearest branch identifier
   * @param {number} mappings[].distancePocketToBranch - Distance from pocket to branch (meters)
   * @param {number} mappings[].distanceCustomerToBranch - Distance from customer to branch (meters)
   * @returns {Promise<{success: boolean, insertedCount: number, errors: Array<string>}>}
   */
  async saveMappings(jobId, mappings) {
    if (!jobId || !mappings || !Array.isArray(mappings)) {
      throw new Error('Invalid parameters: jobId and mappings array are required');
    }

    if (mappings.length === 0) {
      return { success: true, insertedCount: 0, errors: [] };
    }

    const BATCH_SIZE = 1000;
    let totalInserted = 0;
    const errors = [];

    logger.info('Starting bulk mapping insert', {
      jobId,
      totalMappings: mappings.length,
      batchSize: BATCH_SIZE,
    });

    // Process mappings in batches of 1000
    for (let i = 0; i < mappings.length; i += BATCH_SIZE) {
      const batch = mappings.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(mappings.length / BATCH_SIZE);

      try {
        const insertedCount = await this._insertBatch(jobId, batch);
        totalInserted += insertedCount;
        
        logger.debug('Batch insert successful', {
          jobId,
          batchNumber,
          totalBatches,
          batchSize: batch.length,
          insertedCount,
        });
      } catch (error) {
        const errorMsg = `Batch ${batchNumber}/${totalBatches} failed: ${error.message}`;
        logger.error('Batch insert failed', {
          jobId,
          batchNumber,
          totalBatches,
          batchSize: batch.length,
          error: error.message,
          stack: error.stack,
        });
        errors.push(errorMsg);

        // Continue processing remaining batches
        continue;
      }
    }

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
   * @param {number} [filters.jobId] - Filter by batch job ID
   * @param {string} [filters.customerId] - Filter by customer ID (partial match)
   * @param {number} [filters.pocketId] - Filter by pocket ID
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
      SELECT
        COUNT(DISTINCT cpm.customer_id) AS unique_customers,
        COUNT(DISTINCT cpm.pocket_id) AS unique_pockets,
        COUNT(DISTINCT cpm.nearest_branch_id) AS unique_branches,
        COALESCE(AVG(cpm.distance_customer_to_pocket), 0) AS avg_distance
      FROM customer_pocket_mappings cpm
      ${whereClause}
    `;

    const statsResult = await query(statsQuery, queryParams);
    const statsRow = statsResult.rows[0] || {};

    // Fetch paginated data with branch name
    const dataQuery = `
      SELECT 
        cpm.id,
        cpm.customer_id,
        cpm.customer_lat,
        cpm.customer_lon,
        cpm.pocket_id,
        cpm.distance_customer_to_pocket,
        cpm.nearest_branch_id,
        b.city as branch_name,
        cpm.distance_pocket_to_branch,
        cpm.distance_customer_to_branch,
        cpm.created_at
      FROM customer_pocket_mappings cpm
      LEFT JOIN branches b ON cpm.nearest_branch_id = b.id
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
        customerId: row.customer_id,
        customerLat: parseFloat(row.customer_lat),
        customerLon: parseFloat(row.customer_lon),
        pocketId: row.pocket_id,
        distanceCustomerToPocket: parseFloat(row.distance_customer_to_pocket),
        nearestBranchId: row.nearest_branch_id,
        branchName: row.branch_name,
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
      },
    };
  }

  /**
   * Delete customer-to-pocket mappings based on retention policy
   * @param {Date|string} olderThan - Delete mappings created before this date
   * @param {number} [jobId] - Optional: Delete mappings for specific job only
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
   * @param {number} jobId - The batch job ID
   * @param {Array<Object>} batch - Batch of mapping objects
   * @returns {Promise<number>} Number of records inserted
   */
  async _insertBatch(jobId, batch) {
    // Build parameterized query for bulk insert
    const values = [];
    const placeholders = [];
    
    batch.forEach((mapping, index) => {
      const baseIndex = index * 9; // 9 columns per row
      
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
        mapping.distanceCustomerToBranch
      );
      
      // Create placeholder string for this row: ($1, $2, $3, ..., $9)
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
      ];
      
      placeholders.push(`(${rowPlaceholders.join(', ')})`);
    });

    const queryText = `
      INSERT INTO customer_pocket_mappings (
        job_id,
        customer_id,
        customer_lat,
        customer_lon,
        pocket_id,
        distance_customer_to_pocket,
        nearest_branch_id,
        distance_pocket_to_branch,
        distance_customer_to_branch
      )
      VALUES ${placeholders.join(', ')}
    `;

    try {
      const result = await query(queryText, values);
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
