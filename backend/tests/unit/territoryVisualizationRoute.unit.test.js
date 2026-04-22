const express = require('express');
const request = require('supertest');

jest.mock('../../src/config/database', () => ({
  query: jest.fn()
}));

jest.mock('../../src/config/queue', () => ({
  batchProcessQueue: {
    add: jest.fn(),
    client: {
      lpush: jest.fn()
    },
    on: jest.fn(),
    process: jest.fn()
  }
}));

jest.mock('../../src/services/MappingService', () => ({}));
jest.mock('../../src/services/BranchFinderService', () => ({}));
jest.mock('../../src/services/TerritoryCache', () => ({
  buildVisualizationCacheKey: jest.fn(),
  getCachedVisualization: jest.fn(),
  cacheVisualizationResponse: jest.fn(),
  invalidateVisualizationCacheIfNeeded: jest.fn()
}));

const { errorHandler } = require('../../src/middleware/errorHandler');
const batchRoutes = require('../../src/routes/batch');
const { query } = require('../../src/config/database');
const territoryCache = require('../../src/services/TerritoryCache');

const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'test-admin', role: 'admin' };
    next();
  });
  app.use('/api/v1/batch', batchRoutes);
  app.use(errorHandler);
  return app;
};

describe('GET /api/v1/batch/territories/visualization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns the cached visualization payload before running territory queries', async () => {
    query.mockImplementation((queryText) => {
      if (queryText.includes('SELECT job_id FROM jobs')) {
        return Promise.resolve({ rows: [{ job_id: 'job-7' }] });
      }

      if (queryText.includes('SELECT version, origin_lat, origin_lon, alphabet FROM config')) {
        return Promise.resolve({
          rows: [{
            version: 5,
            origin_lat: 8,
            origin_lon: 68,
            alphabet: '0123456789ABCDEFGHJKLMNPQRSTUV'
          }]
        });
      }

      throw new Error(`Unexpected query: ${queryText}`);
    });

    territoryCache.buildVisualizationCacheKey.mockReturnValue('territory:visualization:test');
    territoryCache.getCachedVisualization.mockResolvedValue({
      jobId: 'job-7',
      mode: 'existing_customers',
      modeLabel: 'Existing Customers',
      customerView: 'selected_pockets',
      maxSelectableBranches: 1,
      selectedBranchIds: [],
      availableBranches: [],
      summary: {
        territories: 0,
        branches: 0,
        points: 0,
        customers: 0,
        customersVisible: 0,
        selectedPocketCustomersVisible: 0,
        originalCustomersVisible: 0,
        pockets: 0,
        sourceType: 'customers'
      },
      territories: { type: 'FeatureCollection', features: [] },
      branches: { type: 'FeatureCollection', features: [] },
      points: { type: 'FeatureCollection', features: [] },
      customers: { type: 'FeatureCollection', features: [] }
    });

    const response = await request(createTestApp())
      .get('/api/v1/batch/territories/visualization')
      .query({
        jobId: 'job-7',
        mode: 'existing_customers',
        customerView: 'selected_pockets'
      })
      .expect(200);

    expect(territoryCache.invalidateVisualizationCacheIfNeeded).toHaveBeenCalledWith({
      latestJobId: null,
      configVersion: 5
    });
    expect(territoryCache.getCachedVisualization).toHaveBeenCalledWith(
      'territory:visualization:test'
    );
    expect(response.body.jobId).toBe('job-7');
    expect(response.body.mode).toBe('existing_customers');
    expect(query).toHaveBeenCalledTimes(2);
  });
});
