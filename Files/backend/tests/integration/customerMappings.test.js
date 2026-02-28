/**
 * Integration Tests for Customer Pocket Mappings Database Schema
 * Tests foreign key constraints, cascade deletion, and index existence
 */

const { query } = require('../../src/config/database');

describe('Customer Pocket Mappings Schema', () => {
  let testJobId;
  let testBranchId;

  beforeAll(async () => {
    // Create a test job
    const jobResult = await query(
      `INSERT INTO jobs (job_id, type, status, total)
       VALUES ($1, 'test_batch', 'completed', 100)
       RETURNING job_id`,
      ['test-job-' + Date.now()]
    );
    testJobId = jobResult.rows[0].job_id;

    // Create a test branch
    testBranchId = 'TEST-BRANCH-' + Date.now();
    await query(
      `INSERT INTO branches (id, city, lat, lon)
       VALUES ($1, 'Test City', 12.9716, 77.5946)`,
      [testBranchId]
    );
  });

  afterAll(async () => {
    // Cleanup test data
    await query('DELETE FROM customer_pocket_mappings WHERE job_id = $1', [testJobId]);
    await query('DELETE FROM jobs WHERE job_id = $1', [testJobId]);
    await query('DELETE FROM branches WHERE id = $1', [testBranchId]);
  });

  afterEach(async () => {
    // Clean up mappings after each test
    await query('DELETE FROM customer_pocket_mappings WHERE job_id = $1', [testJobId]);
  });

  describe('Table Structure', () => {
    test('should have customer_pocket_mappings table', async () => {
      const result = await query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'customer_pocket_mappings'
        )`
      );
      expect(result.rows[0].exists).toBe(true);
    });

    test('should have all required columns', async () => {
      const result = await query(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_name = 'customer_pocket_mappings'
         ORDER BY ordinal_position`
      );

      const columns = result.rows.map(row => row.column_name);
      expect(columns).toContain('id');
      expect(columns).toContain('job_id');
      expect(columns).toContain('customer_id');
      expect(columns).toContain('customer_lat');
      expect(columns).toContain('customer_lon');
      expect(columns).toContain('pocket_id');
      expect(columns).toContain('distance_customer_to_pocket');
      expect(columns).toContain('nearest_branch_id');
      expect(columns).toContain('distance_pocket_to_branch');
      expect(columns).toContain('distance_customer_to_branch');
      expect(columns).toContain('created_at');
    });
  });

  describe('Foreign Key Constraints', () => {
    test('should enforce foreign key constraint on job_id', async () => {
      await expect(
        query(
          `INSERT INTO customer_pocket_mappings 
           (job_id, customer_id, customer_lat, customer_lon, pocket_id, 
            distance_customer_to_pocket, nearest_branch_id, 
            distance_pocket_to_branch, distance_customer_to_branch)
           VALUES ($1, 'CUST001', 12.9716, 77.5946, 'PKT001', 100.50, $2, 200.75, 150.25)`,
          ['non-existent-job-id', testBranchId]
        )
      ).rejects.toThrow();
    });

    test('should enforce foreign key constraint on nearest_branch_id', async () => {
      await expect(
        query(
          `INSERT INTO customer_pocket_mappings 
           (job_id, customer_id, customer_lat, customer_lon, pocket_id, 
            distance_customer_to_pocket, nearest_branch_id, 
            distance_pocket_to_branch, distance_customer_to_branch)
           VALUES ($1, 'CUST001', 12.9716, 77.5946, 'PKT001', 100.50, 'NON-EXISTENT-BRANCH', 200.75, 150.25)`,
          [testJobId]
        )
      ).rejects.toThrow();
    });

    test('should allow valid foreign keys', async () => {
      const result = await query(
        `INSERT INTO customer_pocket_mappings 
         (job_id, customer_id, customer_lat, customer_lon, pocket_id, 
          distance_customer_to_pocket, nearest_branch_id, 
          distance_pocket_to_branch, distance_customer_to_branch)
         VALUES ($1, 'CUST001', 12.9716, 77.5946, 'PKT001', 100.50, $2, 200.75, 150.25)
         RETURNING id`,
        [testJobId, testBranchId]
      );

      expect(result.rows[0].id).toBeDefined();
    });
  });

  describe('Cascade Deletion', () => {
    test('should cascade delete mappings when job is deleted', async () => {
      // Create a temporary job
      const tempJobResult = await query(
        `INSERT INTO jobs (job_id, type, status, total)
         VALUES ($1, 'temp_batch', 'completed', 50)
         RETURNING job_id`,
        ['temp-job-' + Date.now()]
      );
      const tempJobId = tempJobResult.rows[0].job_id;

      // Insert mapping for temp job
      await query(
        `INSERT INTO customer_pocket_mappings 
         (job_id, customer_id, customer_lat, customer_lon, pocket_id, 
          distance_customer_to_pocket, nearest_branch_id, 
          distance_pocket_to_branch, distance_customer_to_branch)
         VALUES ($1, 'CUST002', 12.9716, 77.5946, 'PKT002', 100.50, $2, 200.75, 150.25)`,
        [tempJobId, testBranchId]
      );

      // Verify mapping exists
      let mappingCheck = await query(
        'SELECT COUNT(*) as count FROM customer_pocket_mappings WHERE job_id = $1',
        [tempJobId]
      );
      expect(parseInt(mappingCheck.rows[0].count)).toBe(1);

      // Delete the job
      await query('DELETE FROM jobs WHERE job_id = $1', [tempJobId]);

      // Verify mapping was cascade deleted
      mappingCheck = await query(
        'SELECT COUNT(*) as count FROM customer_pocket_mappings WHERE job_id = $1',
        [tempJobId]
      );
      expect(parseInt(mappingCheck.rows[0].count)).toBe(0);
    });

    test('should prevent deletion of branch with associated mappings', async () => {
      // Insert mapping
      await query(
        `INSERT INTO customer_pocket_mappings 
         (job_id, customer_id, customer_lat, customer_lon, pocket_id, 
          distance_customer_to_pocket, nearest_branch_id, 
          distance_pocket_to_branch, distance_customer_to_branch)
         VALUES ($1, 'CUST003', 12.9716, 77.5946, 'PKT003', 100.50, $2, 200.75, 150.25)`,
        [testJobId, testBranchId]
      );

      // Try to delete the branch - should fail due to RESTRICT constraint
      await expect(
        query('DELETE FROM branches WHERE id = $1', [testBranchId])
      ).rejects.toThrow();
    });
  });

  describe('Indexes', () => {
    test('should have index on job_id', async () => {
      const result = await query(
        `SELECT indexname FROM pg_indexes 
         WHERE tablename = 'customer_pocket_mappings' 
         AND indexname = 'idx_customer_mappings_job_id'`
      );
      expect(result.rows.length).toBe(1);
    });

    test('should have index on customer_id', async () => {
      const result = await query(
        `SELECT indexname FROM pg_indexes 
         WHERE tablename = 'customer_pocket_mappings' 
         AND indexname = 'idx_customer_mappings_customer_id'`
      );
      expect(result.rows.length).toBe(1);
    });

    test('should have index on pocket_id', async () => {
      const result = await query(
        `SELECT indexname FROM pg_indexes 
         WHERE tablename = 'customer_pocket_mappings' 
         AND indexname = 'idx_customer_mappings_pocket_id'`
      );
      expect(result.rows.length).toBe(1);
    });

    test('should have index on created_at', async () => {
      const result = await query(
        `SELECT indexname FROM pg_indexes 
         WHERE tablename = 'customer_pocket_mappings' 
         AND indexname = 'idx_customer_mappings_created_at'`
      );
      expect(result.rows.length).toBe(1);
    });

    test('should have composite index on job_id and pocket_id', async () => {
      const result = await query(
        `SELECT indexname FROM pg_indexes 
         WHERE tablename = 'customer_pocket_mappings' 
         AND indexname = 'idx_customer_mappings_job_pocket'`
      );
      expect(result.rows.length).toBe(1);
    });
  });

  describe('Validation Constraints', () => {
    test('should reject invalid latitude (> 90)', async () => {
      await expect(
        query(
          `INSERT INTO customer_pocket_mappings 
           (job_id, customer_id, customer_lat, customer_lon, pocket_id, 
            distance_customer_to_pocket, nearest_branch_id, 
            distance_pocket_to_branch, distance_customer_to_branch)
           VALUES ($1, 'CUST004', 91.0, 77.5946, 'PKT004', 100.50, $2, 200.75, 150.25)`,
          [testJobId, testBranchId]
        )
      ).rejects.toThrow();
    });

    test('should reject invalid latitude (< -90)', async () => {
      await expect(
        query(
          `INSERT INTO customer_pocket_mappings 
           (job_id, customer_id, customer_lat, customer_lon, pocket_id, 
            distance_customer_to_pocket, nearest_branch_id, 
            distance_pocket_to_branch, distance_customer_to_branch)
           VALUES ($1, 'CUST005', -91.0, 77.5946, 'PKT005', 100.50, $2, 200.75, 150.25)`,
          [testJobId, testBranchId]
        )
      ).rejects.toThrow();
    });

    test('should reject invalid longitude (> 180)', async () => {
      await expect(
        query(
          `INSERT INTO customer_pocket_mappings 
           (job_id, customer_id, customer_lat, customer_lon, pocket_id, 
            distance_customer_to_pocket, nearest_branch_id, 
            distance_pocket_to_branch, distance_customer_to_branch)
           VALUES ($1, 'CUST006', 12.9716, 181.0, 'PKT006', 100.50, $2, 200.75, 150.25)`,
          [testJobId, testBranchId]
        )
      ).rejects.toThrow();
    });

    test('should reject negative distances', async () => {
      await expect(
        query(
          `INSERT INTO customer_pocket_mappings 
           (job_id, customer_id, customer_lat, customer_lon, pocket_id, 
            distance_customer_to_pocket, nearest_branch_id, 
            distance_pocket_to_branch, distance_customer_to_branch)
           VALUES ($1, 'CUST007', 12.9716, 77.5946, 'PKT007', -100.50, $2, 200.75, 150.25)`,
          [testJobId, testBranchId]
        )
      ).rejects.toThrow();
    });

    test('should accept valid coordinates and distances', async () => {
      const result = await query(
        `INSERT INTO customer_pocket_mappings 
         (job_id, customer_id, customer_lat, customer_lon, pocket_id, 
          distance_customer_to_pocket, nearest_branch_id, 
          distance_pocket_to_branch, distance_customer_to_branch)
         VALUES ($1, 'CUST008', 12.9716, 77.5946, 'PKT008', 100.50, $2, 200.75, 150.25)
         RETURNING id`,
        [testJobId, testBranchId]
      );

      expect(result.rows[0].id).toBeDefined();
    });
  });

  describe('Default Values', () => {
    test('should auto-generate id', async () => {
      const result = await query(
        `INSERT INTO customer_pocket_mappings 
         (job_id, customer_id, customer_lat, customer_lon, pocket_id, 
          distance_customer_to_pocket, nearest_branch_id, 
          distance_pocket_to_branch, distance_customer_to_branch)
         VALUES ($1, 'CUST009', 12.9716, 77.5946, 'PKT009', 100.50, $2, 200.75, 150.25)
         RETURNING id`,
        [testJobId, testBranchId]
      );

      expect(result.rows[0].id).toBeGreaterThan(0);
    });

    test('should auto-set created_at timestamp', async () => {
      const beforeInsert = new Date();
      
      const result = await query(
        `INSERT INTO customer_pocket_mappings 
         (job_id, customer_id, customer_lat, customer_lon, pocket_id, 
          distance_customer_to_pocket, nearest_branch_id, 
          distance_pocket_to_branch, distance_customer_to_branch)
         VALUES ($1, 'CUST010', 12.9716, 77.5946, 'PKT010', 100.50, $2, 200.75, 150.25)
         RETURNING created_at`,
        [testJobId, testBranchId]
      );

      const createdAt = new Date(result.rows[0].created_at);
      expect(createdAt).toBeInstanceOf(Date);
      expect(createdAt.getTime()).toBeGreaterThanOrEqual(beforeInsert.getTime() - 1000);
      expect(createdAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });
  });
});

