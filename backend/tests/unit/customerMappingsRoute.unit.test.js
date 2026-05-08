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

describe('GET /api/v1/customer-mappings', () => {
  let app;

  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
  });

  test('should return mappings with default pagination', async () => {
    const mockData = [
      {
        id: 1,
        customer_id: 'CUST001',
        customer_lat: 40.7128,
        customer_lon: -74.0060,
        pocket_id: 123,
        distance_customer_to_pocket: 500.5,
        nearest_branch_id: 5,
        branch_name: 'New York Branch',
        distance_pocket_to_branch: 1200.3,
        distance_customer_to_branch: 1500.8,
        created_at: '2026-02-27T00:00:00.000Z',
      },
    ];

    mappingService.getMappings.mockResolvedValue({
      data: mockData,
      pagination: {
        page: 1,
        pageSize: 100,
        totalRecords: 1,
        totalPages: 1,
      },
    });

    const response = await request(app)
      .get('/api/v1/customer-mappings')
      .expect(200);

    expect(response.body.data).toEqual(mockData);
    expect(response.body.pagination).toEqual({
      page: 1,
      pageSize: 100,
      totalRecords: 1,
      totalPages: 1,
    });

    expect(mappingService.getMappings).toHaveBeenCalledWith(
      { jobId: null, customerId: '', pocketId: null },
      { page: 1, pageSize: 100 },
      { includeStats: true, includeBranchImpact: true }
    );
  });

  test('should apply job filter', async () => {
    mappingService.getMappings.mockResolvedValue({
      data: [],
      pagination: { page: 1, pageSize: 100, totalRecords: 0, totalPages: 0 },
    });

    await request(app)
      .get('/api/v1/customer-mappings?jobId=42')
      .expect(200);

    expect(mappingService.getMappings).toHaveBeenCalledWith(
      { jobId: '42', customerId: '', pocketId: null },
      { page: 1, pageSize: 100 },
      { includeStats: true, includeBranchImpact: true }
    );
  });

  test('should apply customer ID filter', async () => {
    mappingService.getMappings.mockResolvedValue({
      data: [],
      pagination: { page: 1, pageSize: 100, totalRecords: 0, totalPages: 0 },
    });

    await request(app)
      .get('/api/v1/customer-mappings?customerId=CUST123')
      .expect(200);

    expect(mappingService.getMappings).toHaveBeenCalledWith(
      { jobId: null, customerId: 'CUST123', pocketId: null },
      { page: 1, pageSize: 100 },
      { includeStats: true, includeBranchImpact: true }
    );
  });

  test('should apply pocket ID filter', async () => {
    mappingService.getMappings.mockResolvedValue({
      data: [],
      pagination: { page: 1, pageSize: 100, totalRecords: 0, totalPages: 0 },
    });

    await request(app)
      .get('/api/v1/customer-mappings?pocketId=999')
      .expect(200);

    expect(mappingService.getMappings).toHaveBeenCalledWith(
      { jobId: null, customerId: '', pocketId: '999' },
      { page: 1, pageSize: 100 },
      { includeStats: true, includeBranchImpact: true }
    );
  });

  test('should apply multiple filters simultaneously', async () => {
    mappingService.getMappings.mockResolvedValue({
      data: [],
      pagination: { page: 1, pageSize: 100, totalRecords: 0, totalPages: 0 },
    });

    await request(app)
      .get('/api/v1/customer-mappings?jobId=10&customerId=ABC&pocketId=500')
      .expect(200);

    expect(mappingService.getMappings).toHaveBeenCalledWith(
      { jobId: '10', customerId: 'ABC', pocketId: '500' },
      { page: 1, pageSize: 100 },
      { includeStats: true, includeBranchImpact: true }
    );
  });

  test('should apply custom pagination', async () => {
    mappingService.getMappings.mockResolvedValue({
      data: [],
      pagination: { page: 3, pageSize: 50, totalRecords: 200, totalPages: 4 },
    });

    await request(app)
      .get('/api/v1/customer-mappings?page=3&pageSize=50')
      .expect(200);

    expect(mappingService.getMappings).toHaveBeenCalledWith(
      { jobId: null, customerId: '', pocketId: null },
      { page: 3, pageSize: 50 },
      { includeStats: true, includeBranchImpact: true }
    );
  });

  test('should default to page 1 for invalid page number (< 1)', async () => {
    mappingService.getMappings.mockResolvedValue({
      data: [],
      pagination: { page: 1, pageSize: 100, totalRecords: 0, totalPages: 0 },
    });

    await request(app)
      .get('/api/v1/customer-mappings?page=0')
      .expect(200);

    expect(mappingService.getMappings).toHaveBeenCalledWith(
      { jobId: null, customerId: '', pocketId: null },
      { page: 1, pageSize: 100 },
      { includeStats: true, includeBranchImpact: true }
    );
  });

  test('should default to pageSize 100 for invalid page size (< 1)', async () => {
    mappingService.getMappings.mockResolvedValue({
      data: [],
      pagination: { page: 1, pageSize: 100, totalRecords: 0, totalPages: 0 },
    });

    await request(app)
      .get('/api/v1/customer-mappings?pageSize=0')
      .expect(200);

    expect(mappingService.getMappings).toHaveBeenCalledWith(
      { jobId: null, customerId: '', pocketId: null },
      { page: 1, pageSize: 100 },
      { includeStats: true, includeBranchImpact: true }
    );
  });

  test('should allow callers to disable expensive stats payloads', async () => {
    mappingService.getMappings.mockResolvedValue({
      data: [],
      pagination: { page: 1, pageSize: 100, totalRecords: 0, totalPages: 0 },
    });

    await request(app)
      .get('/api/v1/customer-mappings?includeStats=false&includeBranchImpact=false')
      .expect(200);

    expect(mappingService.getMappings).toHaveBeenCalledWith(
      { jobId: null, customerId: '', pocketId: null },
      { page: 1, pageSize: 100 },
      { includeStats: false, includeBranchImpact: false }
    );
  });

  test('should reject invalid page size (> 1000)', async () => {
    const response = await request(app)
      .get('/api/v1/customer-mappings?pageSize=1001')
      .expect(400);

    expect(response.body.error).toBe('Page size must be between 1 and 1000');
  });

  test('should reject overly long job ID', async () => {
    const invalidJobId = 'a'.repeat(51);
    const response = await request(app)
      .get(`/api/v1/customer-mappings?jobId=${invalidJobId}`)
      .expect(400);

    expect(response.body.error).toBe('Invalid job ID');
  });

  test('should reject overly long pocket ID', async () => {
    const invalidPocketId = 'p'.repeat(51);
    const response = await request(app)
      .get(`/api/v1/customer-mappings?pocketId=${invalidPocketId}`)
      .expect(400);

    expect(response.body.error).toBe('Invalid pocket ID');
  });

  test('should handle database errors gracefully', async () => {
    mappingService.getMappings.mockRejectedValue(new Error('Database connection failed'));

    const response = await request(app)
      .get('/api/v1/customer-mappings')
      .expect(500);

    expect(response.body.error).toBeDefined();
  });

  test('should return empty array for no results', async () => {
    mappingService.getMappings.mockResolvedValue({
      data: [],
      pagination: { page: 1, pageSize: 100, totalRecords: 0, totalPages: 0 },
    });

    const response = await request(app)
      .get('/api/v1/customer-mappings?jobId=999999')
      .expect(200);

    expect(response.body.data).toEqual([]);
    expect(response.body.pagination.totalRecords).toBe(0);
  });
});
