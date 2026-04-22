require('dotenv').config();
const { Pool } = require('pg');
const logger = require('./logger');

const DEFAULT_DB_PORT = 5432;
const DEFAULT_POOL_MAX = 20;
const DEFAULT_POOL_IDLE_TIMEOUT_MS = 30000;
const DEFAULT_POOL_CONNECTION_TIMEOUT_MS = 2000;
const DEFAULT_DB_STATEMENT_TIMEOUT_MS = 15000;
const DEFAULT_DB_HEALTH_RETRY_ATTEMPTS = 5;
const DEFAULT_DB_HEALTH_RETRY_DELAY_MS = 5000;

const CONNECTION_ERROR_CODES = new Set([
  '57P01',
  '57P02',
  '57P03',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '53300',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
]);

const parsePositiveInteger = (value, fallbackValue) => {
  const parsedValue = parseInt(value, 10);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : fallbackValue;
};

const isConnectionError = (error) => {
  const errorCode = error?.code;
  const errorMessage = String(error?.message || '');

  return (
    CONNECTION_ERROR_CODES.has(errorCode)
    || /connection terminated unexpectedly/i.test(errorMessage)
    || /could not connect to server/i.test(errorMessage)
    || /terminating connection/i.test(errorMessage)
    || /the database system is shutting down/i.test(errorMessage)
  );
};

const dbPassword = process.env.DB_PASSWORD;
const dbStatementTimeoutMs = parsePositiveInteger(
  process.env.DB_STATEMENT_TIMEOUT_MS,
  DEFAULT_DB_STATEMENT_TIMEOUT_MS
);
const dbHealthRetryAttempts = parsePositiveInteger(
  process.env.DB_HEALTH_RETRY_ATTEMPTS,
  DEFAULT_DB_HEALTH_RETRY_ATTEMPTS
);
const dbHealthRetryDelayMs = parsePositiveInteger(
  process.env.DB_HEALTH_RETRY_DELAY_MS,
  DEFAULT_DB_HEALTH_RETRY_DELAY_MS
);

if (process.env.NODE_ENV === 'production' && !dbPassword) {
  throw new Error('DB_PASSWORD must be set in production');
}

const poolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parsePositiveInteger(process.env.DB_PORT, DEFAULT_DB_PORT),
  database: process.env.DB_NAME || 'location_pockets',
  user: process.env.DB_USER || 'postgres',
  password: dbPassword,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: parsePositiveInteger(process.env.DB_POOL_MAX, DEFAULT_POOL_MAX),
  idleTimeoutMillis: parsePositiveInteger(
    process.env.DB_POOL_IDLE_TIMEOUT_MS,
    DEFAULT_POOL_IDLE_TIMEOUT_MS
  ),
  connectionTimeoutMillis: parsePositiveInteger(
    process.env.DB_POOL_CONNECTION_TIMEOUT_MS,
    DEFAULT_POOL_CONNECTION_TIMEOUT_MS
  ),
  statement_timeout: dbStatementTimeoutMs,
  query_timeout: dbStatementTimeoutMs,
};

const pool = new Pool(poolConfig);

const databaseHealth = {
  status: 'initializing',
  recoveryInProgress: false,
  recoveryAttempts: 0,
  lastError: null,
  lastErrorCode: null,
  lastErrorAt: null,
  lastHealthyAt: null,
  lastRecoveryAt: null,
};

let recoveryTimer = null;

const clearRecoveryTimer = () => {
  if (recoveryTimer) {
    clearTimeout(recoveryTimer);
    recoveryTimer = null;
  }
};

const markDatabaseHealthy = (source) => {
  const timestamp = new Date().toISOString();
  const wasDegraded =
    databaseHealth.status === 'degraded'
    || databaseHealth.recoveryInProgress
    || databaseHealth.lastError !== null;

  clearRecoveryTimer();

  databaseHealth.status = 'connected';
  databaseHealth.recoveryInProgress = false;
  databaseHealth.recoveryAttempts = 0;
  databaseHealth.lastError = null;
  databaseHealth.lastErrorCode = null;
  databaseHealth.lastErrorAt = null;
  databaseHealth.lastHealthyAt = timestamp;

  if (wasDegraded) {
    databaseHealth.lastRecoveryAt = timestamp;
    logger.info('Database connectivity restored', {
      source,
      recoveredAt: timestamp,
    });
  }
};

