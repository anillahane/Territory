/**
 * Integration Tests for Branches API
 */

const request = require('supertest');
const app = require('../../src/app');
const { setupTestDatabase, cleanupTestData, teardownTestDatabase } = require('./setup');

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
        name: 'Mumbai Branch',
        code: 'MUM001',
        latitude: 19.0760,
        longitude: 72.8777,
        address: '123 Marine Drive, Mumbai',
      };

      const response = await request(app)
        .post('/api/v1/branches')
        .send(branch)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe(branch.name);
      expect(response.body.code).toBe(branch.code);
      expect(response.body).toHaveProperty('pocket_id');
      expect(response.body.pocket_id).toMatch(/^[0-9A-Z]+-[0-9A-Z]+-[0-9A-Z]+-[0-9A-Z]+-[0-9A-Z]+$/);
    });

    test('should reject duplicate branch code', async () => {
      const branch = {
        name: 'Mumbai Branch',
        code: 'MUM001',
        latitude: 19.0760,
        longitude: 72.8777,
      };

      // Create first branch
      await request(app)
        .post('/api/v1/branches')
        .send(branch)
        .expect(201);

      // Try to create duplicate
      await request(app)
        .post('/api/v1/branches')
        .send(branch)
        .expect(409);
    });

    test('should reject invalid coordinates', async () => {
      const branch = {
        name: 'Invalid Branch',
        code: 'INV001',
        latitude: 100, // Invalid
        longitude: 72.8777,
      };

      await request(app)
        .post('/api/v1/branches')
        .send(branch)
        .expect(400);
    });
  });

  describe('GET /api/v1/branches', () => {
    test('should return empty array when no branches', async () => {
      const response = await request(app)
        .get('/api/v1/branches')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(0);
    });

    test('should return all branches', async () => {
      // Create test branches
      const branches = [
        { name: 'Mumbai', code: 'MUM001', latitude: 19.0760, longitude: 72.8777 },
        { name: 'Delhi', code: 'DEL001', latitude: 28.7041, longitude: 77.1025 },
      ];

      for (const branch of branches) {
        await request(app).post('/api/v1/branches').send(branch);
      }

      const response = await request(app)
        .get('/api/v1/branches')
        .expect(200);

      expect(response.body.length).toBe(2);
    });

    test('should support pagination', async () => {
      // Create 15 test branches
      for (let i = 1; i <= 15; i++) {
        await request(app)
          .post('/api/v1/branches')
          .send({
            name: `Branch ${i}`,
            code: `BR${String(i).padStart(3, '0')}`,
            latitude: 19.0760,
            longitude: 72.8777,
          });
      }

      const response = await request(app)
        .get('/api/v1/branches?page=1&limit=10')
        .expect(200);

      expect(response.body.length).toBe(10);
    });
  });

  describe('GET /api/v1/branches/:id', () => {
    test('should return branch by id', async () => {
      const branch = {
        name: 'Mumbai Branch',
        code: 'MUM001',
        latitude: 19.0760,
        longitude: 72.8777,
      };

      const createResponse = await request(app)
        .post('/api/v1/branches')
        .send(branch);

      const response = await request(app)
        .get(`/api/v1/branches/${createResponse.body.id}`)
        .expect(200);

      expect(response.body.id).toBe(createResponse.body.id);
      expect(response.body.name).toBe(branch.name);
    });

    test('should return 404 for non-existent branch', async () => {
      await request(app)
        .get('/api/v1/branches/99999')
        .expect(404);
    });
  });

  describe('PUT /api/v1/branches/:id', () => {
    test('should update branch', async () => {
      const branch = {
        name: 'Mumbai Branch',
        code: 'MUM001',
        latitude: 19.0760,
        longitude: 72.8777,
      };

      const createResponse = await request(app)
        .post('/api/v1/branches')
        .send(branch);

      const updates = {
        name: 'Mumbai Main Branch',
        address: 'New Address',
      };

      const response = await request(app)
        .put(`/api/v1/branches/${createResponse.body.id}`)
        .send(updates)
        .expect(200);

      expect(response.body.name).toBe(updates.name);
      expect(response.body.address).toBe(updates.address);
    });
  });

  describe('DELETE /api/v1/branches/:id', () => {
    test('should delete branch', async () => {
      const branch = {
        name: 'Mumbai Branch',
        code: 'MUM001',
        latitude: 19.0760,
        longitude: 72.8777,
      };

      const createResponse = await request(app)
        .post('/api/v1/branches')
        .send(branch);

      await request(app)
        .delete(`/api/v1/branches/${createResponse.body.id}`)
        .expect(204);

      // Verify deletion
      await request(app)
        .get(`/api/v1/branches/${createResponse.body.id}`)
        .expect(404);
    });
  });
});
