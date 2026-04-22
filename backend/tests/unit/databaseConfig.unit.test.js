const buildMockPool = () => {
  const handlers = {};
  const pool = {
    connect: jest.fn(),
    idleCount: 0,
    on: jest.fn((event, handler) => {
      handlers[event] = handler;
    }),
    query: jest.fn(),
    totalCount: 0,
    waitingCount: 0,
  };

  return { handlers, pool };
};

describe('database config hardening', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      DB_HOST: 'db.internal',
      DB_PORT: '6543',
      DB_NAME: 'territory_test',
      DB_USER: 'territory_user',
      DB_POOL_MAX: '15',
      DB_POOL_IDLE_TIMEOUT_MS: '45000',
      DB_POOL_CONNECTION_TIMEOUT_MS: '3500',
      DB_STATEMENT_TIMEOUT_MS: '12000',
      DB_HEALTH_RETRY_ATTEMPTS: '2',
      DB_HEALTH_RETRY_DELAY_MS: '25',
    };
  });

  afterEach(async () => {
    process.env = originalEnv;
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test('builds the pool from env without inventing a postgres password fallback', () => {
    delete process.env.DB_PASSWORD;

    const { handlers, pool } = buildMockPool();
    const Pool = jest.fn(() => pool);

    jest.doMock('pg', () => ({ Pool }));
    jest.doMock('../../src/config/logger', () => ({
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    }));

    let databaseModule;

    jest.isolateModules(() => {
      databaseModule = require('../../src/config/database');
    });

    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      host: 'db.internal',
      port: 6543,
      database: 'territory_test',
      user: 'territory_user',
      password: undefined,
      max: 15,
      idleTimeoutMillis: 45000,
      connectionTimeoutMillis: 3500,
      statement_timeout: 12000,
      query_timeout: 12000,
    }));
    expect(typeof handlers.connect).toBe('function');
    expect(typeof handlers.error).toBe('function');
    expect(databaseModule.getDatabaseHealth()).toMatchObject({
      status: 'initializing',
      recoveryInProgress: false,
    });
  });

  test('marks the pool degraded and retries instead of exiting on pool errors', async () => {
    process.env.DB_PASSWORD = 'test-db-password';

    const { handlers, pool } = buildMockPool();
    const Pool = jest.fn(() => pool);
    const logger = {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    };

    pool.query.mockResolvedValue({ rows: [{ '?column?': 1 }], rowCount: 1 });

    jest.doMock('pg', () => ({ Pool }));
    jest.doMock('../../src/config/logger', () => logger);

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined);

    let databaseModule;

    jest.isolateModules(() => {
      databaseModule = require('../../src/config/database');
    });

    const poolError = Object.assign(new Error('Connection terminated unexpectedly'), {
      code: 'ECONNRESET',
    });

    handlers.error(poolError);

    expect(databaseModule.getDatabaseHealth()).toMatchObject({
      status: 'degraded',
      recoveryInProgress: true,
      recoveryAttempts: 1,
      lastError: 'Connection terminated unexpectedly',
      lastErrorCode: 'ECONNRESET',
    });
    expect(exitSpy).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(25);

    expect(pool.query).toHaveBeenCalledWith('SELECT 1');
    expect(databaseModule.getDatabaseHealth()).toMatchObject({
      status: 'connected',
      recoveryInProgress: false,
      recoveryAttempts: 0,
      lastError: null,
      lastErrorCode: null,
    });
    expect(logger.error).toHaveBeenCalledWith('Unexpected database pool error', expect.objectContaining({
      code: 'ECONNRESET',
      error: 'Connection terminated unexpectedly',
    }));

    exitSpy.mockRestore();
  });
});
