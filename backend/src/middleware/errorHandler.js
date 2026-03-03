const logger = require('../config/logger');

/**
 * Global error handling middleware
 */
function errorHandler(err, req, res, next) {
  let normalizedError = err;

  if (err?.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      normalizedError = new AppError(
        `File size exceeds ${process.env.MAX_FILE_SIZE_MB || '10'} MB limit`,
        413,
        'FILE_TOO_LARGE'
      );
    } else {
      normalizedError = new AppError(err.message, 400, err.code || 'UPLOAD_ERROR');
    }
  }

  // Log error
  logger.error('Error occurred:', {
    message: normalizedError.message,
    stack: normalizedError.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
  });

  // Determine status code
  const statusCode = normalizedError.statusCode || normalizedError.status || 500;

  // Prepare error response
  const errorResponse = {
    error: normalizedError.message || 'Internal Server Error',
    code: normalizedError.code || 'INTERNAL_ERROR',
  };

  // Include details in development mode
  if (process.env.NODE_ENV === 'development') {
    errorResponse.stack = normalizedError.stack;
    errorResponse.details = normalizedError.details;
  }

  // Send response
  res.status(statusCode).json(errorResponse);
}

/**
 * Custom error class
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'APP_ERROR', details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Async handler wrapper to catch errors in async route handlers
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  errorHandler,
  AppError,
  asyncHandler,
};
