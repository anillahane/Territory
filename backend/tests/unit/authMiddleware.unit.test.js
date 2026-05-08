const {
  extractBearerToken,
  issueAccessToken,
  issueRefreshToken,
  requireAuth,
  requireRole
} = require('../../src/middleware/auth');

describe('auth middleware', () => {
  const originalJwtSecret = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = 'unit-test-secret';
  });

  afterAll(() => {
    process.env.JWT_SECRET = originalJwtSecret;
  });

  test('extractBearerToken returns token from Authorization header', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123');
    expect(extractBearerToken('')).toBeNull();
  });

  test('requireAuth attaches user from a valid access token', () => {
    const token = issueAccessToken({ id: '1', email: 'admin@example.com', role: 'admin' });
    const req = {
      headers: {
        authorization: `Bearer ${token}`
      }
    };
    const next = jest.fn();

    requireAuth(req, {}, next);

    expect(req.user).toEqual({
      id: '1',
      email: 'admin@example.com',
      role: 'admin'
    });
    expect(next).toHaveBeenCalledWith();
  });

  test('requireAuth rejects refresh tokens on access-protected routes', () => {
    const token = issueRefreshToken({ id: '1', email: 'admin@example.com', role: 'admin' });
    const req = {
      headers: {
        authorization: `Bearer ${token}`
      }
    };
    const next = jest.fn();

    requireAuth(req, {}, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].code).toBe('INVALID_TOKEN_TYPE');
  });

  test('requireRole enforces role hierarchy', () => {
    const middleware = requireRole('admin');
    const next = jest.fn();

    middleware({ user: { role: 'editor' } }, {}, next);
    expect(next.mock.calls[0][0].code).toBe('INSUFFICIENT_ROLE');

    next.mockClear();
    middleware({ user: { role: 'admin' } }, {}, next);
    expect(next).toHaveBeenCalledWith();
  });
});
