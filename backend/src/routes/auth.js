const express = require('express');
const Joi = require('joi');
const bcrypt = require('bcryptjs');
const { query, transaction } = require('../config/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const {
  issueAccessToken,
  issueRefreshToken,
  normalizeRole,
  verifyToken,
} = require('../middleware/auth');
const logger = require('../config/logger');

const router = express.Router();

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
});

const refreshSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

const sanitizeUser = (row) => ({
  id: row.id,
  email: String(row.email || '').trim().toLowerCase(),
  role: normalizeRole(row.role),
});

const bootstrapAdminIfNeeded = async () => {
  const isProduction = process.env.NODE_ENV === 'production';
  const bootstrapEmail = String(
    process.env.BOOTSTRAP_ADMIN_EMAIL || (isProduction ? '' : 'admin@example.com')
  )
    .trim()
    .toLowerCase();
  const bootstrapPassword = String(
    process.env.BOOTSTRAP_ADMIN_PASSWORD || (isProduction ? '' : 'Admin123!')
  ).trim();
  const bootstrapRole = normalizeRole(process.env.BOOTSTRAP_ADMIN_ROLE || 'admin');

  if (!bootstrapEmail || !bootstrapPassword) {
    return;
  }

  await transaction(async (client) => {
    const existingUsersResult = await client.query(
      'SELECT COUNT(*)::int AS user_count FROM users'
    );

    if (Number(existingUsersResult.rows[0]?.user_count || 0) > 0) {
      return;
    }

    const passwordHash = await bcrypt.hash(bootstrapPassword, 12);
    await client.query(
      `
        INSERT INTO users (email, password_hash, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (email) DO NOTHING
      `,
      [bootstrapEmail, passwordHash, bootstrapRole]
    );

    logger.warn('Bootstrapped initial admin user from environment variables', {
      email: bootstrapEmail,
      role: bootstrapRole,
    });
  });
};

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      throw new AppError(error.details[0].message, 400, 'VALIDATION_ERROR', error.details);
    }

    await bootstrapAdminIfNeeded();

    const email = String(value.email).trim().toLowerCase();
    const password = String(value.password);

    const userResult = await query(
      'SELECT id, email, password_hash, role, is_active FROM users WHERE email = $1 LIMIT 1',
      [email]
    );

    if (userResult.rows.length === 0) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    const user = userResult.rows[0];
    if (!user.is_active) {
      throw new AppError('User account is inactive', 403, 'USER_INACTIVE');
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    const sanitizedUser = sanitizeUser(user);
    res.json({
      accessToken: issueAccessToken(sanitizedUser),
      refreshToken: issueRefreshToken(sanitizedUser),
      user: sanitizedUser,
    });
  })
);

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const { error, value } = refreshSchema.validate(req.body);
    if (error) {
      throw new AppError(error.details[0].message, 400, 'VALIDATION_ERROR', error.details);
    }

    const decoded = verifyToken(value.refreshToken, 'refresh');
    const userResult = await query(
      'SELECT id, email, role, is_active FROM users WHERE id = $1 LIMIT 1',
      [decoded.sub]
    );

    if (userResult.rows.length === 0 || !userResult.rows[0].is_active) {
      throw new AppError('Refresh token is no longer valid', 401, 'INVALID_REFRESH_TOKEN');
    }

    const sanitizedUser = sanitizeUser(userResult.rows[0]);
    res.json({
      accessToken: issueAccessToken(sanitizedUser),
      refreshToken: issueRefreshToken(sanitizedUser),
      user: sanitizedUser,
    });
  })
);

module.exports = router;
