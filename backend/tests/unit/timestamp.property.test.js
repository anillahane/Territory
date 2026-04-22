/**
 * Property Test: Timestamp Presence
 * Validates: Requirements 8.1
 * 
 * Property 18: All customer mappings must have a valid created_at timestamp
 */

const fc = require('fast-check');
const { query } = require('../../src/config/database');
const mappingService = require('../../src/services/MappingService');

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

describe('Property 18: Timestamp Presence', () => {

  beforeAll(async () => {
    await ensureTestBranches();
    // Clean up test data
    await query('DELETE FROM customer_pocket_mappings WHERE job_id LIKE $1', ['test-timestamp-%']);
    await query('DELETE FROM jobs WHERE job_id LIKE $1', ['test-timestamp-%']);
  });

  afterAll(async () => {
    // Clean up test data
    await query('DELETE FROM customer_pocket_mappings WHERE job_id LIKE $1', ['test-timestamp-%']);
    await query('DELETE FROM jobs WHERE job_id LIKE $1', ['test-timestamp-%']);
  });

  it('should ensure all mappings have valid created_at timestamps', async () => {
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
          { minLength: 1, maxLength: 10 }
        ),
        async (mappings) => {
          const jobId = `test-timestamp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

          // Create test job
          await query(
            'INSERT INTO jobs (job_id, type, status, created_at) VALUES ($1, $2, $3, NOW())',
            [jobId, 'batch-process', 'completed']
          );

          // Save mappings
          await mappingService.saveMappings(jobId, mappings);

          // Retrieve mappings
          const result = await mappingService.getMappings({ jobId });

          // Property: All mappings must have a valid created_at timestamp
          result.data.forEach((mapping) => {
            // Timestamp must exist
            expect(mapping.createdAt).toBeDefined();
            expect(mapping.createdAt).not.toBeNull();

            // Timestamp must be a valid date
            const timestamp = new Date(mapping.createdAt);
            expect(timestamp).toBeInstanceOf(Date);
            expect(timestamp.getTime()).not.toBeNaN();

            // Timestamp must be plausible and not far in the future.
            const timestampMs = timestamp.getTime();
            const nowMs = Date.now();
            expect(timestampMs).toBeGreaterThan(new Date('2000-01-01T00:00:00.000Z').getTime());
            expect(timestampMs).toBeLessThanOrEqual(nowMs + 24 * 60 * 60 * 1000);
          });

          // Clean up
          await query('DELETE FROM customer_pocket_mappings WHERE job_id = $1', [jobId]);
          await query('DELETE FROM jobs WHERE job_id = $1', [jobId]);
        }
      ),
      { numRuns: 100 }
    );
  }, 120000);

  it('should preserve timestamp order for sequential inserts', async () => {
    const jobId = `test-timestamp-order-${Date.now()}`;

    // Create test job
    await query(
      'INSERT INTO jobs (job_id, type, status, created_at) VALUES ($1, $2, $3, NOW())',
      [jobId, 'batch-process', 'completed']
    );

    // Insert mappings in batches with small delays
    const batch1 = [
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

    await mappingService.saveMappings(jobId, batch1);
    await new Promise((resolve) => setTimeout(resolve, 100)); // Small delay

    const batch2 = [
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

    await mappingService.saveMappings(jobId, batch2);

    // Retrieve all mappings
    const result = await mappingService.getMappings({ jobId });

    // Property: Timestamps should reflect insertion order
    expect(result.data.length).toBe(2);
    const timestamp1 = new Date(result.data[0].createdAt);
    const timestamp2 = new Date(result.data[1].createdAt);

    // Second batch should have equal or later timestamp
    expect(timestamp2.getTime()).toBeGreaterThanOrEqual(timestamp1.getTime());

    // Clean up
    await query('DELETE FROM customer_pocket_mappings WHERE job_id = $1', [jobId]);
    await query('DELETE FROM jobs WHERE job_id = $1', [jobId]);
  });
});
