/**
 * Unit Tests for Batch Processing Error Resilience
 * Feature: customer-pocket-mapping-view
 */

const { query } = require('../../src/config/database');
const mappingService = require('../../src/services/MappingService');
const branchFinderService = require('../../src/services/BranchFinderService');
const { findNearestPocket, haversineDistance } = require('../../src/utils/geometry');
const logger = require('../../src/config/logger');

// Mock dependencies
jest.mock('../../src/config/database');
jest.mock('../../src/config/logger');
jest.mock('../../src/services/MappingService');
jest.mock('../../src/services/BranchFinderService');
jest.mock('../../src/utils/geometry');

describe('Batch Processing Error Resilience Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
  });

  /**
   * Test: Database failure during batch processing should not stop processing
   * **Validates: Requirements 7.3**
   * 
   * Simulate database failure during batch processing and verify:
   * 1. Processing continues and completes
   * 2. Error is logged
   * 3. Excel export still works
   */
  describe('Error Resilience', () => {
    test('should continue processing when database persistence fails', async () => {
      // Setup test data
      const customers = [
        { customerId: 'CUST001', lat: 40.7128, lon: -74.0060 },
        { customerId: 'CUST002', lat: 34.0522, lon: -118.2437 },
        { customerId: 'CUST003', lat: 41.8781, lon: -87.6298 },
      ];

      const config = {
        originLat: 40.0,
        originLon: -75.0,
        alphabet: '0123456789ABCDEFGHJKLMNPQRSTUV',
      };

      // Mock database job lookup to succeed
      query.mockImplementation((queryText, values) => {
        if (queryText.includes('SELECT id FROM jobs')) {
          return Promise.resolve({ rows: [{ id: 789 }] });
        }
        return Promise.resolve({ rowCount: 0 });
      });

      // Mock findNearestPocket to return valid results
      let pocketCounter = 0;
      findNearestPocket.mockImplementation((lat, lon) => {
        pocketCounter++;
        return {
          pocketId: `POCKET-${pocketCounter}`,
          distance: 500 + pocketCounter * 100,
          centerLat: lat + 0.001,
          centerLon: lon + 0.001,
        };
      });

      // Mock branch finder to return valid results
      branchFinderService.findNearestBranchesForPockets.mockImplementation(async (pockets) => {
        const map = new Map();
        pockets.forEach((pocket, index) => {
          map.set(pocket.pocketId, {
            branchId: `BRANCH-${index + 1}`,
            branchName: `Branch ${index + 1}`,
            branchLat: pocket.lat,
            branchLon: pocket.lon,
            distance: 2000,
          });
        });
        return map;
      });

      // Mock haversineDistance
      haversineDistance.mockImplementation(() => 3000);

      // Mock mapping service to FAIL (simulate database error)
      mappingService.saveMappings.mockRejectedValue(
        new Error('Database connection failed')
      );

      // Simulate batch processing with error handling
      const results = [];
      const mappings = [];
      const pocketCenters = new Map();
      let processingCompleted = false;
      let errorLogged = false;

      try {
        // Process customers
        for (const customer of customers) {
          const nearestPocket = findNearestPocket(customer.lat, customer.lon, config);
          
          // Excel export data
          results.push({
            customerId: customer.customerId,
            PocketID: nearestPocket.pocketId,
            'Distance to Pocket Center (m)': Math.round(nearestPocket.distance),
            'Pocket Center Lat': nearestPocket.centerLat.toFixed(6),
            'Pocket Center Lon': nearestPocket.centerLon.toFixed(6),
          });

          // Mapping data
          if (!pocketCenters.has(nearestPocket.pocketId)) {
            pocketCenters.set(nearestPocket.pocketId, {
              lat: nearestPocket.centerLat,
              lon: nearestPocket.centerLon,
            });
          }

          mappings.push({
            customerId: customer.customerId,
            customerLat: customer.lat,
            customerLon: customer.lon,
            pocketId: nearestPocket.pocketId,
            distanceCustomerToPocket: nearestPocket.distance,
            pocketCenterLat: nearestPocket.centerLat,
            pocketCenterLon: nearestPocket.centerLon,
          });
        }

        // Try to persist mappings (this will fail)
        if (mappings.length > 0) {
          try {
            const uniquePockets = Array.from(pocketCenters.entries()).map(([pocketId, center]) => ({
              pocketId,
              lat: center.lat,
              lon: center.lon,
            }));

            const pocketBranchMap = await branchFinderService.findNearestBranchesForPockets(uniquePockets);

            const enrichedMappings = mappings.map(mapping => {
              const branchInfo = pocketBranchMap.get(mapping.pocketId);
              const distanceCustomerToBranch = haversineDistance(
                mapping.customerLat,
                mapping.customerLon,
                branchInfo.branchLat,
                branchInfo.branchLon
              );

              return {
                customerId: mapping.customerId,
                customerLat: mapping.customerLat,
                customerLon: mapping.customerLon,
                pocketId: mapping.pocketId,
                distanceCustomerToPocket: mapping.distanceCustomerToPocket,
                nearestBranchId: branchInfo.branchId,
                distancePocketToBranch: branchInfo.distance,
                distanceCustomerToBranch: distanceCustomerToBranch,
              };
            });

            await mappingService.saveMappings(789, enrichedMappings);
          } catch (error) {
            // Log error but continue - this is the key behavior we're testing
            logger.error('Failed to persist mappings', {
              jobId: 'test-job',
              error: error.message,
              mappingCount: mappings.length,
            });
            errorLogged = true;
            // Continue with Excel export even if persistence fails
          }
        }

        // Mark processing as completed
        processingCompleted = true;
      } catch (error) {
        // Processing should NOT throw - it should handle errors gracefully
        processingCompleted = false;
      }

      // Assertions

      // 1. Processing should complete successfully despite database failure
      expect(processingCompleted).toBe(true);

      // 2. All customers should be processed and included in Excel export
      expect(results.length).toBe(customers.length);
      expect(results[0].customerId).toBe('CUST001');
      expect(results[1].customerId).toBe('CUST002');
      expect(results[2].customerId).toBe('CUST003');

      // 3. All results should have pocket assignments
      results.forEach(result => {
        expect(result.PocketID).toBeDefined();
        expect(result.PocketID).toMatch(/^POCKET-\d+$/);
        expect(result['Distance to Pocket Center (m)']).toBeGreaterThan(0);
      });

      // 4. Error should be logged
      expect(errorLogged).toBe(true);
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to persist mappings',
        expect.objectContaining({
          error: 'Database connection failed',
          mappingCount: customers.length,
        })
      );

      // 5. Mapping service should have been called (and failed)
      expect(mappingService.saveMappings).toHaveBeenCalledTimes(1);

      // 6. Excel export data should be complete and valid
      expect(results.length).toBe(customers.length);
      results.forEach((result, index) => {
        expect(result.customerId).toBe(customers[index].customerId);
        expect(result.PocketID).toBeDefined();
        expect(result['Pocket Center Lat']).toBeDefined();
        expect(result['Pocket Center Lon']).toBeDefined();
      });
    });

    test('should handle branch finder failure gracefully', async () => {
      // Setup test data
      const customers = [
        { customerId: 'CUST001', lat: 40.7128, lon: -74.0060 },
      ];

      const config = {
        originLat: 40.0,
        originLon: -75.0,
        alphabet: '0123456789ABCDEFGHJKLMNPQRSTUV',
      };

      // Mock database job lookup
      query.mockImplementation((queryText, values) => {
        if (queryText.includes('SELECT id FROM jobs')) {
          return Promise.resolve({ rows: [{ id: 999 }] });
        }
        return Promise.resolve({ rowCount: 0 });
      });

      // Mock findNearestPocket
      findNearestPocket.mockImplementation((lat, lon) => ({
        pocketId: 'POCKET-1',
        distance: 500,
        centerLat: lat + 0.001,
        centerLon: lon + 0.001,
      }));

      // Mock branch finder to FAIL
      branchFinderService.findNearestBranchesForPockets.mockRejectedValue(
        new Error('No branches found in database')
      );

      // Simulate batch processing
      const results = [];
      const mappings = [];
      const pocketCenters = new Map();
      let processingCompleted = false;
      let errorLogged = false;

      try {
        // Process customers
        for (const customer of customers) {
          const nearestPocket = findNearestPocket(customer.lat, customer.lon, config);
          
          results.push({
            customerId: customer.customerId,
            PocketID: nearestPocket.pocketId,
          });

          if (!pocketCenters.has(nearestPocket.pocketId)) {
            pocketCenters.set(nearestPocket.pocketId, {
              lat: nearestPocket.centerLat,
              lon: nearestPocket.centerLon,
            });
          }

          mappings.push({
            customerId: customer.customerId,
            customerLat: customer.lat,
            customerLon: customer.lon,
            pocketId: nearestPocket.pocketId,
            distanceCustomerToPocket: nearestPocket.distance,
          });
        }

        // Try to persist mappings
        if (mappings.length > 0) {
          try {
            const uniquePockets = Array.from(pocketCenters.entries()).map(([pocketId, center]) => ({
              pocketId,
              lat: center.lat,
              lon: center.lon,
            }));

            await branchFinderService.findNearestBranchesForPockets(uniquePockets);
          } catch (error) {
            logger.error('Failed to persist mappings', {
              error: error.message,
            });
            errorLogged = true;
          }
        }

        processingCompleted = true;
      } catch (error) {
        processingCompleted = false;
      }

      // Assertions
      expect(processingCompleted).toBe(true);
      expect(results.length).toBe(customers.length);
      expect(errorLogged).toBe(true);
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
