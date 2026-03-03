const express = require('express');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const mappingService = require('../services/MappingService');
const logger = require('../config/logger');

const router = express.Router();

const normalizeOptionalId = (value, errorMessage, errorCode, maxLength = 50) => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new AppError(errorMessage, 400, errorCode);
  }

  const normalized = String(value).trim();
  if (normalized === '') {
    return null;
  }

  if (normalized.length > maxLength) {
    throw new AppError(errorMessage, 400, errorCode);
  }

  return normalized;
};

const normalizeRequiredId = (value, errorMessage, errorCode, maxLength = 50) => {
  if (value === undefined || value === null) {
    throw new AppError(errorMessage, 400, errorCode);
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new AppError(errorMessage, 400, errorCode);
  }

  const normalized = String(value).trim();
  if (normalized === '' || normalized.length > maxLength) {
    throw new AppError(errorMessage, 400, errorCode);
  }

  return normalized;
};

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
    const jobId = normalizeOptionalId(req.query.jobId, 'Invalid job ID', 'INVALID_JOB_ID');
    const customerId = req.query.customerId || '';
    const pocketId = normalizeOptionalId(req.query.pocketId, 'Invalid pocket ID', 'INVALID_POCKET_ID');

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
    const normalizedJobId = normalizeRequiredId(
      jobId,
      'Invalid or missing jobId',
      'INVALID_JOB_ID'
    );

    // Validate request body
    if (!Array.isArray(mappings) || mappings.length === 0) {
      throw new AppError('Mappings must be a non-empty array', 400, 'INVALID_MAPPINGS');
    }

    const normalizedMappings = [];

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
      if (typeof mapping.customerId !== 'string' || mapping.customerId.trim() === '') {
        throw new AppError(
          `Invalid customerId type at index ${i}`,
          400,
          'INVALID_TYPE'
        );
      }

      if (
        typeof mapping.customerLat !== 'number' ||
        typeof mapping.customerLon !== 'number' ||
        typeof mapping.distanceCustomerToPocket !== 'number' ||
        typeof mapping.distancePocketToBranch !== 'number' ||
        typeof mapping.distanceCustomerToBranch !== 'number' ||
        !Number.isFinite(mapping.customerLat) ||
        !Number.isFinite(mapping.customerLon) ||
        !Number.isFinite(mapping.distanceCustomerToPocket) ||
        !Number.isFinite(mapping.distancePocketToBranch) ||
        !Number.isFinite(mapping.distanceCustomerToBranch) ||
        (typeof mapping.pocketId !== 'string' && typeof mapping.pocketId !== 'number') ||
        (typeof mapping.nearestBranchId !== 'string' && typeof mapping.nearestBranchId !== 'number')
      ) {
        throw new AppError(
          `Invalid data types in mapping at index ${i}`,
          400,
          'INVALID_TYPE'
        );
      }

      normalizedMappings.push({
        customerId: mapping.customerId.trim(),
        customerLat: mapping.customerLat,
        customerLon: mapping.customerLon,
        pocketId: normalizeRequiredId(
          mapping.pocketId,
          `Invalid pocketId at index ${i}`,
          'INVALID_TYPE'
        ),
        distanceCustomerToPocket: mapping.distanceCustomerToPocket,
        nearestBranchId: normalizeRequiredId(
          mapping.nearestBranchId,
          `Invalid nearestBranchId at index ${i}`,
          'INVALID_TYPE',
          20
        ),
        distancePocketToBranch: mapping.distancePocketToBranch,
        distanceCustomerToBranch: mapping.distanceCustomerToBranch,
      });
    }

    logger.info('Saving customer mappings', { jobId: normalizedJobId, count: normalizedMappings.length });

    // Call service to save mappings
    const result = await mappingService.saveMappings(normalizedJobId, normalizedMappings);

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
    const parsedJobId = normalizeOptionalId(jobId, 'Invalid job ID', 'INVALID_JOB_ID');

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
