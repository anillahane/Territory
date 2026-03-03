/**
 * Integration Tests for Configuration API
 */

const request = require('supertest');
const app = require('../../src/app');
const { setupTestDatabase, cleanupTestData, teardownTestDatabase } = require('./setup');

describe('Configuration API Integration Tests', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  describe('GET /api/v1/config', () => {
    test('should return default configuration', async () => {
      const response = await request(app)
        .get('/api/v1/config')
        .expect(200);

      expect(response.body).toHaveProperty('originLat');
      expect(response.body).toHaveProperty('originLon');
      expect(response.body).toHaveProperty('alphabet');
      expect(response.body.alphabet).toHaveLength(30);
    });
  });

  describe('PUT /api/v1/config', () => {
    test('should update configuration', async () => {
      const newConfig = {
        originLat: 12.9716,
        originLon: 77.5946,
        alphabet: '0123456789ABCDEFGHJKLMNPQRSTUV',
      };

      const response = await request(app)
        .put('/api/v1/config')
        .send(newConfig)
        .expect(200);

      const updatedConfig = response.body.config || response.body;
      expect(updatedConfig.originLat).toBe(newConfig.originLat);
      expect(updatedConfig.originLon).toBe(newConfig.originLon);
      expect(updatedConfig.alphabet).toBe(newConfig.alphabet);
    });

    test('should reject invalid latitude', async () => {
      const invalidConfig = {
        originLat: 100, // Invalid: > 90
        originLon: 77.5946,
        alphabet: '0123456789ABCDEFGHJKLMNPQRSTUV',
      };

      await request(app)
        .put('/api/v1/config')
        .send(invalidConfig)
        .expect(400);
    });

    test('should reject invalid alphabet length', async () => {
      const invalidConfig = {
        originLat: 12.9716,
        originLon: 77.5946,
        alphabet: 'ABC', // Invalid: too short
      };

      await request(app)
        .put('/api/v1/config')
        .send(invalidConfig)
        .expect(400);
    });
  });

  describe('GET /api/v1/config/history', () => {
    test('should return configuration history', async () => {
      // First, update config to create history
      await request(app)
        .put('/api/v1/config')
        .send({
          originLat: 12.9716,
          originLon: 77.5946,
          alphabet: '0123456789ABCDEFGHJKLMNPQRSTUV',
        });

      const response = await request(app)
        .get('/api/v1/config/history')
        .expect(200);

      const history = response.body.history || response.body;

      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeGreaterThan(0);
      expect(history[0].changedAt || history[0].changed_at).toBeDefined();
      expect(history[0].alphabet || history[0].config).toBeDefined();
    });
  });
});
