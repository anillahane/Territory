require('dotenv').config();
const { Pool } = require('pg');
const logger = require('./logger');

const REQUIRED_ENV_VARS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missingEnvVars = REQUIRED_ENV_VARS.filter((key) => !String(process.env[key] || '').trim());
if (missingEnvVars.length > 0) {
  logger.error('FATAL: database configuration is incomplete', {
    missingEnvVars
  });
  throw new Error(`Database configuration is incomplete. Missing: ${missingEnvVars.join(', ')}`);
}

let isPoolHealthy = true;
let poolErrorMessage = null;

const poolConfig = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT, 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000
};

const pool = new Pool(poolConfig);

const setPoolHealthy = (healthy, errorMessage = null) => {
  isPoolHealthy = healthy;
  poolErrorMessage = errorMessage;
};

pool.on('connect', () => {
  setPoolHealthy(true, null);
  logger.info('Database connection established');
});

pool.on('error', (error) => {
  setPoolHealthy(false, error.message);
  logger.error('Unexpected database pool error', {
    error: error.message,
    code: error.code
  });
});

const wait = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const ensureDatabaseReady = async (attempt = 1, maxAttempts = 5) => {
  try {
    await pool.query('SELECT 1');
    setPoolHealthy(true, null);
    return;
  } catch (error) {
    setPoolHealthy(false, error.message);
    logger.error('Database connectivity check failed', {
      attempt,
      maxAttempts,
      error: error.message
    });
    if (attempt >= maxAttempts) {
      throw error;
    }
    await wait(250 * (2 ** (attempt - 1)));
    await ensureDatabaseReady(attempt + 1, maxAttempts);
  }
};

const query = async (text, params) => {
  const startedAt = Date.now();
  try {
    const result = await pool.query(text, params);
    setPoolHealthy(true, null);
    logger.debug('Executed query', {
      duration: Date.now() - startedAt,
      rows: result.rowCount
    });
    return result;
  } catch (error) {
    setPoolHealthy(false, error.message);
    logger.error('Query error', {
      text,
      error: error.message
    });
    throw error;
  }
};

const transaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    setPoolHealthy(true, null);
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error('Transaction rollback failed', {
        error: rollbackError.message
      });
    }
    setPoolHealthy(false, error.message);
    throw error;
  } finally {
    client.release();
  }
};

const getPoolHealth = () => ({
  healthy: isPoolHealthy,
  error: poolErrorMessage
});

module.exports = {
  ensureDatabaseReady,
  getPoolHealth,
  pool,
  query,
  transaction
};
