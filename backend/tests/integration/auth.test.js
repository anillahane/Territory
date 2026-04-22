const request = require('supertest');
const app = require('../../src/app');
const {
  setupTestDatabase,
  cleanupTestData,
  teardownTestDatabase,
} = require('./setup');

describe('Authentication API Integration Tests', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  test('should bootstrap the initial admin user and issue tokens on login', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'admin@example.com',
        password: 'Admin123!',
      })
      .expect(200);

    expect(response.body).toHaveProperty('accessToken');
    expect(response.body).toHaveProperty('refreshToken');
    expect(response.body.user).toMatchObject({
      email: 'admin@example.com',
      role: 'admin',
    });
  });

  test('should reject unauthenticated requests to protected routes', async () => {
    const response = await request(app).get('/api/v1/config').expect(401);

    expect(response.body).toHaveProperty('error', 'Authentication required');
  });

  test('should refresh an access token using a valid refresh token', async () => {
    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'admin@example.com',
        password: 'Admin123!',
      })
      .expect(200);

    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({
        refreshToken: loginResponse.body.refreshToken,
      })
      .expect(200);

    expect(response.body).toHaveProperty('accessToken');
    expect(response.body).toHaveProperty('refreshToken');
    expect(response.body.user).toMatchObject({
      email: 'admin@example.com',
      role: 'admin',
    });
  });
});
