/**
 * Integration Tests for Branches API
 */

const request = require('supertest');
const app = require('../../src/app');
const {
  setupTestDatabase,
  cleanupTestData,
  teardownTestDatabase,
  createAuthHeaders,
} = require('./setup');

describe('Branches API Integration Tests', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  describe('POST /api/v1/branches', () => {
    test('should create a new branch', async () => {
      const branch = {
        id: 'MUM001',
        city: 'Mumbai',
        lat: 19.0760,
        lon: 72.8777,
      };

      const response = await request(app)
        .post('/api/v1/branches')
        .set(createAuthHeaders('admin'))
        .send(branch)
        .expect(201);

      expect(response.body).toHaveProperty('branch');
      expect(response.body.branch.id).toBe(branch.id);
      expect(response.body.branch.city).toBe(branch.city);
      expect(response.body.branch).toHaveProperty('pocketId');
      expect(response.body.branch.pocketId).toMatch(
        /^[0-9A-Z]+-[0-9A-Z]+-[0-9A-Z]+-[0-9A-Z]+-[0-9A-Z]+$/
      );
    });

    test('should reject duplicate branch id', async () => {
      const branch = {
        id: 'MUM001',
        city: 'Mumbai',
        lat: 19.0760,
        lon: 72.8777,
      };

      // Create first branch
      await request(app)
        .post('/api/v1/branches')
        .set(createAuthHeaders('admin'))
        .send(branch)
        .expect(201);

      // Try to create duplicate
      await request(app)
        .post('/api/v1/branches')
        .set(createAuthHeaders('admin'))
        .send(branch)
        .expect(409);
    });

    test('should reject invalid coordinates', async () => {
      const branch = {
        id: 'INV001',
        city: 'Invalid Branch',
        lat: 100, // Invalid
        lon: 72.8777,
      };

      await request(app)
        .post('/api/v1/branches')
        .set(createAuthHeaders('admin'))
        .send(branch)
        .expect(400);
    });
  });

  describe('GET /api/v1/branches', () => {
    test('should return empty array when no branches', async () => {
      const response = await request(app)
        .get('/api/v1/branches')
        .set(createAuthHeaders('admin'))
        .expect(200);

      expect(Array.isArray(response.body.branches)).toBe(true);
      expect(response.body.branches.length).toBe(0);
    });

    test('should return all branches', async () => {
      // Create test branches
      const branches = [
        { id: 'MUM001', city: 'Mumbai', lat: 19.0760, lon: 72.8777 },
        { id: 'DEL001', city: 'Delhi', lat: 28.7041, lon: 77.1025 },
      ];

      for (const branch of branches) {
        await request(app)
          .post('/api/v1/branches')
          .set(createAuthHeaders('admin'))
          .send(branch);
      }
      const response = await request(app)
        .get('/api/v1/branches')
        .set(createAuthHeaders('admin'))
        .expect(200);

      expect(response.body.branches.length).toBe(2);
    });

    test('should support pagination', async () => {
      // Create 15 test branches
      for (let i = 1; i <= 15; i++) {
        await request(app)
          .post('/api/v1/branches')
          .set(createAuthHeaders('admin'))
          .send({
            id: `BR${String(i).padStart(3, '0')}`,
            city: `City ${i}`,
            lat: 19.0760,
            lon: 72.8777,
          });
      }

      const response = await request(app)
        .get('/api/v1/branches?limit=10&offset=0')
        .set(createAuthHeaders('admin'))
        .expect(200);

      expect(response.body.branches.length).toBe(10);
    });
  });

  describe('GET /api/v1/branches/:id', () => {
    test('should return branch by id', async () => {
      const branch = {
        id: 'MUM001',
        city: 'Mumbai',
        lat: 19.0760,
        lon: 72.8777,
      };

      const createResponse = await request(app)
        .post('/api/v1/branches')
        .set(createAuthHeaders('admin'))
        .send(branch);

      const response = await request(app)
        .get(`/api/v1/branches/${createResponse.body.branch.id}`)
        .set(createAuthHeaders('admin'))
        .expect(200);

      expect(response.body.id).toBe(createResponse.body.branch.id);
      expect(response.body.city).toBe(branch.city);
    });

    test('should return 404 for non-existent branch', async () => {
      await request(app)
        .get('/api/v1/branches/UNKNOWN')
        .set(createAuthHeaders('admin'))
        .expect(404);
    });
  });

  describe('PUT /api/v1/branches/:id', () => {
    test('should update branch', async () => {
      const branch = {
        id: 'MUM001',
        city: 'Mumbai',
        lat: 19.0760,
        lon: 72.8777,
      };

      const createResponse = await request(app)
        .post('/api/v1/branches')
        .set(createAuthHeaders('admin'))
        .send(branch);

      const updates = {
        city: 'Mumbai Main',
        lat: 19.0765,
        lon: 72.8780,
      };

      const response = await request(app)
        .put(`/api/v1/branches/${createResponse.body.branch.id}`)
        .set(createAuthHeaders('admin'))
        .send(updates)
        .expect(200);

      expect(response.body).toHaveProperty('branch');
      expect(response.body.branch.city).toBe(updates.city);
      expect(response.body.branch.lat).toBe(updates.lat);
      expect(response.body.branch.lon).toBe(updates.lon);
    });
  });

  describe('DELETE /api/v1/branches/:id', () => {
    test('should delete branch', async () => {
      const branch = {
        id: 'MUM001',
        city: 'Mumbai',
        lat: 19.0760,
        lon: 72.8777,
      };

      const createResponse = await request(app)
        .post('/api/v1/branches')
        .set(createAuthHeaders('admin'))
        .send(branch);

      await request(app)
        .delete(`/api/v1/branches/${createResponse.body.branch.id}`)
        .set(createAuthHeaders('admin'))
        .expect(200);

      // Verify deletion
      await request(app)
        .get(`/api/v1/branches/${createResponse.body.branch.id}`)
        .set(createAuthHeaders('admin'))
        .expect(404);
    });
  });
});
