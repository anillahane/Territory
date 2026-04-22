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
  app.use((req, _res, next) => {
    req.user = { role: 'admin' };
    next();
  });
  app.use('/api/v1/customer-mappings', customerMappingsRoutes);
  app.use(errorHandler);
  return app;
};

describe('POST /api/v1/customer-mappings/batch', () => {
  let app;

  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
  });

  test('should successfully insert mappings', async () => {
    const requestBody = {
      jobId: 'job-1',
      mappings: [
        {
          customerId: 'CUST001',
          customerLat: 40.7128,
          customerLon: -74.0060,
          pocketId: '123',
          distanceCustomerToPocket: 500.5,
          nearestBranchId: '5',
          distancePocketToBranch: 1200.3,
          distanceCustomerToBranch: 1500.8,
        },
        {
          customerId: 'CUST002',
          customerLat: 34.0522,
          customerLon: -118.2437,
          pocketId: '456',
          distanceCustomerToPocket: 300.2,
          nearestBranchId: '3',
          distancePocketToBranch: 800.5,
          distanceCustomerToBranch: 1000.7,
        },
      ],
    };

    mappingService.saveMappings.mockResolvedValue({
      success: true,
      insertedCount: 2,
      errors: [],
    });

    const response = await request(app)
      .post('/api/v1/customer-mappings/batch')
      .send(requestBody)
      .expect(201);

    expect(response.body).toEqual({
      success: true,
      insertedCount: 2,
      errors: [],
    });

    expect(mappingService.saveMappings).toHaveBeenCalledWith('job-1', [
      {
        ...requestBody.mappings[0],
        uploadedBranchCode: null,
        existingBranchId: null,
        distanceCustomerToExistingBranch: null,
      },
      {
        ...requestBody.mappings[1],
        uploadedBranchCode: null,
        existingBranchId: null,
        distanceCustomerToExistingBranch: null,
      },
    ]);
  });

  test('should reject request with missing jobId', async () => {
    const requestBody = {
      mappings: [
        {
          customerId: 'CUST001',
          customerLat: 40.7128,
          customerLon: -74.0060,
          pocketId: 123,
          distanceCustomerToPocket: 500.5,
          nearestBranchId: 5,
          distancePocketToBranch: 1200.3,
          distanceCustomerToBranch: 1500.8,
        },
      ],
    };

    const response = await request(app)
      .post('/api/v1/customer-mappings/batch')
      .send(requestBody)
      .expect(400);

    expect(response.body.error).toBe('Invalid or missing jobId');
  });

  test('should reject request with invalid jobId type', async () => {
    const requestBody = {
      jobId: { invalid: true },
      mappings: [
        {
          customerId: 'CUST001',
          customerLat: 40.7128,
          customerLon: -74.0060,
          pocketId: 123,
          distanceCustomerToPocket: 500.5,
          nearestBranchId: 5,
          distancePocketToBranch: 1200.3,
          distanceCustomerToBranch: 1500.8,
        },
      ],
    };

    const response = await request(app)
      .post('/api/v1/customer-mappings/batch')
      .send(requestBody)
      .expect(400);

    expect(response.body.error).toBe('Invalid or missing jobId');
  });

  test('should reject request with missing mappings', async () => {
    const requestBody = {
      jobId: 'job-1',
    };

    const response = await request(app)
      .post('/api/v1/customer-mappings/batch')
      .send(requestBody)
      .expect(400);

    expect(response.body.error).toBe('Mappings must be a non-empty array');
  });

  test('should reject request with empty mappings array', async () => {
    const requestBody = {
      jobId: 'job-1',
      mappings: [],
    };

    const response = await request(app)
      .post('/api/v1/customer-mappings/batch')
      .send(requestBody)
      .expect(400);

    expect(response.body.error).toBe('Mappings must be a non-empty array');
  });

  test('should reject mapping with missing required field', async () => {
    const requestBody = {
      jobId: 'job-1',
      mappings: [
        {
          customerId: 'CUST001',
          customerLat: 40.7128,
          // Missing customerLon
          pocketId: '123',
          distanceCustomerToPocket: 500.5,
          nearestBranchId: '5',
          distancePocketToBranch: 1200.3,
          distanceCustomerToBranch: 1500.8,
        },
      ],
    };

    const response = await request(app)
      .post('/api/v1/customer-mappings/batch')
      .send(requestBody)
      .expect(400);

    expect(response.body.error).toContain("Missing required field 'customerLon'");
  });

  test('should reject mapping with invalid customerId type', async () => {
    const requestBody = {
      jobId: 'job-1',
      mappings: [
        {
          customerId: 123, // Should be string
          customerLat: 40.7128,
          customerLon: -74.0060,
          pocketId: '123',
          distanceCustomerToPocket: 500.5,
          nearestBranchId: '5',
          distancePocketToBranch: 1200.3,
          distanceCustomerToBranch: 1500.8,
        },
      ],
    };

    const response = await request(app)
      .post('/api/v1/customer-mappings/batch')
      .send(requestBody)
      .expect(400);

    expect(response.body.error).toContain('Invalid customerId type');
  });

  test('should reject mapping with invalid numeric field type', async () => {
    const requestBody = {
      jobId: 'job-1',
      mappings: [
        {
          customerId: 'CUST001',
          customerLat: '40.7128', // Should be number
          customerLon: -74.0060,
          pocketId: '123',
          distanceCustomerToPocket: 500.5,
          nearestBranchId: '5',
          distancePocketToBranch: 1200.3,
          distanceCustomerToBranch: 1500.8,
        },
      ],
    };

    const response = await request(app)
      .post('/api/v1/customer-mappings/batch')
      .send(requestBody)
      .expect(400);

    expect(response.body.error).toContain('Invalid data types');
  });

  test('should handle database errors gracefully', async () => {
    const requestBody = {
      jobId: 'job-1',
      mappings: [
        {
          customerId: 'CUST001',
          customerLat: 40.7128,
          customerLon: -74.0060,
          pocketId: '123',
          distanceCustomerToPocket: 500.5,
          nearestBranchId: '5',
          distancePocketToBranch: 1200.3,
          distanceCustomerToBranch: 1500.8,
        },
      ],
    };

    mappingService.saveMappings.mockRejectedValue(new Error('Database connection failed'));

    const response = await request(app)
      .post('/api/v1/customer-mappings/batch')
      .send(requestBody)
      .expect(500);

    expect(response.body.error).toBeDefined();
  });

  test('should return partial success when some inserts fail', async () => {
    const requestBody = {
      jobId: 'job-1',
      mappings: [
        {
          customerId: 'CUST001',
          customerLat: 40.7128,
          customerLon: -74.0060,
          pocketId: '123',
          distanceCustomerToPocket: 500.5,
          nearestBranchId: '5',
          distancePocketToBranch: 1200.3,
          distanceCustomerToBranch: 1500.8,
        },
        {
          customerId: 'CUST002',
          customerLat: 34.0522,
          customerLon: -118.2437,
          pocketId: '456',
          distanceCustomerToPocket: 300.2,
          nearestBranchId: '3',
          distancePocketToBranch: 800.5,
          distanceCustomerToBranch: 1000.7,
        },
      ],
    };

    mappingService.saveMappings.mockResolvedValue({
      success: false,
      insertedCount: 1,
      errors: ['Failed to insert mapping for CUST002'],
    });

    const response = await request(app)
      .post('/api/v1/customer-mappings/batch')
      .send(requestBody)
      .expect(201);

    expect(response.body).toEqual({
      success: false,
      insertedCount: 1,
      errors: ['Failed to insert mapping for CUST002'],
    });
  });
});
