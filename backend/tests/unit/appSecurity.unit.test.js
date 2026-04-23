const request = require('supertest');

describe('application security hardening', () => {
  let app;
  const originalEnv = {};
  const managedEnvKeys = [
    'ALLOWED_ORIGINS',
    'RATE_LIMIT_WINDOW_MS',
    'RATE_LIMIT_PUBLIC_MAX_REQUESTS',
    'RATE_LIMIT_AUTH_MAX_REQUESTS',
    'RATE_LIMIT_STANDARD_MAX_REQUESTS',
    'RATE_LIMIT_ADMIN_MAX_REQUESTS',
    'RATE_LIMIT_HEAVY_MAX_REQUESTS',
  ];

  beforeAll(() => {
    managedEnvKeys.forEach((key) => {
      originalEnv[key] = process.env[key];
    });

    process.env.ALLOWED_ORIGINS = 'https://allowed.example.com';
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    process.env.RATE_LIMIT_PUBLIC_MAX_REQUESTS = '5';
    process.env.RATE_LIMIT_AUTH_MAX_REQUESTS = '1';
    process.env.RATE_LIMIT_STANDARD_MAX_REQUESTS = '20';
    process.env.RATE_LIMIT_ADMIN_MAX_REQUESTS = '10';
    process.env.RATE_LIMIT_HEAVY_MAX_REQUESTS = '2';

    jest.resetModules();
    app = require('../../src/app');
  });

  afterAll(() => {
    managedEnvKeys.forEach((key) => {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
        return;
      }

      process.env[key] = originalEnv[key];
    });

    jest.resetModules();
  });

  test('allows explicitly configured origins', async () => {
    const response = await request(app)
      .get('/')
      .set('Origin', 'https://allowed.example.com')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe('https://allowed.example.com');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  test('rejects origins outside ALLOWED_ORIGINS', async () => {
    const response = await request(app)
      .get('/')
      .set('Origin', 'https://blocked.example.com')
      .expect(403);

    expect(response.body).toMatchObject({
      error: 'CORS blocked for origin: https://blocked.example.com',
      code: 'CORS_BLOCKED',
    });
  });

  test('sets a restrictive content security policy header', async () => {
    const response = await request(app)
      .get('/')
      .expect(200);

    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['content-security-policy']).toContain("script-src 'self'");
    expect(response.headers['content-security-policy']).toContain("style-src 'self' 'unsafe-inline'");
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });

  test('applies the public rate-limit tier to docs endpoints', async () => {
    for (let index = 0; index < 5; index += 1) {
      await request(app)
        .get('/api/v1/docs/openapi.yaml')
        .expect(200);
    }

    const response = await request(app)
      .get('/api/v1/docs/openapi.yaml')
      .expect(429);

    expect(response.body).toMatchObject({
      error: 'Too many requests from this IP, please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
    });
  });

  test('applies a stricter auth rate-limit tier', async () => {
    await request(app)
      .post('/api/v1/auth/login')
      .send({})
      .expect(400);

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({})
      .expect(429);

    expect(response.body).toMatchObject({
      error: 'Too many requests from this IP, please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
    });
  });
});
