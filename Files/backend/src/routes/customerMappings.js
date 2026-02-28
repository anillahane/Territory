const express = require('express');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const mappingService = require('../services/MappingService');
const logger = require('../config/logger');

const router = express.Router();

/**
 * GET /api/v1/customer-mappings
 * Retrieve customer-to-pocket mappings with pagination and filtering
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Parse and validate query parameters
    let page = parseInt(req.query.page, 10);
    let pageSize = parseInt(req.query.pageSize, 10);
    const jobId = req.query.jobId ? parseInt(req.query.jobId, 10) : null;
    const customerId = req.query.customerId || '';
    const pocketId = req.query.pocketId ? parseInt(req.query.pocketId, 10) : null;

    // Validate and set defaults for page
    if (isNaN(page) || page < 1) {
      page = 1;
    }

    // Validate and set defaults for pageSize
    if (isNaN(pageSize) || pageSize < 1) {
      pageSize = 100;
    } else if (pageSize > 1000) {
      throw new AppError('Page size must be between 1 and 1000', 400, 'INVALID_PAGE_SIZE');
    }

    if (jobId !== null && (isNaN(jobId) || jobId < 1)) {
      throw new AppError('Invalid job ID', 400, 'INVALID_JOB_ID');
    }

    if (pocketId !== null && (isNaN(pocketId) || pocketId < 1)) {
      throw new AppError('Invalid pocket ID', 400, 'INVALID_POCKET_ID');
    }

    // Build filters object
    const filters = {
      jobId,
      customerId,
      pocketId,
    };

    // Build pagination object
    const pagination = {
      page,
      pageSize,
    };

    logger.info('Fetching customer mappings', { filters, pagination });

    // Call service to get mappings
    const result = await mappingService.getMappings(filters, pagination);

    res.json(result);
  })
);

/**
 * POST /api/v1/customer-mappings/batch
 * Persist multiple customer mappings from batch processing
 */
router.post(
  '/batch',
  asyncHandler(async (req, res) => {
    const { jobId, mappings } = req.body;

    // Validate request body
    if (!jobId || typeof jobId !== 'number') {
      throw new AppError('Invalid or missing jobId', 400, 'INVALID_JOB_ID');
    }

    if (!Array.isArray(mappings) || mappings.length === 0) {
      throw new AppError('Mappings must be a non-empty array', 400, 'INVALID_MAPPINGS');
    }

    // Validate each mapping has required fields
    for (let i = 0; i < mappings.length; i++) {
      const mapping = mappings[i];
      const requiredFields = [
        'customerId',
        'customerLat',
        'customerLon',
        'pocketId',
        'distanceCustomerToPocket',
        'nearestBranchId',
        'distancePocketToBranch',
        'distanceCustomerToBranch',
      ];

      for (const field of requiredFields) {
        if (mapping[field] === undefined || mapping[field] === null) {
          throw new AppError(
            `Missing required field '${field}' in mapping at index ${i}`,
            400,
            'MISSING_FIELD'
          );
        }
      }

      // Validate data types
      if (typeof mapping.customerId !== 'string') {
        throw new AppError(
          `Invalid customerId type at index ${i}`,
          400,
          'INVALID_TYPE'
        );
      }

      if (
        typeof mapping.customerLat !== 'number' ||
        typeof mapping.customerLon !== 'number' ||
        typeof mapping.pocketId !== 'number' ||
        typeof mapping.distanceCustomerToPocket !== 'number' ||
        typeof mapping.nearestBranchId !== 'number' ||
        typeof mapping.distancePocketToBranch !== 'number' ||
        typeof mapping.distanceCustomerToBranch !== 'number'
      ) {
        throw new AppError(
          `Invalid data types in mapping at index ${i}`,
          400,
          'INVALID_TYPE'
        );
      }
    }

    logger.info('Saving customer mappings', { jobId, count: mappings.length });

    // Call service to save mappings
    const result = await mappingService.saveMappings(jobId, mappings);

    res.status(201).json({
      success: result.success,
      insertedCount: result.insertedCount,
      errors: result.errors,
    });
  })
);

/**
 * DELETE /api/v1/customer-mappings
 * Delete customer mappings based on retention policy
 */
router.delete(
  '/',
  asyncHandler(async (req, res) => {
    const { olderThan, jobId } = req.query;

    // Validate olderThan parameter
    if (!olderThan) {
      throw new AppError('olderThan query parameter is required', 400, 'MISSING_PARAMETER');
    }

    // Validate date format
    const deleteDate = new Date(olderThan);
    if (isNaN(deleteDate.getTime())) {
      throw new AppError('Invalid date format for olderThan', 400, 'INVALID_DATE');
    }

    // Validate jobId if provided
    let parsedJobId = null;
    if (jobId !== undefined && jobId !== null && jobId !== '') {
      parsedJobId = parseInt(jobId, 10);
      if (isNaN(parsedJobId) || parsedJobId < 1) {
        throw new AppError('Invalid job ID', 400, 'INVALID_JOB_ID');
      }
    }

    logger.info('Deleting customer mappings', {
      olderThan: deleteDate.toISOString(),
      jobId: parsedJobId || 'all jobs',
    });

    // Call service to delete mappings
    const deletedCount = await mappingService.deleteMappings(deleteDate, parsedJobId);

    res.json({
      success: true,
      deletedCount,
    });
  })
);

module.exports = router;
