const fc = require('fast-check');
const request = require('supertest');
const express = require('express');
const customerMappingsRoutes = require('../../src/routes/customerMappings');
const mappingService = require('../../src/services/MappingService');
const { errorHandler } = require('../../src/middleware/errorHandler');

// Mock the mapping service
jest.mock('../../src/services/MappingService');

// Create test app
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/customer-mappings', customerMappingsRoutes);
  app.use(errorHandler);
  return app;
};

describe('Customer Mappings Route - Property Tests', () => {
  let app;

  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
  });

  /**
   * Feature: customer-pocket-mapping-view
   * Property 5: API Response Completeness
   * Validates: Requirements 2.2
   * 
   * For any customer mapping retrieved through the API, the response should contain
   * all required fields: customer ID, customer coordinates, pocket ID, all three
   * distance metrics, and branch information.
   */
  test('Property 5: API Response Completeness - all mappings have required fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            id: fc.integer({ min: 1, max: 1000000 }),
            customer_id: fc.string({ minLength: 1, maxLength: 50 }),
            customer_lat: fc.float({ min: -90, max: 90 }),
            customer_lon: fc.float({ min: -180, max: 180 }),
            pocket_id: fc.integer({ min: 1, max: 10000 }),
            distance_customer_to_pocket: fc.float({ min: 0, max: 20000000 }),
            nearest_branch_id: fc.integer({ min: 1, max: 1000 }),
            branch_name: fc.string({ minLength: 1, maxLength: 100 }),
            distance_pocket_to_branch: fc.float({ min: 0, max: 20000000 }),
            distance_customer_to_branch: fc.float({ min: 0, max: 20000000 }),
            created_at: fc.date(),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        fc.integer({ min: 1, max: 100 }),
        async (mappings, totalRecords) => {
          // Mock service response
          mappingService.getMappings.mockResolvedValue({
            data: mappings,
            pagination: {
              page: 1,
              pageSize: 100,
              totalRecords,
              totalPages: Math.ceil(totalRecords / 100),
            },
          });

          const response = await request(app)
            .get('/api/v1/customer-mappings')
            .expect(200);

          // Verify response structure
          expect(response.body).toHaveProperty('data');
          expect(response.body).toHaveProperty('pagination');
          expect(Array.isArray(response.body.data)).toBe(true);

          // Verify each mapping has all required fields
          response.body.data.forEach((mapping) => {
            expect(mapping).toHaveProperty('id');
            expect(mapping).toHaveProperty('customer_id');
            expect(mapping).toHaveProperty('customer_lat');
            expect(mapping).toHaveProperty('customer_lon');
            expect(mapping).toHaveProperty('pocket_id');
            expect(mapping).toHaveProperty('distance_customer_to_pocket');
            expect(mapping).toHaveProperty('nearest_branch_id');
            expect(mapping).toHaveProperty('distance_pocket_to_branch');
            expect(mapping).toHaveProperty('distance_customer_to_branch');
            expect(mapping).toHaveProperty('created_at');
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});
