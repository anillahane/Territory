require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const logger = require('../config/logger');

const MIGRATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

async function runMigrations() {
  const client = await pool.connect();

  try {
    logger.info('Starting database migrations...');
    await client.query(MIGRATIONS_TABLE_SQL);

    const migrationFiles = fs
      .readdirSync(__dirname)
      .filter((fileName) => /^\d+.*\.sql$/i.test(fileName))
      .sort();

    const appliedResult = await client.query('SELECT filename FROM schema_migrations');
    const appliedMigrations = new Set(appliedResult.rows.map((row) => row.filename));

    for (const fileName of migrationFiles) {
      if (appliedMigrations.has(fileName)) {
        continue;
      }

      const filePath = path.join(__dirname, fileName);
      const sql = fs.readFileSync(filePath, 'utf8');

      logger.info(`Applying migration ${fileName}`);
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
        [fileName]
      );
      await client.query('COMMIT');
    }

    logger.info('Database migrations completed successfully');
    process.exit(0);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Migration failed:', error);
    process.exit(1);
  } finally {
    client.release();
  }
}

runMigrations();
