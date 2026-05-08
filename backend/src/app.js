require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const logger = require('./config/logger');
const { ensureDatabaseReady } = require('./config/database');

// Import routes
const authRoutes = require('./routes/auth');
const configRoutes = require('./routes/config');
const branchRoutes = require('./routes/branches');
const pocketRoutes = require('./routes/pocket');
const nearestRoutes = require('./routes/nearest');
const batchRoutes = require('./routes/batch');
const territoriesRoutes = require('./routes/territories');
const employeesRoutes = require('./routes/employees');
const gridsRoutes = require('./routes/grids');
const jobsRoutes = require('./routes/jobs');
const templatesRoutes = require('./routes/templates');
const healthRoutes = require('./routes/health');
const customerMappingsRoutes = require('./routes/customerMappings');
const adminRoutes = require('./routes/admin');

// Import middleware
const { errorHandler } = require('./middleware/errorHandler');
const { requireAuth, requireRole } = require('./middleware/auth');

const isTestEnv = process.env.NODE_ENV === 'test';
const queuesDisabled = process.env.DISABLE_QUEUES === 'true' || isTestEnv;

// Initialize workers only when queues are enabled
if (!queuesDisabled) {
  require('./workers/branchUploadWorker');
}

const app = express();
const PORT = process.env.PORT || 3000;
const API_VERSION = process.env.API_VERSION || 'v1';

// Security middleware
app.use(helmet());

// CORS configuration
const configuredOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const defaultOrigins = ['http://localhost:5173', 'http://localhost:5174'];
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

    callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
};
app.use(cors(corsOptions));

// --- ORIGINAL BACKUP ---
// // Rate limiting
// const limiter = rateLimit({
//   windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
//   max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '60', 10),
//   message: 'Too many requests from this IP, please try again later.',
//   standardHeaders: true,
//   legacyHeaders: false,
// });
// app.use(`/api/${API_VERSION}/`, limiter);
// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  max: parseInt(
    process.env.RATE_LIMIT_MAX_REQUESTS
      || (process.env.NODE_ENV === 'production' ? '60' : '600'),
    10
  ),
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    if (process.env.NODE_ENV === 'production') {
      return false;
    }
    const requestIp = String(req.ip || req.socket?.remoteAddress || '');
    const isLocalRequest = requestIp.includes('127.0.0.1') || requestIp.includes('::1');
    return isLocalRequest;
  },
});
app.use(`/api/${API_VERSION}/`, limiter);

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

// API routes
const requireEditorForMutations = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }

  requireRole('editor')(req, res, next);
};

app.use(`/api/${API_VERSION}/auth`, authRoutes);
app.use(`/api/${API_VERSION}/config`, requireAuth, requireRole('admin'), configRoutes);
app.use(`/api/${API_VERSION}/branches`, requireAuth, requireEditorForMutations, branchRoutes);
app.use(`/api/${API_VERSION}/pocket`, requireAuth, requireEditorForMutations, pocketRoutes);
app.use(`/api/${API_VERSION}/nearest`, requireAuth, requireEditorForMutations, nearestRoutes);
app.use(`/api/${API_VERSION}/batch`, requireAuth, requireEditorForMutations, batchRoutes);
app.use(`/api/${API_VERSION}/territories`, requireAuth, requireEditorForMutations, territoriesRoutes);
app.use(`/api/${API_VERSION}/employees`, requireAuth, requireEditorForMutations, employeesRoutes);
app.use(`/api/${API_VERSION}/grids`, requireAuth, requireEditorForMutations, gridsRoutes);
app.use(`/api/${API_VERSION}/jobs`, requireAuth, requireRole('admin'), jobsRoutes);
app.use(`/api/${API_VERSION}/templates`, requireAuth, requireEditorForMutations, templatesRoutes);
app.use(`/api/${API_VERSION}/customer-mappings`, requireAuth, requireEditorForMutations, customerMappingsRoutes);
app.use(`/api/${API_VERSION}/admin`, requireAuth, requireRole('admin'), adminRoutes);
app.use('/health', healthRoutes);

// Root endpoint
app.get('/', (req, res) => {
  // --- ORIGINAL BACKUP ---
  // res.json({
  //   name: 'Location Pockets API',
  //   version: API_VERSION,
  //   status: 'running',
  //   endpoints: {
  //     config: `/api/${API_VERSION}/config`,
  //     branches: `/api/${API_VERSION}/branches`,
  //     pocket: `/api/${API_VERSION}/pocket`,
  //     nearest: `/api/${API_VERSION}/nearest`,
  //     batch: `/api/${API_VERSION}/batch`,
  //     territories: `/api/${API_VERSION}/territories`,
  //     employees: `/api/${API_VERSION}/employees`,
  //     grids: `/api/${API_VERSION}/grids`,
  //     customerMappings: `/api/${API_VERSION}/customer-mappings`,
  //     health: '/health',
  //   },
  // });
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
      territories: `/api/${API_VERSION}/territories`,
      employees: `/api/${API_VERSION}/employees`,
      grids: `/api/${API_VERSION}/grids`,
      customerMappings: `/api/${API_VERSION}/customer-mappings`,
      admin: `/api/${API_VERSION}/admin`,
      health: '/health',
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

// Error handling middleware (must be last)
app.use(errorHandler);

let server = null;

const startServer = async () => {
  await ensureDatabaseReady();
  return app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
    logger.info(`API version: ${API_VERSION}`);
  });
};

if (require.main === module) {
  startServer()
    .then((instance) => {
      server = instance;
    })
    .catch((error) => {
      logger.error('Unable to start server', { error: error.message });
      process.exit(1);
    });
}

// Graceful shutdown
const shutdown = (signal) => {
  logger.info(`${signal} signal received: closing HTTP server`);

  if (!server) {
    logger.info('No active HTTP server instance to close');
    process.exit(0);
    return;
  }

  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
