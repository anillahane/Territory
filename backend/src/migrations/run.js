require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const logger = require('../config/logger');

async function tableExists(tableName) {
  const result = await pool.query(
    "SELECT to_regclass($1) AS table_ref",
    [`public.${tableName}`]
  );
  return Boolean(result.rows[0].table_ref);
}

async function columnExists(tableName, columnName) {
  const result = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND column_name = $2
     LIMIT 1`,
    [tableName, columnName]
  );
  return result.rowCount > 0;
}

async function markMigrationAsApplied(filename) {
  await pool.query(
    `INSERT INTO schema_migrations (filename)
     VALUES ($1)
     ON CONFLICT (filename) DO NOTHING`,
    [filename]
  );
}

async function bootstrapExistingMigrations() {
  const countResult = await pool.query('SELECT COUNT(*)::int AS count FROM schema_migrations');
  if (countResult.rows[0].count > 0) {
    return;
  }

  const hasConfig = await tableExists('config');
  const hasBranches = await tableExists('branches');
  const hasJobs = await tableExists('jobs');
  if (hasConfig && hasBranches && hasJobs) {
    await markMigrationAsApplied('001_initial_schema.sql');
    logger.info('Bootstrapped migration state: 001_initial_schema.sql');
  }

  const hasJobsDataColumn = await columnExists('jobs', 'data');
  if (hasJobsDataColumn) {
    await markMigrationAsApplied('002_add_jobs_data_column.sql');
    logger.info('Bootstrapped migration state: 002_add_jobs_data_column.sql');
  }

  const hasMappings = await tableExists('customer_pocket_mappings');
  if (hasMappings) {
    await markMigrationAsApplied('003_create_customer_pocket_mappings.sql');
    logger.info('Bootstrapped migration state: 003_create_customer_pocket_mappings.sql');
  }

  const hasGridCells = await tableExists('grid_cells');
  if (hasGridCells) {
    await markMigrationAsApplied('004_create_grid_cells.sql');
    logger.info('Bootstrapped migration state: 004_create_grid_cells.sql');
  }

  const hasGridGeom = await columnExists('grid_cells', 'geom');
  const hasGridLabelGeom = await columnExists('grid_cells', 'label_geom');
  if (hasGridGeom && hasGridLabelGeom) {
    await markMigrationAsApplied('005_add_grid_cell_geometries.sql');
    logger.info('Bootstrapped migration state: 005_add_grid_cell_geometries.sql');
  }
}

async function runMigrations() {
  try {
    logger.info('Starting database migrations...');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await bootstrapExistingMigrations();

    const migrationFiles = fs
      .readdirSync(__dirname)
      .filter((filename) => /^\d+.*\.sql$/.test(filename))
      .sort((a, b) => a.localeCompare(b));

    for (const filename of migrationFiles) {
      // eslint-disable-next-line no-await-in-loop
      const checkResult = await pool.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [filename]
      );

      if (checkResult.rowCount > 0) {
        logger.info(`Skipping already applied migration: ${filename}`);
        // eslint-disable-next-line no-continue
        continue;
      }

      const migrationPath = path.join(__dirname, filename);
      const sql = fs.readFileSync(migrationPath, 'utf8');

      // eslint-disable-next-line no-await-in-loop
      await pool.query(sql);
      // eslint-disable-next-line no-await-in-loop
      await pool.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [filename]
      );

      logger.info(`Applied migration: ${filename}`);
    }

    logger.info('Database migrations completed successfully');
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

runMigrations();
