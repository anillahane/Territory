require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const logger = require('../config/logger');

async function runMigrations() {
  try {
    logger.info('Starting database migrations...');

    const migrationFiles = fs
      .readdirSync(__dirname)
      .filter((fileName) => /^\d+.*\.sql$/.test(fileName))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

    for (const migrationFileName of migrationFiles) {
      const migrationPath = path.join(__dirname, migrationFileName);
      const sql = fs.readFileSync(migrationPath, 'utf8');
      logger.info(`Running migration: ${migrationFileName}`);
      await pool.query(sql);
    }

    logger.info('Database migrations completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exit(1);
  }
}

runMigrations();
