/**
 * Integration Test Setup
 * Sets up test database and cleans up after tests
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Test database configuration
const testDbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'location_pockets_test',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
};

let pool;

/**
 * Setup test database before all tests
 */
async function setupTestDatabase() {
  pool = new Pool(testDbConfig);

  try {
    // Enable PostGIS extension
    await pool.query('CREATE EXTENSION IF NOT EXISTS postgis;');

    // Run migrations
    const migrationPath = path.join(__dirname, '../../src/migrations/001_initial_schema.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    await pool.query(migrationSQL);

    console.log('✅ Test database setup complete');
  } catch (error) {
    console.error('❌ Test database setup failed:', error);
    throw error;
  }
}

/**
 * Clean up test data between tests
 */
async function cleanupTestData() {
  try {
    await pool.query('TRUNCATE TABLE branches CASCADE;');
    await pool.query('TRUNCATE TABLE config_history CASCADE;');
    await pool.query('DELETE FROM config WHERE key != \'system\';');
  } catch (error) {
    console.error('❌ Test data cleanup failed:', error);
    throw error;
  }
}

/**
 * Teardown test database after all tests
 */
async function teardownTestDatabase() {
  if (pool) {
    await pool.end();
  }
}

/**
 * Get database pool for tests
 */
function getPool() {
  return pool;
}

module.exports = {
  setupTestDatabase,
  cleanupTestData,
  teardownTestDatabase,
  getPool,
};
