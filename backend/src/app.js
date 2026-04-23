require('dotenv').config();
const {
  initializeTelemetry,
  captureException,
  shutdownTelemetry,
} = require('./utils/tracing');

initializeTelemetry();

const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const logger = require('./config/logger');
const { queueAdminRouter } = require('./config/queue');
const { assertJwtConfiguration, requireAuth, requireRole } = require('./middleware/auth');

// Import routes
const authRoutes = require('./routes/auth');
const configRoutes = require('./routes/config');
const branchRoutes = require('./routes/branches');
const pocketRoutes = require('./routes/pocket');
const nearestRoutes = require('./routes/nearest');
const batchRoutes = require('./routes/batch');
const jobsRoutes = require('./routes/jobs');
const templatesRoutes = require('./routes/templates');
const healthRoutes = require('./routes/health');
const customerMappingsRoutes = require('./routes/customerMappings');

// Import middleware
const { errorHandler, AppError } = require('./middleware/errorHandler');

assertJwtConfiguration();

const isTestEnv = process.env.NODE_ENV === 'test';
const queuesDisabled = process.env.DISABLE_QUEUES === 'true' || isTestEnv;

// Initialize workers only when queues are enabled
if (!queuesDisabled) {
  require('./workers/branchUploadWorker');
}

const app = express();
const PORT = process.env.PORT || 3000;
const API_VERSION = process.env.API_VERSION || 'v1';
const openApiDocumentPath = path.join(__dirname, 'docs', 'openapi.yaml');
const openApiDocumentUrl = `/api/${API_VERSION}/docs/openapi.yaml`;
const isProductionEnv = process.env.NODE_ENV === 'production';

const parsePositiveInteger = (value, fallback) => {
  const parsedValue = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
};

const createRateLimiter = (maxEnvKey, fallbackMax) =>
  rateLimit({
    windowMs: parsePositiveInteger(process.env.RATE_LIMIT_WINDOW_MS, 60000),
    max: parsePositiveInteger(process.env[maxEnvKey], fallbackMax),
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: 'Too many requests from this IP, please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
      });
    },
  });

const docsLimiter = createRateLimiter('RATE_LIMIT_PUBLIC_MAX_REQUESTS', 120);
const healthLimiter = createRateLimiter('RATE_LIMIT_PUBLIC_MAX_REQUESTS', 300);
const rootLimiter = createRateLimiter('RATE_LIMIT_PUBLIC_MAX_REQUESTS', 120);
const authLimiter = createRateLimiter('RATE_LIMIT_AUTH_MAX_REQUESTS', 10);
const standardLimiter = createRateLimiter('RATE_LIMIT_STANDARD_MAX_REQUESTS', 120);
const adminLimiter = createRateLimiter('RATE_LIMIT_ADMIN_MAX_REQUESTS', 60);
const heavyLimiter = createRateLimiter('RATE_LIMIT_HEAVY_MAX_REQUESTS', 20);

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'https:', 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        upgradeInsecureRequests: isProductionEnv ? [] : null,
      },
    },
    referrerPolicy: {
      policy: 'no-referrer',
    },
  })
);

// CORS configuration
const configuredOrigins = (process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const defaultOrigins = isProductionEnv ? [] : ['http://localhost:5173', 'http://localhost:5174'];
const allowedOrigins = configuredOrigins.length > 0 ? configuredOrigins : defaultOrigins;
const localhostDevOriginPattern = /^http:\/\/localhost:\d+$/;

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser clients or same-origin requests.
    if (!origin) {
      callback(null, true);
      return;
    }

    const isExplicitlyAllowed = allowedOrigins.includes(origin);
    const isLocalhostDevOrigin =
      process.env.NODE_ENV !== 'production' && localhostDevOriginPattern.test(origin);

    if (isExplicitlyAllowed || isLocalhostDevOrigin) {
      callback(null, true);
      return;
    }

    callback(
      new AppError(`CORS blocked for origin: ${origin}`, 403, 'CORS_BLOCKED')
    );
  },
  credentials: true,
  optionsSuccessStatus: 204,
};
app.use(cors(corsOptions));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// HTTP request logging
app.use(
  morgan('combined', {
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  })
);

app.get(openApiDocumentUrl, docsLimiter, (_req, res) => {
  res.type('application/yaml');
  res.sendFile(openApiDocumentPath);
});

app.use(
  `/api/${API_VERSION}/docs`,
  docsLimiter,
  swaggerUi.serve,
  swaggerUi.setup(null, {
    swaggerOptions: {
      url: openApiDocumentUrl,
    },
  })
);

// API routes
app.use(`/api/${API_VERSION}/auth`, authLimiter, authRoutes);
app.use(`/api/${API_VERSION}/config`, adminLimiter, requireAuth, requireRole('admin'), configRoutes);
app.use(`/api/${API_VERSION}/branches`, adminLimiter, requireAuth, requireRole('admin'), branchRoutes);
app.use(`/api/${API_VERSION}/pocket`, standardLimiter, requireAuth, pocketRoutes);
app.use(`/api/${API_VERSION}/nearest`, standardLimiter, requireAuth, nearestRoutes);
app.use(`/api/${API_VERSION}/batch`, heavyLimiter, requireAuth, batchRoutes);
app.use(`/api/${API_VERSION}/jobs`, adminLimiter, requireAuth, requireRole('admin'), jobsRoutes);
app.use(`/api/${API_VERSION}/templates`, standardLimiter, requireAuth, templatesRoutes);
app.use(`/api/${API_VERSION}/customer-mappings`, standardLimiter, requireAuth, customerMappingsRoutes);
app.use('/health', healthLimiter, healthRoutes);

if (queueAdminRouter) {
  app.use('/admin/queues', adminLimiter, requireAuth, requireRole('admin'), queueAdminRouter);
}

// Root endpoint
app.get('/', rootLimiter, (req, res) => {
  res.json({
    name: 'Location Pockets API',
    version: API_VERSION,
    status: 'running',
    endpoints: {
      config: `/api/${API_VERSION}/config`,
      branches: `/api/${API_VERSION}/branches`,
      pocket: `/api/${API_VERSION}/pocket`,
      nearest: `/api/${API_VERSION}/nearest`,
      batch: `/api/${API_VERSION}/batch`,
      customerMappings: `/api/${API_VERSION}/customer-mappings`,
      health: '/health',
      docs: `/api/${API_VERSION}/docs`,
      adminQueues: '/admin/queues',
    },
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.url} not found`,
  });
});

app.use((err, req, res, next) => {
  captureException(err, {
    tags: {
      route: req.route?.path || req.path,
      method: req.method,
    },
    extra: {
      path: req.originalUrl,
      statusCode: err.statusCode || err.status || 500,
      authenticatedUserId: req.user?.id,
      authenticatedUserRole: req.user?.role,
    },
    user: req.user ? { id: req.user.id } : undefined,
  });
  next(err);
});

// Error handling middleware (must be last)
app.use(errorHandler);

let server = null;

const startServer = () =>
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
    logger.info(`API version: ${API_VERSION}`);
  });

if (require.main === module) {
  server = startServer();
}

// Graceful shutdown
const shutdown = (signal) => {
  logger.info(`${signal} signal received: closing HTTP server`);

  const finishShutdown = () => {
    void shutdownTelemetry().finally(() => {
      process.exit(0);
    });
  };

  if (!server) {
    logger.info('No active HTTP server instance to close');
    finishShutdown();
    return;
  }

  server.close(() => {
    logger.info('HTTP server closed');
    finishShutdown();
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