const markDatabaseDegraded = (error, metadata = {}) => {
  databaseHealth.status = 'degraded';
  databaseHealth.recoveryInProgress = metadata.recoveryInProgress !== false;
  databaseHealth.recoveryAttempts = metadata.attempt || databaseHealth.recoveryAttempts || 0;
  databaseHealth.lastError = error.message;
  databaseHealth.lastErrorCode = error.code || null;
  databaseHealth.lastErrorAt = new Date().toISOString();
};

const getDatabaseHealth = () => ({
  ...databaseHealth,
});

const scheduleDatabaseRecovery = (attempt = 1) => {
  if (recoveryTimer || attempt > dbHealthRetryAttempts) {
    if (attempt > dbHealthRetryAttempts) {
      databaseHealth.recoveryInProgress = false;
      databaseHealth.recoveryAttempts = dbHealthRetryAttempts;
      logger.error('Database recovery attempts exhausted', {
        attempts: dbHealthRetryAttempts,
        lastError: databaseHealth.lastError,
        lastErrorCode: databaseHealth.lastErrorCode,
      });
    }
    return;
  }

  databaseHealth.recoveryInProgress = true;
  databaseHealth.recoveryAttempts = attempt;

  recoveryTimer = setTimeout(async () => {
    recoveryTimer = null;

    try {
      logger.warn('Attempting database recovery probe', {
        attempt,
        maxAttempts: dbHealthRetryAttempts,
      });
      await pool.query('SELECT 1');
      markDatabaseHealthy('recovery-probe');
    } catch (error) {
      markDatabaseDegraded(error, {
        attempt,
        recoveryInProgress: true,
      });
      logger.error('Database recovery probe failed', {
        attempt,
        maxAttempts: dbHealthRetryAttempts,
        error: error.message,
        code: error.code,
        stack: error.stack,
      });
      scheduleDatabaseRecovery(attempt + 1);
    }
  }, dbHealthRetryDelayMs);

  if (typeof recoveryTimer.unref === 'function') {
    recoveryTimer.unref();
  }
};

const handleConnectionFailure = (error, source) => {
  if (!isConnectionError(error)) {
    return;
  }

  markDatabaseDegraded(error, {
    attempt: databaseHealth.recoveryAttempts || 1,
    recoveryInProgress: true,
  });
  scheduleDatabaseRecovery(databaseHealth.recoveryAttempts || 1);

  logger.error('Database connectivity issue detected', {
    source,
    error: error.message,
    code: error.code,
    stack: error.stack,
  });
};

// Test connection
pool.on('connect', () => {
  logger.info('Database connection established');
  markDatabaseHealthy('pool-connect');
});

pool.on('error', (err) => {
  markDatabaseDegraded(err, {
    attempt: databaseHealth.recoveryAttempts || 1,
    recoveryInProgress: true,
  });
  scheduleDatabaseRecovery(databaseHealth.recoveryAttempts || 1);
  logger.error('Unexpected database pool error', {
    error: err.message,
    code: err.code,
    stack: err.stack,
  });
});

// Query helper with logging
const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    markDatabaseHealthy('query');
    logger.debug('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    handleConnectionFailure(error, 'query');
    logger.error('Query error', { text, error: error.message });
    throw error;
  }
};

// Transaction helper
const transaction = async (callback) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    markDatabaseHealthy('transaction');
    return result;
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        logger.error('Transaction rollback failed', {
          error: rollbackError.message,
          code: rollbackError.code,
        });
      }
    }
    handleConnectionFailure(error, 'transaction');
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
};

module.exports = {
  pool,
  query,
  transaction,
  getDatabaseHealth,
  __testables: {
    clearRecoveryTimer,
    getPoolConfig: () => ({ ...poolConfig }),
    isConnectionError,
    markDatabaseDegraded,
    markDatabaseHealthy,
    parsePositiveInteger,
    resetDatabaseHealth: () => {
      clearRecoveryTimer();
      databaseHealth.status = 'initializing';
      databaseHealth.recoveryInProgress = false;
      databaseHealth.recoveryAttempts = 0;
      databaseHealth.lastError = null;
      databaseHealth.lastErrorCode = null;
      databaseHealth.lastErrorAt = null;
      databaseHealth.lastHealthyAt = null;
      databaseHealth.lastRecoveryAt = null;
    },
    scheduleDatabaseRecovery,
  },
};
