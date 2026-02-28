const express = require('express');
const { pool } = require('../config/database');
const logger = require('../config/logger');

const router = express.Router();

/**
 * Health check endpoint
 * GET /health
 */
router.get('/', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
  };

  try {
    // Check database connection
    const dbResult = await pool.query('SELECT NOW()');
    health.database = {
      status: 'connected',
      timestamp: dbResult.rows[0].now,
    };

    // Check PostGIS extension
    const postgisResult = await pool.query('SELECT PostGIS_Version()');
    health.postgis = {
      status: 'available',
      version: postgisResult.rows[0].postgis_version,
    };

    res.status(200).json(health);
  } catch (error) {
    logger.error('Health check failed:', error);
    health.status = 'error';
    health.database = {
      status: 'disconnected',
      error: error.message,
    };
    res.status(503).json(health);
  }
});

module.exports = router;
