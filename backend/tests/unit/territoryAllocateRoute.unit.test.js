const request = require('supertest');
const express = require('express');

jest.mock('../../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(async (callback) => callback({ query: jest.fn() }))
}));
jest.mock('../../src/config/queue', () => ({
  batchProcessQueue: {
    process: jest.fn(),
    on: jest.fn()
  }
}));
jest.mock('../../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));
jest.mock('../../src/routes/territoryAllocator', () => ({
  handleTerritoryAllocate: jest.fn()
}));

const { query } = require('../../src/config/database');
const batchRoutes = require('../../src/routes/batch');
const { errorHandler } = require('../../src/middleware/errorHandler');

const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/batch', batchRoutes);
  app.use(errorHandler);
  return app;
};

describe('POST /api/v1/batch/territories/allocate', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  test('selected-only mode returns valid GeoJSON', async () => {
    query.mockImplementation(async (sql) => {
      const text = String(sql);

      if (text.includes('SELECT job_id FROM jobs')) {
        return { rows: [{ job_id: 'job-1' }] };
      }

      if (text.includes('SELECT id, city, lat, lon, updated_at FROM branches ORDER BY id')) {
        return {
          rows: [
            { id: 'A', city: 'Alpha', lat: 20.0, lon: 77.0, updated_at: '2026-04-21T00:00:00.000Z' },
            { id: 'B', city: 'Beta', lat: 20.0, lon: 77.4, updated_at: '2026-04-21T00:00:00.000Z' },
            { id: 'C', city: 'Gamma', lat: 20.0, lon: 77.1, updated_at: '2026-04-21T00:00:00.000Z' }
          ]
        };
      }

      if (text.includes('FROM customer_pocket_mappings') && text.includes('nearest_branch_id = ANY')) {
        return {
          rows: [
            {
              customer_id: 'CUST1',
              customer_lat: 20.0,
              customer_lon: 77.12,
              pocket_id: 'P1',
              nearest_branch_id: 'A',
              existing_branch_id: 'A',
              uploaded_branch_code: 'A'
            }
          ]
        };
      }

      if (text.includes('FROM customer_pocket_mappings') && text.includes('customer_lon BETWEEN')) {
        return {
          rows: [
            {
              customer_id: 'CUST1',
              customer_lat: 20.0,
              customer_lon: 77.12,
              pocket_id: 'P1',
              nearest_branch_id: 'A',
              existing_branch_id: 'A',
              uploaded_branch_code: 'A'
            }
          ]
        };
      }

      if (text.includes('FROM jsonb_to_recordset')) {
        return {
          rows: [
            {
              features: [
                {
                  type: 'Feature',
                  properties: {
                    branchId: 'A',
                    winner_branch_id: 'A',
                    color: '#EF4444',
                    branchColor: '#EF4444',
                    score: 1,
                    had_customers: true,
                    customer_count_in_box: 1,
                    box_count: 4
                  },
                  geometry: {
                    type: 'Polygon',
                    coordinates: [[[77, 20], [77.1, 20], [77.1, 20.1], [77, 20.1], [77, 20]]]
                  }
                },
                {
                  type: 'Feature',
                  properties: {
                    branchId: 'B',
                    winner_branch_id: 'B',
                    color: '#3B82F6',
                    branchColor: '#3B82F6',
                    score: 0.8,
                    had_customers: false,
                    customer_count_in_box: 0,
                    box_count: 4
                  },
                  geometry: {
                    type: 'Polygon',
                    coordinates: [[[77.1, 20], [77.2, 20], [77.2, 20.1], [77.1, 20.1], [77.1, 20]]]
                  }
                }
              ],
              total_area_km2: 100,
              union_area_km2: 100
            }
          ]
        };
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    });

    const response = await request(app)
      .post('/api/v1/batch/territories/allocate')
      .send({
        mode: 'selected_only',
        selected_branch_ids: ['A', 'B'],
        customer_view: 'selected_pockets',
        grid_size_km: 5,
        merge_adjacent: true,
        job_id: 'job-1'
      })
      .expect(200);

    expect(response.body.mode).toBe('selected_only');
    expect(response.body.feature_collection.type).toBe('FeatureCollection');
    expect(Array.isArray(response.body.feature_collection.features)).toBe(true);
    expect(response.body.branches.type).toBe('FeatureCollection');
    expect(response.body.payload.selectedBranchIds).toEqual(['A', 'B']);
    expect(response.body.stats.total_boxes).toBeGreaterThan(0);
    expect(response.body.stats.polygon_overlap_area_km2).toBe(0);
  });

  test('full-network and selected-only modes can return different coverage for the same selection', async () => {
    query.mockImplementation(async (sql, params) => {
      const text = String(sql);

      if (text.includes('SELECT cpm.job_id')) {
        return { rows: [{ job_id: 'job-1' }] };
      }

      if (text.includes('SELECT id, city, lat, lon, updated_at FROM branches ORDER BY id')) {
        return {
          rows: [
            { id: 'A', city: 'Alpha', lat: 20.0, lon: 77.0, updated_at: '2026-04-21T00:00:00.000Z' },
            { id: 'B', city: 'Beta', lat: 20.0, lon: 77.4, updated_at: '2026-04-21T00:00:00.000Z' },
            { id: 'C', city: 'Gamma', lat: 20.0, lon: 77.1, updated_at: '2026-04-21T00:00:00.000Z' }
          ]
        };
      }

      if (text.includes('FROM branches') && text.includes('WHERE id = ANY')) {
        return {
          rows: [
            { id: 'A', city: 'Alpha', lat: 20.0, lon: 77.0, updated_at: '2026-04-21T00:00:00.000Z' },
            { id: 'B', city: 'Beta', lat: 20.0, lon: 77.4, updated_at: '2026-04-21T00:00:00.000Z' }
          ]
        };
      }

      if (text.includes('FROM branch_coverage_datasets')) {
        return {
          rows: [
            {
              branch_id: 'A',
              basis_type: 'closest_branch',
              source_mode: 'nearest_pockets',
              coverage_style: 'overlap',
              source_job_id: 'job-1',
              status: 'ready',
              total_customer_count: 0,
              native_customer_count: 0,
              catchment_customer_count: 0,
              farthest_customer_distance_km: 0,
              territory_geojson: { type: 'FeatureCollection', features: [] },
              territory_customers_geojson: { type: 'FeatureCollection', features: [] },
              original_customers_geojson: { type: 'FeatureCollection', features: [] },
              branch_feature_geojson: {
                type: 'FeatureCollection',
                features: [
                  {
                    type: 'Feature',
                    properties: { branchId: 'A', city: 'Alpha', customerCount: 0 },
                    geometry: { type: 'Point', coordinates: [77.0, 20.0] }
                  }
                ]
              },
              metadata: { stats: { total_boxes: 25 }, warnings: [] },
              computed_at: '2026-04-21T01:00:00.000Z',
              updated_at: '2026-04-21T01:00:00.000Z'
            },
            {
              branch_id: 'B',
              basis_type: 'closest_branch',
              source_mode: 'nearest_pockets',
              coverage_style: 'overlap',
              source_job_id: 'job-1',
              status: 'ready',
              total_customer_count: 0,
              native_customer_count: 0,
              catchment_customer_count: 0,
              farthest_customer_distance_km: 0,
              territory_geojson: { type: 'FeatureCollection', features: [] },
              territory_customers_geojson: { type: 'FeatureCollection', features: [] },
              original_customers_geojson: { type: 'FeatureCollection', features: [] },
              branch_feature_geojson: {
                type: 'FeatureCollection',
                features: [
                  {
                    type: 'Feature',
                    properties: { branchId: 'B', city: 'Beta', customerCount: 0 },
                    geometry: { type: 'Point', coordinates: [77.4, 20.0] }
                  }
                ]
              },
              metadata: { stats: { total_boxes: 25 }, warnings: [] },
              computed_at: '2026-04-21T01:00:00.000Z',
              updated_at: '2026-04-21T01:00:00.000Z'
            }
          ]
        };
      }

      if (text.includes('SELECT job_id FROM jobs')) {
        return { rows: [{ job_id: 'job-1' }] };
      }

      if (text.includes('FROM customer_pocket_mappings') && text.includes('nearest_branch_id = ANY')) {
        return {
          rows: [
            {
              customer_id: 'CUST1',
              customer_lat: 20.0,
              customer_lon: 77.12,
              pocket_id: 'P1',
              nearest_branch_id: 'A',
              existing_branch_id: 'A',
              uploaded_branch_code: 'A'
            }
          ]
        };
      }

      if (text.includes('FROM customer_pocket_mappings') && text.includes('customer_lon BETWEEN')) {
        return {
          rows: [
            {
              customer_id: 'CUST1',
              customer_lat: 20.0,
              customer_lon: 77.12,
              pocket_id: 'P1',
              nearest_branch_id: 'A',
              existing_branch_id: 'A',
              uploaded_branch_code: 'A'
            }
          ]
        };
      }

      if (text.includes('FROM jsonb_to_recordset')) {
        return {
          rows: [
            {
              features: [
                {
                  type: 'Feature',
                  properties: {
                    branchId: 'A',
                    winner_branch_id: 'A',
                    color: '#EF4444',
                    branchColor: '#EF4444',
                    score: 1,
                    had_customers: true,
                    customer_count_in_box: 1,
                    box_count: 6
                  },
                  geometry: {
                    type: 'Polygon',
                    coordinates: [[[77, 20], [77.15, 20], [77.15, 20.1], [77, 20.1], [77, 20]]]
                  }
                },
                {
                  type: 'Feature',
                  properties: {
                    branchId: 'B',
                    winner_branch_id: 'B',
                    color: '#3B82F6',
                    branchColor: '#3B82F6',
                    score: 0.4,
                    had_customers: false,
                    customer_count_in_box: 0,
                    box_count: 6
                  },
                  geometry: {
                    type: 'Polygon',
                    coordinates: [[[77.15, 20], [77.3, 20], [77.3, 20.1], [77.15, 20.1], [77.15, 20]]]
                  }
                }
              ],
              total_area_km2: 140,
              union_area_km2: 140
            }
          ]
        };
      }

      throw new Error(`Unexpected SQL in test: ${text} :: ${JSON.stringify(params || [])}`);
    });

    const fullNetworkResponse = await request(app)
      .post('/api/v1/batch/territories/allocate')
      .send({
        mode: 'full_network',
        selected_branch_ids: ['A', 'B'],
        customer_view: 'selected_pockets'
      })
      .expect(200);

    const selectedOnlyResponse = await request(app)
      .post('/api/v1/batch/territories/allocate')
      .send({
        mode: 'selected_only',
        selected_branch_ids: ['A', 'B'],
        customer_view: 'selected_pockets',
        job_id: 'job-2'
      })
      .expect(200);

    expect(fullNetworkResponse.body.feature_collection.features).toHaveLength(0);
    expect(selectedOnlyResponse.body.feature_collection.features.length).toBeGreaterThan(0);
  });
});
