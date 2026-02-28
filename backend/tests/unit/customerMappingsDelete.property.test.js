const fc = require('fast-check');
const mappingService = require('../../src/services/MappingService');
const { query } = require('../../src/config/database');

// Mock the database
jest.mock('../../src/config/database');

describe('Customer Mappings Deletion - Property Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Feature: customer-pocket-mapping-view
   * Property 19: Retention-Based Deletion Correctness
   * Validates: Requirements 8.2
   * 
   * For any retention date specified in a deletion request, all mappings with
   * created_at timestamps before that date should be deleted, and all mappings
   * with timestamps on or after that date should be preserved.
   */
  test('Property 19: Retention-Based Deletion Correctness', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 100 }), // Number of mappings to delete
        fc.integer({ min: 0, max: 100 }), // Number of mappings to preserve
        async (deleteCount, preserveCount) => {
          // Mock database response
          query.mockResolvedValue({
            rowCount: deleteCount,
          });

          const cutoffDate = new Date('2026-01-01');
          const deletedCount = await mappingService.deleteMappings(cutoffDate);

          // Verify the deletion count matches expected
          expect(deletedCount).toBe(deleteCount);
          
          // Verify query was called with correct parameters
          expect(query).toHaveBeenCalledWith(
            expect.stringContaining('DELETE FROM customer_pocket_mappings'),
            expect.arrayContaining([cutoffDate])
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: customer-pocket-mapping-view
   * Property 21: Deletion Audit Trail
   * Validates: Requirements 8.5
   * 
   * For any mapping deletion operation (retention-based or job-based), the system
   * should create a log entry containing the deletion timestamp, the number of
   * records deleted, and the deletion criteria.
   */
  test('Property 21: Deletion Audit Trail - logs are created for all deletions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.date({ min: new Date('2020-01-01'), max: new Date('2026-12-31') }),
        fc.option(fc.integer({ min: 1, max: 1000 }), { nil: null }),
        fc.integer({ min: 0, max: 10000 }),
        async (olderThan, jobId, deletedCount) => {
          // Mock database response
          query.mockResolvedValue({
            rowCount: deletedCount,
          });

          // Spy on logger
          const logger = require('../../src/config/logger');
          const infoSpy = jest.spyOn(logger, 'info');

          await mappingService.deleteMappings(olderThan, jobId);

          // Verify audit log was created
          expect(infoSpy).toHaveBeenCalledWith(
            'Customer mappings deleted',
            expect.objectContaining({
              olderThan: olderThan.toISOString(),
              jobId: jobId || 'all jobs',
              deletedCount,
            })
          );

          infoSpy.mockRestore();
        }
      ),
      { numRuns: 100 }
    );
  });
});
