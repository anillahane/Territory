const request = require('supertest');

const app = require('../../src/app');

describe('API documentation routes', () => {
  test('serves the OpenAPI document as YAML', async () => {
    const response = await request(app)
      .get('/api/v1/docs/openapi.yaml')
      .expect(200);

    expect(response.headers['content-type']).toMatch(/yaml|text\/plain/);
    expect(response.text).toContain('openapi: 3.0.3');
    expect(response.text).toContain('/api/v1/auth/login:');
    expect(response.text).toContain('/api/v1/customer-mappings/batch:');
    expect(response.text).toContain('/health:');
  });

  test('serves the Swagger UI shell', async () => {
    const response = await request(app)
      .get('/api/v1/docs/')
      .expect(200);

    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.text).toContain('Swagger UI');
    expect(response.text).toContain('swagger-ui-init.js');
  });

  test('points the Swagger UI config at the OpenAPI YAML document', async () => {
    const response = await request(app)
      .get('/api/v1/docs/swagger-ui-init.js')
      .expect(200);

    expect(response.headers['content-type']).toMatch(/javascript/);
    expect(response.text).toContain('/api/v1/docs/openapi.yaml');
  });
});
