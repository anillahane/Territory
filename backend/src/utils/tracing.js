const Sentry = require('@sentry/node');
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');

const allowedInstrumentations = new Set([
  '@opentelemetry/instrumentation-express',
  '@opentelemetry/instrumentation-http',
  '@opentelemetry/instrumentation-ioredis',
  '@opentelemetry/instrumentation-pg',
  '@opentelemetry/instrumentation-redis',
]);

let otelSdk = null;
let sentryEnabled = false;
let telemetryInitialized = false;

const parseFloatEnv = (name, fallback) => {
  const rawValue = process.env[name];
  const parsedValue = Number.parseFloat(rawValue || '');
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
};

const parseOtlpHeaders = (rawValue) => {
  if (!rawValue) {
    return undefined;
  }

  return rawValue
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((headers, entry) => {
      const separatorIndex = entry.indexOf('=');
      if (separatorIndex <= 0) {
        return headers;
      }

      const key = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      if (key && value) {
        headers[key] = value;
      }

      return headers;
    }, {});
};

const resolveOtlpTracesEndpoint = () => {
  const explicitEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  if (explicitEndpoint) {
    return explicitEndpoint;
  }

  const baseEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!baseEndpoint) {
    return null;
  }

  const normalizedBaseEndpoint = baseEndpoint.replace(/\/$/, '');
  if (normalizedBaseEndpoint.endsWith('/v1/traces')) {
    return normalizedBaseEndpoint;
  }

  return `${normalizedBaseEndpoint}/v1/traces`;
};

const initializeSentry = () => {
  if (!process.env.SENTRY_DSN) {
    return;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE,
    sampleRate: parseFloatEnv('SENTRY_SAMPLE_RATE', 1.0),
    attachStacktrace: true,
  });
  sentryEnabled = true;
};

const initializeOpenTelemetry = () => {
  const otlpEndpoint = resolveOtlpTracesEndpoint();
  if (!otlpEndpoint) {
    return;
  }

  process.env.OTEL_SERVICE_NAME = process.env.OTEL_SERVICE_NAME || 'territory-backend';

  const instrumentations = getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-http': {
      ignoreIncomingRequestHook: (request) => request.url === '/health',
    },
  }).filter((instrumentation) => allowedInstrumentations.has(instrumentation.instrumentationName));

  const headers = parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);

  otelSdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({
      url: otlpEndpoint,
      headers,
    }),
    instrumentations,
  });

  otelSdk.start();
};

const initializeTelemetry = () => {
  if (telemetryInitialized || process.env.NODE_ENV === 'test') {
    return;
  }

  telemetryInitialized = true;

  try {
    initializeSentry();
  } catch (error) {
    console.error('Failed to initialize Sentry telemetry', error);
  }

  try {
    initializeOpenTelemetry();
  } catch (error) {
    console.error('Failed to initialize OpenTelemetry', error);
  }
};

const captureException = (error, context = {}) => {
  if (!sentryEnabled) {
    return;
  }

  Sentry.withScope((scope) => {
    const { tags = {}, extra = {}, user } = context;

    Object.entries(tags).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        scope.setTag(key, String(value));
      }
    });

    Object.entries(extra).forEach(([key, value]) => {
      if (value !== undefined) {
        scope.setExtra(key, value);
      }
    });

    if (user) {
      scope.setUser(user);
    }

    Sentry.captureException(error);
  });
};

const shutdownTelemetry = async () => {
  const shutdownTasks = [];

  if (otelSdk) {
    shutdownTasks.push(
      Promise.resolve(otelSdk.shutdown()).catch((error) => {
        console.error('Failed to shut down OpenTelemetry cleanly', error);
      })
    );
  }

  if (sentryEnabled) {
    shutdownTasks.push(
      Promise.resolve(Sentry.close(2000)).catch((error) => {
        console.error('Failed to flush Sentry cleanly', error);
      })
    );
  }

  await Promise.all(shutdownTasks);
};

module.exports = {
  initializeTelemetry,
  captureException,
  shutdownTelemetry,
};
