/**
 * Unit Tests for MappingService
 * Feature: customer-pocket-mapping-view
 * Validates: Requirements 1.1, 7.3
 */

const MappingService = require('../../src/services/MappingService');
const { query } = require('../../src/config/database');

// Mock the database module
jest.mock('../../src/config/database');
jest.mock('../../src/config/logger');

const VALUES_PER_ROW = 12;

describe('MappingService Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
  });

  describe('saveMappings', () => {
    /**
     * Test successful bulk insert
     * Validates: Requirements 1.1
     */
    test('should successfully insert a batch of mappings', async () => {
      const jobId = 123;
      const mappings = [
        {
          customerId: 'CUST001',
          customerLat: 40.7128,
          customerLon: -74.0060,
          pocketId: 1,
          distanceCustomerToPocket: 150.5,
          nearestBranchId: 10,
          distancePocketToBranch: 500.0,
          distanceCustomerToBranch: 650.5,
        },
        {
          customerId: 'CUST002',
          customerLat: 34.0522,
          customerLon: -118.2437,
          pocketId: 2,
          distanceCustomerToPocket: 200.3,
          nearestBranchId: 11,
          distancePocketToBranch: 450.0,
          distanceCustomerToBranch: 650.3,
        },
      ];

      // Mock successful database insert
      query.mockResolvedValue({ rowCount: 2 });

      const result = await MappingService.saveMappings(jobId, mappings);

      expect(result.success).toBe(true);
      expect(result.insertedCount).toBe(2);
      expect(result.errors).toHaveLength(0);
      expect(query).toHaveBeenCalledTimes(1);
    });

    /**
     * Test error handling when database fails
     * Validates: Requirements 7.3
     */
    test('should handle database errors gracefully and continue processing', async () => {
      const jobId = 456;
      const mappings = [
        {
          customerId: 'CUST003',
          customerLat: 51.5074,
          customerLon: -0.1278,
          pocketId: 3,
          distanceCustomerToPocket: 100.0,
          nearestBranchId: 12,
          distancePocketToBranch: 300.0,
          distanceCustomerToBranch: 400.0,
        },
      ];

      // Mock database failure
      query.mockRejectedValue(new Error('Database connection failed'));

      const result = await MappingService.saveMappings(jobId, mappings);

      expect(result.success).toBe(false);
      expect(result.insertedCount).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Database connection failed');
    });

    /**
     * Test batch splitting for large datasets
     * Validates: Requirements 1.1
     */
    test('should split large datasets into batches of 1000', async () => {
      const jobId = 789;
      // Create 2500 mappings to test batching
      const mappings = Array.from({ length: 2500 }, (_, i) => ({
        customerId: `CUST${i.toString().padStart(4, '0')}`,
        customerLat: 40.0 + (i * 0.001),
        customerLon: -74.0 + (i * 0.001),
        pocketId: i % 100,
        distanceCustomerToPocket: 100.0 + i,
        nearestBranchId: (i % 10) + 1,
        distancePocketToBranch: 200.0 + i,
        distanceCustomerToBranch: 300.0 + i,
      }));

      // Mock successful database insert for each batch
      query.mockImplementation((queryText, values) => {
        const rowCount = values.length / VALUES_PER_ROW;
        return Promise.resolve({ rowCount });
      });

      const result = await MappingService.saveMappings(jobId, mappings);

      expect(result.success).toBe(true);
      expect(result.insertedCount).toBe(2500);
      expect(result.errors).toHaveLength(0);
      
      // Should be called 3 times: 1000 + 1000 + 500
      expect(query).toHaveBeenCalledTimes(3);
      
      // Verify batch sizes
      const firstBatchSize = query.mock.calls[0][1].length / VALUES_PER_ROW;
      const secondBatchSize = query.mock.calls[1][1].length / VALUES_PER_ROW;
      const thirdBatchSize = query.mock.calls[2][1].length / VALUES_PER_ROW;
      
      expect(firstBatchSize).toBe(1000);
      expect(secondBatchSize).toBe(1000);
      expect(thirdBatchSize).toBe(500);
    });

    /**
     * Test partial failure handling
     * Validates: Requirements 7.3
     */
    test('should continue processing after a batch fails', async () => {
      const jobId = 999;
      // Create 1500 mappings to test partial failure
      const mappings = Array.from({ length: 1500 }, (_, i) => ({
        customerId: `CUST${i.toString().padStart(4, '0')}`,
        customerLat: 40.0 + (i * 0.001),
        customerLon: -74.0 + (i * 0.001),
        pocketId: i % 100,
        distanceCustomerToPocket: 100.0 + i,
        nearestBranchId: (i % 10) + 1,
        distancePocketToBranch: 200.0 + i,
        distanceCustomerToBranch: 300.0 + i,
      }));

      // Mock: first batch succeeds, second batch fails
      let callCount = 0;
      query.mockImplementation((queryText, values) => {
        callCount++;
        if (callCount === 1) {
          // First batch succeeds
          const rowCount = values.length / VALUES_PER_ROW;
          return Promise.resolve({ rowCount });
        } else {
          // Second batch fails
          return Promise.reject(new Error('Constraint violation'));
        }
      });

      const result = await MappingService.saveMappings(jobId, mappings);

      expect(result.success).toBe(false);
      expect(result.insertedCount).toBe(1000); // Only first batch succeeded
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Constraint violation');
      expect(query).toHaveBeenCalledTimes(2);
    });

    /**
     * Test empty mappings array
     * Validates: Requirements 1.1
     */
    test('should handle empty mappings array', async () => {
      const jobId = 111;
      const mappings = [];

      const result = await MappingService.saveMappings(jobId, mappings);

      expect(result.success).toBe(true);
      expect(result.insertedCount).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(query).not.toHaveBeenCalled();
    });

    /**
     * Test invalid parameters
     * Validates: Requirements 1.1
     */
    test('should throw error for invalid parameters', async () => {
      await expect(MappingService.saveMappings(null, [])).rejects.toThrow('Invalid parameters');
      await expect(MappingService.saveMappings(123, null)).rejects.toThrow('Invalid parameters');
      await expect(MappingService.saveMappings(123, 'not an array')).rejects.toThrow('Invalid parameters');
    });

    /**
     * Test SQL injection prevention
     * Validates: Requirements 1.1
     */
    test('should use parameterized queries to prevent SQL injection', async () => {
      const jobId = 222;
      const mappings = [
        {
          customerId: "'; DROP TABLE customer_pocket_mappings; --",
          customerLat: 40.7128,
          customerLon: -74.0060,
          pocketId: 1,
          distanceCustomerToPocket: 150.5,
          nearestBranchId: 10,
          distancePocketToBranch: 500.0,
          distanceCustomerToBranch: 650.5,
        },
      ];

      query.mockResolvedValue({ rowCount: 1 });

      await MappingService.saveMappings(jobId, mappings);

      // Verify that the query uses parameterized values
      expect(query).toHaveBeenCalled();
      const queryCall = query.mock.calls[0];
      const queryText = queryCall[0];
      const queryValues = queryCall[1];

      // Query should use placeholders, not direct string interpolation
      expect(queryText).not.toContain("'; DROP TABLE");
      // The malicious string should be in the values array (safely parameterized)
      expect(queryValues).toContain("'; DROP TABLE customer_pocket_mappings; --");
    });
  });

  describe('getMappings', () => {
    /**
     * Test retrieval with various filter combinations
     * Validates: Requirements 2.3, 2.4, 2.5, 2.6
     */
    test('should retrieve mappings with job filter', async () => {
      const mockData = [
        {
          id: 1,
          customer_id: 'CUST001',
          customer_lat: 40.7128,
          customer_lon: -74.0060,
          pocket_id: 1,
          distance_customer_to_pocket: 150.5,
          nearest_branch_id: 10,
          branch_name: 'NYC Branch',
          distance_pocket_to_branch: 500.0,
          distance_customer_to_branch: 650.5,
          created_at: new Date(),
        },
      ];

      query.mockImplementation((queryText) => {
        if (queryText.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ total: 1 }] });
        } else {
          return Promise.resolve({ rows: mockData });
        }
      });

      const result = await MappingService.getMappings({ jobId: 123 }, { page: 1, pageSize: 100 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].customerId).toBe('CUST001');
      expect(result.pagination.totalRecords).toBe(1);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.pageSize).toBe(100);
      expect(result.pagination.totalPages).toBe(1);
    });

    test('should retrieve mappings with customer ID filter', async () => {
      const mockData = [
        {
          id: 2,
          customer_id: 'CUST002',
          customer_lat: 34.0522,
          customer_lon: -118.2437,
          pocket_id: 2,
          distance_customer_to_pocket: 200.3,
          nearest_branch_id: 11,
          branch_name: 'LA Branch',
          distance_pocket_to_branch: 450.0,
          distance_customer_to_branch: 650.3,
          created_at: new Date(),
        },
      ];

      query.mockImplementation((queryText) => {
        if (queryText.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ total: 1 }] });
        } else {
          return Promise.resolve({ rows: mockData });
        }
      });

      const result = await MappingService.getMappings({ customerId: 'CUST002' }, { page: 1, pageSize: 100 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].customerId).toBe('CUST002');
      expect(result.pagination.totalRecords).toBe(1);
    });

    test('should retrieve mappings with pocket ID filter', async () => {
      const mockData = [
        {
          id: 3,
          customer_id: 'CUST003',
          customer_lat: 51.5074,
          customer_lon: -0.1278,
          pocket_id: 5,
          distance_customer_to_pocket: 100.0,
          nearest_branch_id: 12,
          branch_name: 'London Branch',
          distance_pocket_to_branch: 300.0,
          distance_customer_to_branch: 400.0,
          created_at: new Date(),
        },
      ];

      query.mockImplementation((queryText) => {
        if (queryText.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ total: 1 }] });
        } else {
          return Promise.resolve({ rows: mockData });
        }
      });

      const result = await MappingService.getMappings({ pocketId: 5 }, { page: 1, pageSize: 100 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].pocketId).toBe(5);
      expect(result.pagination.totalRecords).toBe(1);
    });

    test('should retrieve mappings with multiple filters', async () => {
      const mockData = [
        {
          id: 4,
          customer_id: 'CUST004',
          customer_lat: 35.6762,
          customer_lon: 139.6503,
          pocket_id: 3,
          distance_customer_to_pocket: 250.0,
          nearest_branch_id: 13,
          branch_name: 'Tokyo Branch',
          distance_pocket_to_branch: 600.0,
          distance_customer_to_branch: 850.0,
          created_at: new Date(),
        },
      ];

      query.mockImplementation((queryText) => {
        if (queryText.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ total: 1 }] });
        } else {
          return Promise.resolve({ rows: mockData });
        }
      });

      const result = await MappingService.getMappings(
        { jobId: 456, customerId: 'CUST004', pocketId: 3 },
        { page: 1, pageSize: 100 }
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].customerId).toBe('CUST004');
      expect(result.data[0].pocketId).toBe(3);
      expect(result.pagination.totalRecords).toBe(1);
    });

    /**
     * Test pagination edge cases
     * Validates: Requirements 2.3
     */
    test('should handle empty results', async () => {
      query.mockImplementation((queryText) => {
        if (queryText.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ total: 0 }] });
        } else {
          return Promise.resolve({ rows: [] });
        }
      });

      const result = await MappingService.getMappings({ jobId: 999 }, { page: 1, pageSize: 100 });

      expect(result.data).toHaveLength(0);
      expect(result.pagination.totalRecords).toBe(0);
      expect(result.pagination.totalPages).toBe(0);
    });

    test('should handle single page of results', async () => {
      const mockData = Array.from({ length: 50 }, (_, i) => ({
        id: i + 1,
        customer_id: `CUST${i.toString().padStart(3, '0')}`,
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

      query.mockImplementation((queryText) => {
        if (queryText.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ total: 50 }] });
        } else {
          return Promise.resolve({ rows: mockData });
        }
      });

      const result = await MappingService.getMappings({}, { page: 1, pageSize: 100 });

      expect(result.data).toHaveLength(50);
      expect(result.pagination.totalRecords).toBe(50);
      expect(result.pagination.totalPages).toBe(1);
    });

    test('should handle last page with partial results', async () => {
      const mockData = Array.from({ length: 25 }, (_, i) => ({
        id: i + 201,
        customer_id: `CUST${(i + 201).toString().padStart(3, '0')}`,
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

      query.mockImplementation((queryText) => {
        if (queryText.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ total: 225 }] });
        } else {
          return Promise.resolve({ rows: mockData });
        }
      });

      const result = await MappingService.getMappings({}, { page: 3, pageSize: 100 });

      expect(result.data).toHaveLength(25);
      expect(result.pagination.totalRecords).toBe(225);
      expect(result.pagination.totalPages).toBe(3);
      expect(result.pagination.page).toBe(3);
    });

    /**
     * Test with invalid parameters
     * Validates: Requirements 2.3
     */
    test('should default to page 1 for negative page numbers', async () => {
      query.mockImplementation((queryText) => {
        if (queryText.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ total: 10 }] });
        } else {
          return Promise.resolve({ rows: [] });
        }
      });

      const result = await MappingService.getMappings({}, { page: -5, pageSize: 100 });

      expect(result.pagination.page).toBe(1);
    });

    test('should default to page 1 for zero page number', async () => {
      query.mockImplementation((queryText) => {
        if (queryText.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ total: 10 }] });
        } else {
          return Promise.resolve({ rows: [] });
        }
      });

      const result = await MappingService.getMappings({}, { page: 0, pageSize: 100 });

      expect(result.pagination.page).toBe(1);
    });

    test('should default to pageSize 100 when not specified', async () => {
      query.mockImplementation((queryText) => {
        if (queryText.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ total: 10 }] });
        } else {
          return Promise.resolve({ rows: [] });
        }
      });

      const result = await MappingService.getMappings({}, {});

      expect(result.pagination.pageSize).toBe(100);
    });

    test('should cap pageSize at 1000', async () => {
      query.mockImplementation((queryText) => {
        if (queryText.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ total: 10 }] });
        } else {
          return Promise.resolve({ rows: [] });
        }
      });

      const result = await MappingService.getMappings({}, { page: 1, pageSize: 5000 });

      expect(result.pagination.pageSize).toBe(1000);
    });

    test('should handle empty filter string for customerId', async () => {
      query.mockImplementation((queryText) => {
        if (queryText.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ total: 10 }] });
        } else {
          return Promise.resolve({ rows: [] });
        }
      });

      const result = await MappingService.getMappings({ customerId: '' }, { page: 1, pageSize: 100 });

      expect(result.pagination.totalRecords).toBe(10);
      // Verify that the WHERE clause doesn't include customer_id filter
      const countCall = query.mock.calls.find(call => call[0].includes('COUNT(*)'));
      expect(countCall[0]).not.toContain('customer_id ILIKE');
    });
  });
});
