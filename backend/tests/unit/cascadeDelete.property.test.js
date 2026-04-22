/**
 * Property Test: Cascade Deletion Integrity
 * Validates: Requirements 8.3
 * 
 * Property 20: When a job is deleted, all associated customer mappings must be deleted
 */

const fc = require('fast-check');
const { query } = require('../../src/config/database');
const mappingService = require('../../src/services/MappingService');
const {
  setupTestDatabase,
  teardownTestDatabase,
} = require('../integration/setup');

const ensureTestBranches = async () => {
  await query(`
    INSERT INTO branches (id, city, lat, lon, pocket_id)
    VALUES
      ('branch-1', 'Test Branch 1', 8.1, 68.1, 'TEST-1'),
      ('branch-2', 'Test Branch 2', 8.2, 68.2, 'TEST-2'),
      ('branch-3', 'Test Branch 3', 8.3, 68.3, 'TEST-3')
    ON CONFLICT (id) DO UPDATE
    SET
      city = EXCLUDED.city,
      lat = EXCLUDED.lat,
      lon = EXCLUDED.lon,
      pocket_id = EXCLUDED.pocket_id
  `);
};

describe('Property 20: Cascade Deletion Integrity', () => {
  beforeAll(async () => {
    await setupTestDatabase();
    await ensureTestBranches();
    // Clean up test data
    await query('DELETE FROM customer_pocket_mappings WHERE job_id LIKE $1', ['test-cascade-%']);
    await query('DELETE FROM jobs WHERE job_id LIKE $1', ['test-cascade-%']);
  });

  afterAll(async () => {
    // Clean up test data
    await query('DELETE FROM customer_pocket_mappings WHERE job_id LIKE $1', ['test-cascade-%']);
    await query('DELETE FROM jobs WHERE job_id LIKE $1', ['test-cascade-%']);
    await teardownTestDatabase();
  });

  it('should delete all mappings when job is deleted (CASCADE)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            customerId: fc.string({ minLength: 1, maxLength: 50 }),
            customerLat: fc.double({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true }),
            customerLon: fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true }),
            pocketId: fc.string({ minLength: 1, maxLength: 20 }),
            distanceCustomerToPocket: fc.double({ min: 0, max: 50000, noNaN: true, noDefaultInfinity: true }),
            nearestBranchId: fc.constantFrom('branch-1', 'branch-2', 'branch-3'),
            distancePocketToBranch: fc.double({ min: 0, max: 50000, noNaN: true, noDefaultInfinity: true }),
            distanceCustomerToBranch: fc.double({ min: 0, max: 50000, noNaN: true, noDefaultInfinity: true }),
          }),
          { minLength: 1, maxLength: 20 }
        ),
        async (mappings) => {
          const jobId = `test-cascade-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

          // Create test job
          await query(
            'INSERT INTO jobs (job_id, type, status, created_at) VALUES ($1, $2, $3, NOW())',
            [jobId, 'batch-process', 'completed']
          );

          // Save mappings
          await mappingService.saveMappings(jobId, mappings);

          // Verify mappings exist
          const beforeDelete = await query(
            'SELECT COUNT(*) as count FROM customer_pocket_mappings WHERE job_id = $1',
            [jobId]
          );
          const countBefore = parseInt(beforeDelete.rows[0].count, 10);
          expect(countBefore).toBe(mappings.length);

          // Delete the job (should CASCADE delete mappings)
          await query('DELETE FROM jobs WHERE job_id = $1', [jobId]);

          // Property: All associated mappings must be deleted
          const afterDelete = await query(
            'SELECT COUNT(*) as count FROM customer_pocket_mappings WHERE job_id = $1',
            [jobId]
          );
          const countAfter = parseInt(afterDelete.rows[0].count, 10);
          expect(countAfter).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  }, 15000);

  it('should only delete mappings for the specific job', async () => {
    const jobId1 = `test-cascade-multi-1-${Date.now()}`;
    const jobId2 = `test-cascade-multi-2-${Date.now()}`;

    // Create two test jobs
    await query(
      'INSERT INTO jobs (job_id, type, status, created_at) VALUES ($1, $2, $3, NOW())',
      [jobId1, 'batch-process', 'completed']
    );
    await query(
      'INSERT INTO jobs (job_id, type, status, created_at) VALUES ($1, $2, $3, NOW())',
      [jobId2, 'batch-process', 'completed']
    );

    // Create mappings for both jobs
    const mappings1 = [
      {
        customerId: 'cust-1',
        customerLat: 40.7128,
        customerLon: -74.006,
        pocketId: 'pocket-1',
        distanceCustomerToPocket: 100,
        nearestBranchId: 'branch-1',
        distancePocketToBranch: 200,
        distanceCustomerToBranch: 300,
      },
    ];

    const mappings2 = [
      {
        customerId: 'cust-2',
        customerLat: 40.7589,
        customerLon: -73.9851,
        pocketId: 'pocket-2',
        distanceCustomerToPocket: 150,
        nearestBranchId: 'branch-2',
        distancePocketToBranch: 250,
        distanceCustomerToBranch: 350,
      },
    ];

    await mappingService.saveMappings(jobId1, mappings1);
    await mappingService.saveMappings(jobId2, mappings2);

    // Delete job1
    await query('DELETE FROM jobs WHERE job_id = $1', [jobId1]);

    // Property: Only job1 mappings should be deleted
    const job1Count = await query(
      'SELECT COUNT(*) as count FROM customer_pocket_mappings WHERE job_id = $1',
      [jobId1]
    );
    expect(parseInt(job1Count.rows[0].count, 10)).toBe(0);

    const job2Count = await query(
      'SELECT COUNT(*) as count FROM customer_pocket_mappings WHERE job_id = $1',
      [jobId2]
    );
    expect(parseInt(job2Count.rows[0].count, 10)).toBe(1);

    // Clean up
    await query('DELETE FROM customer_pocket_mappings WHERE job_id = $1', [jobId2]);
    await query('DELETE FROM jobs WHERE job_id = $1', [jobId2]);
  });
});
