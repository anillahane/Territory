/**
 * Integration Test Setup
 * Sets up test database and cleans up after tests
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Test database configuration
const testDbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5434,
  database: process.env.DB_NAME || 'location_pockets',
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
    await pool.query('CREATE EXTENSION IF NOT EXISTS postgis;');

    const migrations = [
      '001_initial_schema.sql',
      '002_add_jobs_data_column.sql',
      '003_create_customer_pocket_mappings.sql',
    ];

    for (const migrationFile of migrations) {
      const migrationPath = path.join(__dirname, `../../src/migrations/${migrationFile}`);
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
      await pool.query(migrationSQL);
    }

    console.log('Test database setup complete');
  } catch (error) {
    console.error('Test database setup failed:', error);
    throw error;
  }
}

/**
 * Clean up test data between tests
 */
async function cleanupTestData() {
  try {
    await pool.query('TRUNCATE TABLE customer_pocket_mappings RESTART IDENTITY CASCADE;');
    await pool.query('TRUNCATE TABLE branches CASCADE;');
    await pool.query('TRUNCATE TABLE jobs RESTART IDENTITY CASCADE;');
    await pool.query('TRUNCATE TABLE config_audit RESTART IDENTITY CASCADE;');
    await pool.query(`
      UPDATE config
      SET
        origin_lat = 8.0,
        origin_lon = 68.0,
        alphabet = '0123456789ABCDEFGHJKLMNPQRSTUV',
        grid_levels = '[500000, 100000, 20000, 5000, 1000]'::jsonb,
        version = 1
      WHERE id = 1;
    `);
  } catch (error) {
    console.error('Test data cleanup failed:', error);
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
