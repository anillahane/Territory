const express = require('express');
const request = require('supertest');

jest.mock('../../src/config/database', () => ({
  getDatabaseHealth: jest.fn(),
  query: jest.fn(),
}));

jest.mock('../../src/config/logger', () => ({
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
}));

const healthRoutes = require('../../src/routes/health');
const { getDatabaseHealth, query } = require('../../src/config/database');

const createApp = () => {
  const app = express();
  app.use('/health', healthRoutes);
  return app;
};

describe('GET /health', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('returns connection health metadata when checks pass', async () => {
    getDatabaseHealth.mockReturnValue({
      status: 'connected',
      recoveryInProgress: false,
      recoveryAttempts: 0,
      lastHealthyAt: '2026-04-22T12:05:00.000Z',
      lastRecoveryAt: '2026-04-22T12:05:00.000Z',
      lastError: null,
      lastErrorCode: null,
      lastErrorAt: null,
    });

    query
      .mockResolvedValueOnce({
        rows: [{ now: '2026-04-22T12:05:00.000Z' }],
      })
      .mockResolvedValueOnce({
        rows: [{ version: '3.3.2' }],
      });

    const response = await request(createApp())
      .get('/health')
      .expect(200);

    expect(response.body.status).toBe('ok');
    expect(response.body.database).toMatchObject({
      status: 'connected',
      recoveryInProgress: false,
      recoveryAttempts: 0,
      lastHealthyAt: '2026-04-22T12:05:00.000Z',
      lastRecoveryAt: '2026-04-22T12:05:00.000Z',
      lastError: null,
    });
    expect(response.body.postgis).toEqual({
      status: 'available',
      version: '3.3.2',
    });
  });

  test('returns 503 and exposes degraded state when the database check fails', async () => {
    getDatabaseHealth.mockReturnValue({
      status: 'degraded',
      recoveryInProgress: true,
      recoveryAttempts: 3,
      lastHealthyAt: '2026-04-22T11:55:00.000Z',
      lastRecoveryAt: null,
      lastError: 'Connection terminated unexpectedly',
      lastErrorCode: 'ECONNRESET',
      lastErrorAt: '2026-04-22T12:00:00.000Z',
    });

    query.mockRejectedValue(new Error('database unavailable'));

    const response = await request(createApp())
      .get('/health')
      .expect(503);

    expect(response.body.status).toBe('error');
    expect(response.body.database).toMatchObject({
      status: 'degraded',
      recoveryInProgress: true,
      recoveryAttempts: 3,
      lastError: 'Connection terminated unexpectedly',
      lastErrorCode: 'ECONNRESET',
      error: 'database unavailable',
    });
  });
});
