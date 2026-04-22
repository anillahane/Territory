/**
 * Integration Tests for Pocket ID API
 */

const request = require('supertest');
const app = require('../../src/app');
const {
  setupTestDatabase,
  cleanupTestData,
  teardownTestDatabase,
  createAuthHeaders,
} = require('./setup');

describe('Pocket ID API Integration Tests', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  describe('POST /api/v1/pocket/encode', () => {
    test('should encode coordinates to Pocket ID', async () => {
      const response = await request(app)
        .post('/api/v1/pocket/encode')
        .set(createAuthHeaders('viewer'))
        .send({
          latitude: 12.9716,
          longitude: 77.5946,
        })
        .expect(200);

      expect(response.body).toHaveProperty('pocketId');
      expect(response.body.pocketId).toMatch(/^[0-9A-Z]+-[0-9A-Z]+-[0-9A-Z]+-[0-9A-Z]+-[0-9A-Z]+$/);
      expect(response.body).toHaveProperty('indices');
      expect(response.body.indices).toHaveLength(5);
    });

    test('should reject invalid coordinates', async () => {
      await request(app)
        .post('/api/v1/pocket/encode')
        .set(createAuthHeaders('viewer'))
        .send({
          latitude: 100, // Invalid
          longitude: 77.5946,
        })
        .expect(400);
    });
  });

  describe('POST /api/v1/pocket/decode', () => {
    test('should decode Pocket ID to coordinates', async () => {
      // First encode
      const encodeResponse = await request(app)
        .post('/api/v1/pocket/encode')
        .set(createAuthHeaders('viewer'))
        .send({
          latitude: 12.9716,
          longitude: 77.5946,
        });

      const pocketId = encodeResponse.body.pocketId;

      // Then decode
      const response = await request(app)
        .post('/api/v1/pocket/decode')
        .set(createAuthHeaders('viewer'))
        .send({ pocketId })
        .expect(200);

      expect(response.body).toHaveProperty('centerLat');
      expect(response.body).toHaveProperty('centerLon');
      expect(response.body).toHaveProperty('corners');
      expect(response.body.corners).toHaveProperty('sw');
      expect(response.body.corners).toHaveProperty('ne');
    });

    test('should reject invalid Pocket ID format', async () => {
      await request(app)
        .post('/api/v1/pocket/decode')
        .set(createAuthHeaders('viewer'))
        .send({ pocketId: 'INVALID' })
        .expect(400);
    });
  });

  describe('POST /api/v1/pocket/validate', () => {
    test('should validate correct Pocket ID', async () => {
      const response = await request(app)
        .post('/api/v1/pocket/validate')
        .set(createAuthHeaders('viewer'))
        .send({ pocketId: '00-00-00-00-00' })
        .expect(200);

      expect(response.body.valid).toBe(true);
    });

    test('should reject invalid Pocket ID', async () => {
      const response = await request(app)
        .post('/api/v1/pocket/validate')
        .set(createAuthHeaders('viewer'))
        .send({ pocketId: 'INVALID' })
        .expect(200);

      expect(response.body.valid).toBe(false);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Round-trip encoding/decoding', () => {
    test('should maintain accuracy through encode-decode cycle', async () => {
      const originalLat = 12.9716;
      const originalLon = 77.5946;

      // Encode
      const encodeResponse = await request(app)
        .post('/api/v1/pocket/encode')
        .set(createAuthHeaders('viewer'))
        .send({
          latitude: originalLat,
          longitude: originalLon,
        });

      // Decode
      const decodeResponse = await request(app)
        .post('/api/v1/pocket/decode')
        .set(createAuthHeaders('viewer'))
        .send({ pocketId: encodeResponse.body.pocketId });

      // Should be within 1km (finest grid level)
      const latDiff = Math.abs(decodeResponse.body.centerLat - originalLat);
      const lonDiff = Math.abs(decodeResponse.body.centerLon - originalLon);

      expect(latDiff).toBeLessThan(0.01); // ~1km
      expect(lonDiff).toBeLessThan(0.01); // ~1km
    });
  });
});
