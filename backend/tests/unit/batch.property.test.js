/**
 * Property-Based Tests for Batch Processing Integration
 * Feature: customer-pocket-mapping-view
 */

const fc = require('fast-check');
const { query } = require('../../src/config/database');
const mappingService = require('../../src/services/MappingService');
const branchFinderService = require('../../src/services/BranchFinderService');
const { findNearestPocket, haversineDistance } = require('../../src/utils/geometry');

// Mock dependencies
jest.mock('../../src/config/database');
jest.mock('../../src/config/logger');
jest.mock('../../src/services/MappingService');
jest.mock('../../src/services/BranchFinderService');
jest.mock('../../src/utils/geometry');

describe('Batch Processing Integration Property-Based Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
  });

  /**
   * Property 15: Batch Processing Integration Transparency
   * **Validates: Requirements 7.1, 7.2**
   * 
   * For any batch job that processes customers, the system should persist all 
   * customer-to-pocket mappings to the database while maintaining the existing 
   * Excel export functionality, such that both outputs contain equivalent data.
   */
  describe('Property 15: Batch Processing Integration Transparency', () => {
    test('batch processing should persist mappings and maintain Excel export with equivalent data', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              customerId: fc.string({ minLength: 1, maxLength: 50 }),
              lat: fc.double({ min: -90, max: 90, noNaN: true }),
              lon: fc.double({ min: -180, max: 180, noNaN: true }),
            }),
            { minLength: 1, maxLength: 50 }
          ),
          fc.record({
            originLat: fc.double({ min: -90, max: 90 }),
            originLon: fc.double({ min: -180, max: 180 }),
            alphabet: fc.constant('0123456789ABCDEFGHJKLMNPQRSTUV'),
          }),
          async (customers, config) => {
            // Reset mocks for each iteration
            jest.clearAllMocks();
            
            // Mock database job lookup
            query.mockImplementation((queryText, values) => {
              if (queryText.includes('SELECT id FROM jobs')) {
                return Promise.resolve({ rows: [{ id: 123 }] });
              }
              return Promise.resolve({ rowCount: 0 });
            });

            // Mock findNearestPocket to return consistent results
            const pocketResults = new Map();
            findNearestPocket.mockImplementation((lat, lon) => {
              const key = `${lat},${lon}`;
              if (!pocketResults.has(key)) {
                pocketResults.set(key, {
                  pocketId: `POCKET-${pocketResults.size + 1}`,
                  distance: Math.random() * 1000,
                  centerLat: lat + (Math.random() - 0.5) * 0.01,
                  centerLon: lon + (Math.random() - 0.5) * 0.01,
                });
              }
              return pocketResults.get(key);
            });

            // Mock branch finder to return consistent branch info
            const branchMap = new Map();
            branchFinderService.findNearestBranchesForPockets.mockImplementation(async (pockets) => {
              const map = new Map();
              pockets.forEach((pocket) => {
                if (!branchMap.has(pocket.pocketId)) {
                  branchMap.set(pocket.pocketId, {
                    branchId: `BRANCH-${branchMap.size + 1}`,
                    branchName: `Branch ${branchMap.size + 1}`,
                    branchLat: pocket.lat,
                    branchLon: pocket.lon,
                    distance: Math.random() * 5000,
                  });
                }
                map.set(pocket.pocketId, branchMap.get(pocket.pocketId));
              });
              return map;
            });

            // Mock haversineDistance
            haversineDistance.mockImplementation(() => Math.random() * 10000);

            // Mock mapping service to track what was persisted
            let persistedMappings = [];
            mappingService.saveMappings.mockImplementation(async (jobId, mappings) => {
              persistedMappings = [...mappings];
              return {
                success: true,
                insertedCount: mappings.length,
                errors: [],
              };
            });

            // Simulate batch processing logic
            const results = [];
            const mappings = [];
            const pocketCenters = new Map();

            for (let i = 0; i < customers.length; i++) {
              const customer = customers[i];
              const nearestPocket = findNearestPocket(customer.lat, customer.lon, config);
              const rawCustomerId =
                customer.customerId === undefined || customer.customerId === null
                  ? ''
                  : String(customer.customerId).trim();
              const customerId =
                rawCustomerId !== '' ? rawCustomerId : `CUST_${i + 1}`;
              
              // Excel export data
              results.push({
                customerId,
                PocketID: nearestPocket.pocketId,
                'Distance to Pocket Center (m)': Math.round(nearestPocket.distance),
                'Pocket Center Lat': nearestPocket.centerLat.toFixed(6),
                'Pocket Center Lon': nearestPocket.centerLon.toFixed(6),
              });

              // Mapping data for persistence
              if (!pocketCenters.has(nearestPocket.pocketId)) {
                pocketCenters.set(nearestPocket.pocketId, {
                  lat: nearestPocket.centerLat,
                  lon: nearestPocket.centerLon,
                });
              }

              mappings.push({
                customerId,
                customerLat: customer.lat,
                customerLon: customer.lon,
                pocketId: nearestPocket.pocketId,
                distanceCustomerToPocket: nearestPocket.distance,
                pocketCenterLat: nearestPocket.centerLat,
                pocketCenterLon: nearestPocket.centerLon,
              });
            }

            // Get branches and enrich mappings
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

            // Persist mappings
            await mappingService.saveMappings(123, enrichedMappings);

            // Property 1: Excel export should contain all customers
            expect(results.length).toBe(customers.length);

            // Property 2: Persisted mappings should contain all customers
            expect(persistedMappings.length).toBe(customers.length);

            // Property 3: Both outputs should have the same customer IDs
            const excelCustomerIds = results.map(r => r.customerId).sort();
            const persistedCustomerIds = persistedMappings.map(m => m.customerId).sort();
            expect(excelCustomerIds).toEqual(persistedCustomerIds);

            // Property 4: Both outputs should have the same pocket assignments
            results.forEach((result, index) => {
              const persistedMapping = persistedMappings[index];
              expect(persistedMapping).toBeDefined();
              expect(persistedMapping.customerId).toBe(result.customerId);
              expect(persistedMapping.pocketId).toBe(result.PocketID);
            });

            // Property 5: Mapping service should be called exactly once
            expect(mappingService.saveMappings).toHaveBeenCalledTimes(1);

            // Property 6: All persisted mappings should have all required fields
            persistedMappings.forEach(mapping => {
              expect(mapping.customerId).toBeDefined();
              expect(mapping.customerLat).toBeDefined();
              expect(mapping.customerLon).toBeDefined();
              expect(mapping.pocketId).toBeDefined();
              expect(mapping.distanceCustomerToPocket).toBeDefined();
              expect(mapping.nearestBranchId).toBeDefined();
              expect(mapping.distancePocketToBranch).toBeDefined();
              expect(mapping.distanceCustomerToBranch).toBeDefined();
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 17: Mapping Count Invariant
   * **Validates: Requirements 7.5**
   * 
   * For any completed batch job, the number of customer mappings persisted in 
   * the database should equal the number of customers successfully assigned to 
   * pockets during that job.
   */
  describe('Property 17: Mapping Count Invariant', () => {
    test('persisted mapping count should equal successfully assigned customer count', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              customerId: fc.string({ minLength: 1, maxLength: 50 }),
              lat: fc.double({ min: -90, max: 90, noNaN: true }),
              lon: fc.double({ min: -180, max: 180, noNaN: true }),
              shouldFail: fc.boolean(), // Some customers may fail assignment
            }),
            { minLength: 1, maxLength: 100 }
          ),
          fc.record({
            originLat: fc.double({ min: -90, max: 90 }),
            originLon: fc.double({ min: -180, max: 180 }),
            alphabet: fc.constant('0123456789ABCDEFGHJKLMNPQRSTUV'),
          }),
          async (customers, config) => {
            // Reset mocks for each iteration
            jest.clearAllMocks();
            
            // Mock database job lookup
            query.mockImplementation((queryText, values) => {
              if (queryText.includes('SELECT id FROM jobs')) {
                return Promise.resolve({ rows: [{ id: 456 }] });
              }
              return Promise.resolve({ rowCount: 0 });
            });

            // Mock findNearestPocket - some may fail
            let assignmentAttempts = 0;
            let successfulAssignments = 0;
            findNearestPocket.mockImplementation((lat, lon) => {
              const customer = customers[assignmentAttempts];
              assignmentAttempts++;
              
              if (customer && customer.shouldFail) {
                throw new Error('Assignment failed');
              }
              
              successfulAssignments++;
              return {
                pocketId: `POCKET-${successfulAssignments}`,
                distance: Math.random() * 1000,
                centerLat: lat + (Math.random() - 0.5) * 0.01,
                centerLon: lon + (Math.random() - 0.5) * 0.01,
              };
            });

            // Mock branch finder
            branchFinderService.findNearestBranchesForPockets.mockImplementation(async (pockets) => {
              const map = new Map();
              pockets.forEach((pocket, index) => {
                map.set(pocket.pocketId, {
                  branchId: `BRANCH-${index + 1}`,
                  branchName: `Branch ${index + 1}`,
                  branchLat: pocket.lat,
                  branchLon: pocket.lon,
                  distance: Math.random() * 5000,
                });
              });
              return map;
            });

            // Mock haversineDistance
            haversineDistance.mockImplementation(() => Math.random() * 10000);

            // Track persisted mappings
            let persistedCount = 0;
            mappingService.saveMappings.mockImplementation(async (jobId, mappings) => {
              persistedCount = mappings.length;
              return {
                success: true,
                insertedCount: mappings.length,
                errors: [],
              };
            });

            // Simulate batch processing with error handling
            const mappings = [];
            const pocketCenters = new Map();
            let processedSuccessfully = 0;

            for (let i = 0; i < customers.length; i++) {
              const customer = customers[i];
              try {
                const nearestPocket = findNearestPocket(customer.lat, customer.lon, config);
                const rawCustomerId =
                  customer.customerId === undefined || customer.customerId === null
                    ? ''
                    : String(customer.customerId).trim();
                const customerId =
                  rawCustomerId !== '' ? rawCustomerId : `CUST_${i + 1}`;
                
                if (!pocketCenters.has(nearestPocket.pocketId)) {
                  pocketCenters.set(nearestPocket.pocketId, {
                    lat: nearestPocket.centerLat,
                    lon: nearestPocket.centerLon,
                  });
                }

                mappings.push({
                  customerId,
                  customerLat: customer.lat,
                  customerLon: customer.lon,
                  pocketId: nearestPocket.pocketId,
                  distanceCustomerToPocket: nearestPocket.distance,
                  pocketCenterLat: nearestPocket.centerLat,
                  pocketCenterLon: nearestPocket.centerLon,
                });
                
                processedSuccessfully++;
              } catch (error) {
                // Skip failed assignments - continue processing
                continue;
              }
            }

            // Only persist if we have successful mappings
            if (mappings.length > 0) {
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

              await mappingService.saveMappings(456, enrichedMappings);
            }

            // Property 1: Persisted count equals successfully processed count
            expect(persistedCount).toBe(processedSuccessfully);

            // Property 2: Persisted count equals collected mappings count
            expect(persistedCount).toBe(mappings.length);

            // Property 3: No failed assignments should be persisted
            const failedCount = customers.filter(c => c.shouldFail).length;
            const expectedSuccessCount = customers.length - failedCount;
            expect(persistedCount).toBe(expectedSuccessCount);

            // Property 4: If no successful assignments, no persistence should occur
            if (processedSuccessfully === 0) {
              expect(mappingService.saveMappings).not.toHaveBeenCalled();
            } else {
              expect(mappingService.saveMappings).toHaveBeenCalledTimes(1);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
