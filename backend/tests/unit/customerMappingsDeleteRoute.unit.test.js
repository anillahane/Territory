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

describe('DELETE /api/v1/customer-mappings', () => {
  let app;

  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
  });

  test('should successfully delete mappings with date filter', async () => {
    mappingService.deleteMappings.mockResolvedValue(50);

    const response = await request(app)
      .delete('/api/v1/customer-mappings?olderThan=2025-01-01')
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      deletedCount: 50,
    });

    expect(mappingService.deleteMappings).toHaveBeenCalledWith(
      new Date('2025-01-01'),
      null
    );
  });

  test('should successfully delete mappings with date and job filter', async () => {
    mappingService.deleteMappings.mockResolvedValue(25);

    const response = await request(app)
      .delete('/api/v1/customer-mappings?olderThan=2025-01-01&jobId=42')
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      deletedCount: 25,
    });

    expect(mappingService.deleteMappings).toHaveBeenCalledWith(
      new Date('2025-01-01'),
      '42'
    );
  });

  test('should return zero when no mappings match criteria', async () => {
    mappingService.deleteMappings.mockResolvedValue(0);

    const response = await request(app)
      .delete('/api/v1/customer-mappings?olderThan=2020-01-01')
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      deletedCount: 0,
    });
  });

  test('should reject request with missing olderThan parameter', async () => {
    const response = await request(app)
      .delete('/api/v1/customer-mappings')
      .expect(400);

    expect(response.body.error).toBe('olderThan query parameter is required');
  });

  test('should reject request with invalid date format', async () => {
    const response = await request(app)
      .delete('/api/v1/customer-mappings?olderThan=invalid-date')
      .expect(400);

    expect(response.body.error).toBe('Invalid date format for olderThan');
  });

  test('should reject request with overly long jobId', async () => {
    const invalidJobId = 'a'.repeat(51);
    const response = await request(app)
      .delete(`/api/v1/customer-mappings?olderThan=2025-01-01&jobId=${invalidJobId}`)
      .expect(400);

    expect(response.body.error).toBe('Invalid job ID');
  });

  test('should accept UUID style jobId', async () => {
    const jobId = '1b9317ca-6885-49f2-950a-44231765cf03';
    mappingService.deleteMappings.mockResolvedValue(5);

    await request(app)
      .delete(`/api/v1/customer-mappings?olderThan=2025-01-01&jobId=${jobId}`)
      .expect(200);

    expect(mappingService.deleteMappings).toHaveBeenCalledWith(
      new Date('2025-01-01'),
      jobId
    );
  });

  test('should handle database errors gracefully', async () => {
    mappingService.deleteMappings.mockRejectedValue(new Error('Database connection failed'));

    const response = await request(app)
      .delete('/api/v1/customer-mappings?olderThan=2025-01-01')
      .expect(500);

    expect(response.body.error).toBeDefined();
  });

  test('should accept ISO 8601 date format', async () => {
    mappingService.deleteMappings.mockResolvedValue(10);

    const response = await request(app)
      .delete('/api/v1/customer-mappings?olderThan=2025-01-01T00:00:00.000Z')
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      deletedCount: 10,
    });
  });

  test('should handle empty jobId parameter', async () => {
    mappingService.deleteMappings.mockResolvedValue(15);

    const response = await request(app)
      .delete('/api/v1/customer-mappings?olderThan=2025-01-01&jobId=')
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      deletedCount: 15,
    });

    // Should be called with null jobId
    expect(mappingService.deleteMappings).toHaveBeenCalledWith(
      new Date('2025-01-01'),
      null
    );
  });
});
