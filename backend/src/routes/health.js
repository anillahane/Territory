const express = require('express');
const { getDatabaseHealth, query } = require('../config/database');
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
    const dbResult = await query('SELECT NOW() AS now');
    const postgisResult = await query('SELECT PostGIS_Version() AS version');
    const databaseHealth = getDatabaseHealth();

    health.database = {
      status: databaseHealth.status,
      timestamp: dbResult.rows[0].now,
      recoveryInProgress: databaseHealth.recoveryInProgress,
      recoveryAttempts: databaseHealth.recoveryAttempts,
      lastHealthyAt: databaseHealth.lastHealthyAt,
      lastRecoveryAt: databaseHealth.lastRecoveryAt,
      lastError: databaseHealth.lastError,
      lastErrorCode: databaseHealth.lastErrorCode,
      lastErrorAt: databaseHealth.lastErrorAt,
    };

    health.postgis = {
      status: 'available',
      version: postgisResult.rows[0].version,
    };

    res.status(200).json(health);
  } catch (error) {
    const databaseHealth = getDatabaseHealth();

    logger.error('Health check failed', {
      error: error.message,
      databaseStatus: databaseHealth.status,
      recoveryInProgress: databaseHealth.recoveryInProgress,
    });
    health.status = 'error';
    health.database = {
      status: databaseHealth.status === 'connected' ? 'disconnected' : databaseHealth.status,
      error: error.message,
      recoveryInProgress: databaseHealth.recoveryInProgress,
      recoveryAttempts: databaseHealth.recoveryAttempts,
      lastHealthyAt: databaseHealth.lastHealthyAt,
      lastRecoveryAt: databaseHealth.lastRecoveryAt,
      lastError: databaseHealth.lastError,
      lastErrorCode: databaseHealth.lastErrorCode,
      lastErrorAt: databaseHealth.lastErrorAt,
    };
    res.status(503).json(health);
  }
});

module.exports = router;
