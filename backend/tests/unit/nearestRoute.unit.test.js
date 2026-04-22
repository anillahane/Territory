const express = require('express');
const request = require('supertest');

jest.mock('../../src/services/NearestService', () => ({
  findNearestBranches: jest.fn(),
}));

jest.mock('../../src/config/database', () => ({
  query: jest.fn(),
}));

const nearestRoutes = require('../../src/routes/nearest');
const nearestService = require('../../src/services/NearestService');

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/nearest', nearestRoutes);
  return app;
};

describe('nearest routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('POST /api/v1/nearest delegates to NearestService', async () => {
    nearestService.findNearestBranches.mockResolvedValueOnce([
      {
        id: 'BR001',
        city: 'Mumbai',
        lat: 19.076,
        lon: 72.8777,
        pocketId: 'PKT001',
        distance: 1250.4,
      },
    ]);

    const response = await request(createApp())
      .post('/api/v1/nearest')
      .send({ lat: 19.08, lon: 72.88, limit: 1, maxDistance: 5000 })
      .expect(200);

    expect(nearestService.findNearestBranches).toHaveBeenCalledWith({
      lat: 19.08,
      lon: 72.88,
      limit: 1,
      maxDistance: 5000,
    });
    expect(response.body.count).toBe(1);
    expect(response.body.branches[0]).toMatchObject({
      id: 'BR001',
      distance: 1250,
      distanceKm: '1.25',
    });
  });

  test('POST /api/v1/nearest/fallback returns indexed PostGIS results with a deprecation warning', async () => {
    nearestService.findNearestBranches.mockResolvedValueOnce([
      {
        id: 'BR001',
        city: 'Mumbai',
        lat: 19.076,
        lon: 72.8777,
        pocketId: 'PKT001',
        distance: 1250.4,
      },
    ]);

    const response = await request(createApp())
      .post('/api/v1/nearest/fallback')
      .send({ lat: 19.08, lon: 72.88, limit: 1 })
      .expect(200);

    expect(nearestService.findNearestBranches).toHaveBeenCalledWith({
      lat: 19.08,
      lon: 72.88,
      limit: 1,
      maxDistance: null,
    });
    expect(response.body.warning).toContain('deprecated');
    expect(response.body.branches).toHaveLength(1);
  });
});
