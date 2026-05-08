const jwt = require('jsonwebtoken');
const { AppError } = require('./errorHandler');

const ROLE_PRIORITY = Object.freeze({
  viewer: 1,
  editor: 2,
  admin: 3
});

const ACCESS_TOKEN_TTL = process.env.JWT_ACCESS_TTL || '15m';
const REFRESH_TOKEN_TTL = process.env.JWT_REFRESH_TTL || '7d';

const getJwtSecret = () => {
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must be configured in production');
    }
  }
  return secret || 'development-only-jwt-secret';
};

const normalizeRole = (role) => {
  const normalizedRole = String(role || 'viewer').trim().toLowerCase();
  return ROLE_PRIORITY[normalizedRole] ? normalizedRole : 'viewer';
};

const createTokenPayload = (user) => ({
  sub: String(user.id),
  email: String(user.email || '').trim().toLowerCase(),
  role: normalizeRole(user.role)
});

const issueAccessToken = (user) => jwt.sign(
  {
    ...createTokenPayload(user),
    type: 'access'
  },
  getJwtSecret(),
  { expiresIn: ACCESS_TOKEN_TTL }
);

const issueRefreshToken = (user) => jwt.sign(
  {
    ...createTokenPayload(user),
    type: 'refresh'
  },
  getJwtSecret(),
  { expiresIn: REFRESH_TOKEN_TTL }
);

const verifyToken = (token, expectedType = 'access') => {
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (decoded.type !== expectedType) {
      throw new AppError('Invalid token type', 401, 'INVALID_TOKEN_TYPE');
    }
    return decoded;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError('Authentication required', 401, 'INVALID_TOKEN');
  }
};

const extractBearerToken = (authorizationHeader) => {
  const headerValue = String(authorizationHeader || '').trim();
  if (!headerValue) {
    return null;
  }

  const [scheme, token] = headerValue.split(/\s+/, 2);
  if (scheme !== 'Bearer' || !token) {
    return null;
  }
  return token.trim();
};

const requireAuth = (req, _res, next) => {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    next(new AppError('Authentication required', 401, 'AUTH_REQUIRED'));
    return;
  }

  try {
    const decoded = verifyToken(token, 'access');
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      role: normalizeRole(decoded.role)
    };
    next();
  } catch (error) {
    next(error);
  }
};

const requireRole = (requiredRole) => (req, _res, next) => {
  const currentRole = normalizeRole(req.user?.role);
  const targetRole = normalizeRole(requiredRole);
  if (ROLE_PRIORITY[currentRole] < ROLE_PRIORITY[targetRole]) {
    next(new AppError('Insufficient permissions', 403, 'INSUFFICIENT_ROLE'));
    return;
  }
  next();
};

module.exports = {
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL,
  extractBearerToken,
  getJwtSecret,
  issueAccessToken,
  issueRefreshToken,
  normalizeRole,
  requireAuth,
  requireRole,
  verifyToken
};
