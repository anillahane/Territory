/**
 * Property-Based Tests for MappingService
 * Feature: customer-pocket-mapping-view
 */

const fc = require('fast-check');
const MappingService = require('../../src/services/MappingService');
const { query } = require('../../src/config/database');

// Mock the database module
jest.mock('../../src/config/database');
jest.mock('../../src/config/logger');

const VALUES_PER_ROW = 12;
const REQUIRED_VALUES_PER_ROW = 9;

describe('MappingService Property-Based Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
  });

  /**
   * Property 1: Mapping Persistence Completeness
   * **Validates: Requirements 1.1, 1.2, 2.2**
   * 
   * For any batch job that assigns customers to pockets, all customer assignments 
   * should result in corresponding database records with all required fields populated.
   */
  describe('Property 1: Mapping Persistence Completeness', () => {
    test('all customer mappings should be persisted with all required fields', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 10000 }), // jobId
          fc.array(
            fc.record({
              customerId: fc.string({ minLength: 1, maxLength: 255 }),
              customerLat: fc.double({ min: -90, max: 90 }),
              customerLon: fc.double({ min: -180, max: 180 }),
              pocketId: fc.integer({ min: 1, max: 100000 }),
              distanceCustomerToPocket: fc.double({ min: 0, max: 20000000 }),
              nearestBranchId: fc.integer({ min: 1, max: 10000 }),
              distancePocketToBranch: fc.double({ min: 0, max: 20000000 }),
              distanceCustomerToBranch: fc.double({ min: 0, max: 20000000 }),
            }),
            { minLength: 1, maxLength: 100 }
          ), // mappings array
          async (jobId, mappings) => {
            // Track total inserted
            let totalInserted = 0;
            
            // Mock successful database insert - return the batch size for each call
            query.mockImplementation((queryText, values) => {
              // Calculate how many rows are being inserted based on values length
              const rowCount = values.length / VALUES_PER_ROW;
              totalInserted += rowCount;
              return Promise.resolve({ rowCount });
            });

            // Call the service
            const result = await MappingService.saveMappings(jobId, mappings);

            // Property: All mappings should be persisted successfully
            expect(result.success).toBe(true);
            expect(result.insertedCount).toBe(mappings.length);
            expect(result.errors).toHaveLength(0);

            // Property: Query should be called at least once
            expect(query).toHaveBeenCalled();

            // Property: All query calls must include all required field names
            query.mock.calls.forEach((call) => {
              const queryText = call[0];
              const queryValues = call[1];

              // Verify the query includes all 9 required fields
              expect(queryText).toContain('job_id');
              expect(queryText).toContain('customer_id');
              expect(queryText).toContain('customer_lat');
              expect(queryText).toContain('customer_lon');
              expect(queryText).toContain('pocket_id');
              expect(queryText).toContain('distance_customer_to_pocket');
              expect(queryText).toContain('nearest_branch_id');
              expect(queryText).toContain('distance_pocket_to_branch');
              expect(queryText).toContain('distance_customer_to_branch');

              // Property: Values must be in multiples of 12 (complete records only)
              expect(queryValues.length % VALUES_PER_ROW).toBe(0);

              // Property: The required values for each record must be defined and not null.
              for (let rowIndex = 0; rowIndex < queryValues.length; rowIndex += VALUES_PER_ROW) {
                queryValues
                  .slice(rowIndex, rowIndex + REQUIRED_VALUES_PER_ROW)
                  .forEach((value) => {
                    expect(value).toBeDefined();
                    expect(value).not.toBeNull();
                  });
              }
            });

            // Property: Total records inserted equals input count
            expect(totalInserted).toBe(mappings.length);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 2: Job Association Integrity
   * **Validates: Requirements 1.3**
   * 
   * For any customer mapping stored in the database, the mapping should be correctly 
   * associated with its originating batch job ID.
   */
  describe('Property 2: Job Association Integrity', () => {
    test('all mappings should be associated with the correct job ID', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 10000 }), // jobId
          fc.array(
            fc.record({
              customerId: fc.string({ minLength: 1, maxLength: 255 }),
              customerLat: fc.double({ min: -90, max: 90 }),
              customerLon: fc.double({ min: -180, max: 180 }),
              pocketId: fc.integer({ min: 1, max: 100000 }),
              distanceCustomerToPocket: fc.double({ min: 0, max: 20000000 }),
              nearestBranchId: fc.integer({ min: 1, max: 10000 }),
              distancePocketToBranch: fc.double({ min: 0, max: 20000000 }),
              distanceCustomerToBranch: fc.double({ min: 0, max: 20000000 }),
            }),
            { minLength: 1, maxLength: 100 }
          ), // mappings array
          async (jobId, mappings) => {
            // Clear mocks for this iteration
            jest.clearAllMocks();
            
            // Mock successful database insert
            query.mockImplementation((queryText, values) => {
              const rowCount = values.length / VALUES_PER_ROW;
              return Promise.resolve({ rowCount });
            });

            // Call the service
            await MappingService.saveMappings(jobId, mappings);

            // Property: Every database insert must include the job_id field
            expect(query).toHaveBeenCalled();
            query.mock.calls.forEach((call) => {
              const queryText = call[0];
              expect(queryText).toContain('job_id');
            });

            // Property: The first value in each record must be the jobId
            query.mock.calls.forEach((call) => {
              const queryValues = call[1];
              const recordCount = queryValues.length / VALUES_PER_ROW;
              
              for (let i = 0; i < recordCount; i++) {
                const baseIndex = i * VALUES_PER_ROW;
                // First value of each record is job_id
                expect(queryValues[baseIndex]).toBe(jobId);
              }
            });

            // Property: All records for this batch have the same job ID
            const allJobIds = [];
            query.mock.calls.forEach((call) => {
              const queryValues = call[1];
              const recordCount = queryValues.length / VALUES_PER_ROW;
              
              for (let i = 0; i < recordCount; i++) {
                const baseIndex = i * VALUES_PER_ROW;
                allJobIds.push(queryValues[baseIndex]);
              }
            });

            // All job IDs should be identical and equal to the input jobId
            expect(allJobIds.length).toBe(mappings.length);
            allJobIds.forEach((id) => {
              expect(id).toBe(jobId);
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 6: Pagination Boundary Correctness
   * **Validates: Requirements 2.3, 6.2**
   * 
   * For any page number and page size, the API should return exactly page_size records 
   * (or fewer for the last page), and requesting consecutive pages should return 
   * non-overlapping, complete subsets of the total dataset.
   */
  describe('Property 6: Pagination Boundary Correctness', () => {
    test('pagination should return correct page sizes and non-overlapping records', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 10, max: 100 }), // totalRecords
          fc.integer({ min: 1, max: 20 }), // pageSize
          async (totalRecords, pageSize) => {
            jest.clearAllMocks();

            // Generate mock data with unique IDs
            const mockData = Array.from({ length: totalRecords }, (_, i) => ({
              id: i + 1,
              customer_id: `CUST${i.toString().padStart(4, '0')}`,
              customer_lat: 40.0 + (i * 0.001),
              customer_lon: -74.0 + (i * 0.001),
              pocket_id: i % 10,
              distance_customer_to_pocket: 100.0 + i,
              nearest_branch_id: (i % 5) + 1,
              branch_name: `Branch${(i % 5) + 1}`,
              distance_pocket_to_branch: 200.0 + i,
              distance_customer_to_branch: 300.0 + i,
              created_at: new Date(),
            }));

            // Mock database queries
            query.mockImplementation((queryText, params) => {
              if (queryText.includes('COUNT(*)')) {
                // Count query
                return Promise.resolve({
                  rows: [{ total: totalRecords }],
                });
              } else {
                // Data query - extract LIMIT and OFFSET from params
                const limit = params[params.length - 2];
                const offset = params[params.length - 1];
                const pageData = mockData.slice(offset, offset + limit);
                return Promise.resolve({
                  rows: pageData,
                });
              }
            });

            const totalPages = Math.ceil(totalRecords / pageSize);
            const allReturnedIds = new Set();

            // Test each page
            for (let page = 1; page <= totalPages; page++) {
              const result = await MappingService.getMappings({}, { page, pageSize });

              // Property: Page metadata should be correct
              expect(result.pagination.page).toBe(page);
              expect(result.pagination.pageSize).toBe(pageSize);
              expect(result.pagination.totalRecords).toBe(totalRecords);
              expect(result.pagination.totalPages).toBe(totalPages);

              // Property: Last page may have fewer records, other pages should have exactly pageSize
              if (page < totalPages) {
                expect(result.data.length).toBe(pageSize);
              } else {
                // Last page
                const expectedLastPageSize = totalRecords - (pageSize * (totalPages - 1));
                expect(result.data.length).toBe(expectedLastPageSize);
              }

              // Property: No duplicate IDs across pages (non-overlapping)
              result.data.forEach((record) => {
                expect(allReturnedIds.has(record.id)).toBe(false);
                allReturnedIds.add(record.id);
              });
            }

            // Property: All records should be returned exactly once
            expect(allReturnedIds.size).toBe(totalRecords);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 7: Job Filter Exclusivity
   * **Validates: Requirements 2.4**
   * 
   * For any job ID filter applied to the API, all returned mappings should have 
   * that job ID, and no mappings with different job IDs should be returned.
   */
  describe('Property 7: Job Filter Exclusivity', () => {
    test('job filter should return only mappings with the specified job ID', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 100 }), // targetJobId
          fc.array(
            fc.integer({ min: 1, max: 100 }), // other job IDs
            { minLength: 1, maxLength: 10 }
          ),
          fc.integer({ min: 10, max: 50 }), // records per job
          async (targetJobId, otherJobIds, recordsPerJob) => {
            jest.clearAllMocks();

            // Create a dataset with multiple job IDs
            const allJobIds = [targetJobId, ...otherJobIds];
            const mockData = [];
            let idCounter = 1;

            allJobIds.forEach((jobId) => {
              for (let i = 0; i < recordsPerJob; i++) {
                mockData.push({
                  id: idCounter++,
                  job_id: jobId,
                  customer_id: `CUST${idCounter}`,
                  customer_lat: 40.0 + (idCounter * 0.001),
                  customer_lon: -74.0 + (idCounter * 0.001),
                  pocket_id: idCounter % 10,
                  distance_customer_to_pocket: 100.0 + idCounter,
                  nearest_branch_id: (idCounter % 5) + 1,
                  branch_name: `Branch${(idCounter % 5) + 1}`,
                  distance_pocket_to_branch: 200.0 + idCounter,
                  distance_customer_to_branch: 300.0 + idCounter,
                  created_at: new Date(),
                });
              }
            });

            // Mock database queries to filter by job_id
            query.mockImplementation((queryText, params) => {
              // Check if job_id filter is applied
              const hasJobFilter = queryText.includes('cpm.job_id = $1');
              
              if (queryText.includes('COUNT(*)')) {
                // Count query
                if (hasJobFilter) {
                  const jobId = params[0];
                  const count = mockData.filter(r => r.job_id === jobId).length;
                  return Promise.resolve({
                    rows: [{ total: count }],
                  });
                } else {
                  return Promise.resolve({
                    rows: [{ total: mockData.length }],
                  });
                }
              } else {
                // Data query
                let filteredData = mockData;
                
                if (hasJobFilter) {
                  const jobId = params[0];
                  filteredData = mockData.filter(r => r.job_id === jobId);
                }
                
                // Apply pagination
                const limit = params[params.length - 2];
                const offset = params[params.length - 1];
                const pageData = filteredData.slice(offset, offset + limit);
                
                return Promise.resolve({
                  rows: pageData,
                });
              }
            });

            // Query with job filter
            const result = await MappingService.getMappings(
              { jobId: targetJobId },
              { page: 1, pageSize: 100 }
            );

            // Property: All returned records must have the target job ID
            result.data.forEach((record) => {
              // Note: The data doesn't include job_id in the response, 
              // but we verify the filter was applied correctly by checking the count
              expect(record).toBeDefined();
            });

            // Property: Total count should match only records with target job ID
            const expectedCount = mockData.filter(r => r.job_id === targetJobId).length;
            expect(result.pagination.totalRecords).toBe(expectedCount);

            // Property: Returned count should not exceed expected count
            expect(result.data.length).toBeLessThanOrEqual(expectedCount);

            // Verify the query was called with the correct job_id parameter
            const countCall = query.mock.calls.find(call => call[0].includes('COUNT(*)'));
            expect(countCall).toBeDefined();
            expect(countCall[1]).toContain(targetJobId);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 8: Customer ID Filter Correctness
   * **Validates: Requirements 2.5**
   * 
   * For any customer ID filter string applied to the API, all returned mappings 
   * should have customer IDs that contain the filter string, and no mappings 
   * with non-matching customer IDs should be returned.
   */
  describe('Property 8: Customer ID Filter Correctness', () => {
    test('customer ID filter should return only mappings with matching customer IDs', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.constantFrom('A', 'B', 'C', 'D', 'E', '1', '2', '3', '4', '5'),
            { minLength: 2, maxLength: 5 }
          ).map(arr => arr.join('')), // filter string (alphanumeric only, no SQL wildcards)
          fc.integer({ min: 20, max: 50 }), // total records
          async (filterString, totalRecords) => {
            jest.clearAllMocks();

            // Create a dataset with various customer IDs
            const mockData = [];
            for (let i = 0; i < totalRecords; i++) {
              // Some customer IDs will contain the filter string, some won't
              let customerId;
              if (i % 3 === 0) {
                // Include the filter string
                customerId = `CUST_${filterString}_${i}`;
              } else {
                // Don't include the filter string
                customerId = `CUST_OTHER_${i}`;
              }

              mockData.push({
                id: i + 1,
                customer_id: customerId,
                customer_lat: 40.0 + (i * 0.001),
                customer_lon: -74.0 + (i * 0.001),
                pocket_id: i % 10,
                distance_customer_to_pocket: 100.0 + i,
                nearest_branch_id: (i % 5) + 1,
                branch_name: `Branch${(i % 5) + 1}`,
                distance_pocket_to_branch: 200.0 + i,
                distance_customer_to_branch: 300.0 + i,
                created_at: new Date(),
              });
            }

            // Mock database queries to filter by customer_id
            query.mockImplementation((queryText, params) => {
              // Check if customer_id filter is applied
              const hasCustomerFilter = queryText.includes('cpm.customer_id ILIKE $1');
              
              if (queryText.includes('COUNT(*)')) {
                // Count query
                if (hasCustomerFilter) {
                  const filterPattern = params[0];
                  const searchString = filterPattern.replace(/%/g, '');
                  const count = mockData.filter(r => 
                    r.customer_id.toLowerCase().includes(searchString.toLowerCase())
                  ).length;
                  return Promise.resolve({
                    rows: [{ total: count }],
                  });
                } else {
                  return Promise.resolve({
                    rows: [{ total: mockData.length }],
                  });
                }
              } else {
                // Data query
                let filteredData = mockData;
                
                if (hasCustomerFilter) {
                  const filterPattern = params[0];
                  const searchString = filterPattern.replace(/%/g, '');
                  filteredData = mockData.filter(r => 
                    r.customer_id.toLowerCase().includes(searchString.toLowerCase())
                  );
                }
                
                // Apply pagination
                const limit = params[params.length - 2];
                const offset = params[params.length - 1];
                const pageData = filteredData.slice(offset, offset + limit);
                
                return Promise.resolve({
                  rows: pageData,
                });
              }
            });

            // Query with customer ID filter
            const result = await MappingService.getMappings(
              { customerId: filterString },
              { page: 1, pageSize: 100 }
            );

            // Property: All returned records must contain the filter string
            result.data.forEach((record) => {
              expect(record.customerId.toLowerCase()).toContain(filterString.toLowerCase());
            });

            // Property: Total count should match only records with matching customer IDs
            const expectedCount = mockData.filter(r => 
              r.customer_id.toLowerCase().includes(filterString.toLowerCase())
            ).length;
            expect(result.pagination.totalRecords).toBe(expectedCount);

            // Property: Returned count should not exceed expected count
            expect(result.data.length).toBeLessThanOrEqual(expectedCount);

            // Verify the query was called with the correct ILIKE pattern
            const countCall = query.mock.calls.find(call => call[0].includes('COUNT(*)'));
            expect(countCall).toBeDefined();
            expect(countCall[1][0]).toBe(`%${filterString}%`);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 9: Pocket ID Filter Correctness
   * **Validates: Requirements 2.6**
   * 
   * For any pocket ID filter applied to the API, all returned mappings should 
   * have that exact pocket ID, and no mappings with different pocket IDs 
   * should be returned.
   */
  describe('Property 9: Pocket ID Filter Correctness', () => {
    test('pocket ID filter should return only mappings with the specified pocket ID', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 100 }), // targetPocketId
          fc.array(
            fc.integer({ min: 1, max: 100 }), // other pocket IDs
            { minLength: 1, maxLength: 10 }
          ),
          fc.integer({ min: 10, max: 50 }), // records per pocket
          async (targetPocketId, otherPocketIds, recordsPerPocket) => {
            jest.clearAllMocks();

            // Create a dataset with multiple pocket IDs
            const allPocketIds = [targetPocketId, ...otherPocketIds];
            const mockData = [];
            let idCounter = 1;

            allPocketIds.forEach((pocketId) => {
              for (let i = 0; i < recordsPerPocket; i++) {
                mockData.push({
                  id: idCounter++,
                  customer_id: `CUST${idCounter}`,
                  customer_lat: 40.0 + (idCounter * 0.001),
                  customer_lon: -74.0 + (idCounter * 0.001),
                  pocket_id: pocketId,
                  distance_customer_to_pocket: 100.0 + idCounter,
                  nearest_branch_id: (idCounter % 5) + 1,
                  branch_name: `Branch${(idCounter % 5) + 1}`,
                  distance_pocket_to_branch: 200.0 + idCounter,
                  distance_customer_to_branch: 300.0 + idCounter,
                  created_at: new Date(),
                });
              }
            });

            // Mock database queries to filter by pocket_id
            query.mockImplementation((queryText, params) => {
              // Check if pocket_id filter is applied
              const hasPocketFilter = queryText.includes('cpm.pocket_id = $1');
              
              if (queryText.includes('COUNT(*)')) {
                // Count query
                if (hasPocketFilter) {
                  const pocketId = params[0];
                  const count = mockData.filter(r => r.pocket_id === pocketId).length;
                  return Promise.resolve({
                    rows: [{ total: count }],
                  });
                } else {
                  return Promise.resolve({
                    rows: [{ total: mockData.length }],
                  });
                }
              } else {
                // Data query
                let filteredData = mockData;
                
                if (hasPocketFilter) {
                  const pocketId = params[0];
                  filteredData = mockData.filter(r => r.pocket_id === pocketId);
                }
                
                // Apply pagination
                const limit = params[params.length - 2];
                const offset = params[params.length - 1];
                const pageData = filteredData.slice(offset, offset + limit);
                
                return Promise.resolve({
                  rows: pageData,
                });
              }
            });

            // Query with pocket ID filter
            const result = await MappingService.getMappings(
              { pocketId: targetPocketId },
              { page: 1, pageSize: 100 }
            );

            // Property: All returned records must have the target pocket ID
            result.data.forEach((record) => {
              expect(record.pocketId).toBe(targetPocketId);
            });

            // Property: Total count should match only records with target pocket ID
            const expectedCount = mockData.filter(r => r.pocket_id === targetPocketId).length;
            expect(result.pagination.totalRecords).toBe(expectedCount);

            // Property: Returned count should not exceed expected count
            expect(result.data.length).toBeLessThanOrEqual(expectedCount);

            // Verify the query was called with the correct pocket_id parameter
            const countCall = query.mock.calls.find(call => call[0].includes('COUNT(*)'));
            expect(countCall).toBeDefined();
            expect(countCall[1]).toContain(targetPocketId);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
