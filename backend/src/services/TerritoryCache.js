const crypto = require('crypto');
const { createClient } = require('redis');
const logger = require('../config/logger');

const VISUALIZATION_CACHE_TTL_SECONDS = 60 * 60;
const VISUALIZATION_CACHE_PREFIX = 'territory:visualization:v1';
const VISUALIZATION_CACHE_KEYS_SET = `${VISUALIZATION_CACHE_PREFIX}:keys`;
const VISUALIZATION_CACHE_LATEST_JOB_KEY = `${VISUALIZATION_CACHE_PREFIX}:latest-job-id`;
const VISUALIZATION_CACHE_CONFIG_VERSION_KEY = `${VISUALIZATION_CACHE_PREFIX}:config-version`;

let redisClientPromise = null;

const isCacheDisabled = () =>
  process.env.DISABLE_REDIS_CACHE === 'true' || process.env.NODE_ENV === 'test';

const createRedisClient = async () => {
  if (isCacheDisabled()) {
    return null;
  }

  const client = createClient({
    socket: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10)
    },
    disableOfflineQueue: true
  });

  client.on('error', (error) => {
    logger.warn('Territory visualization cache client error', {
      error: error.message
    });
  });

  await client.connect();
  return client;
};

const getRedisClient = async () => {
  if (isCacheDisabled()) {
    return null;
  }

  if (!redisClientPromise) {
    redisClientPromise = createRedisClient()
      .catch((error) => {
        logger.warn('Territory visualization cache unavailable', {
          error: error.message
        });
        redisClientPromise = null;
        return null;
      });
  }

  return redisClientPromise;
};

const buildVisualizationCacheKey = ({
  jobId,
  mode,
  branchIds = [],
  customerView,
  configVersion
}) => {
  const normalizedPayload = JSON.stringify({
    jobId: String(jobId || '').trim(),
    mode: String(mode || '').trim(),
    branchIds: branchIds
      .map((branchId) => String(branchId || '').trim())
      .filter(Boolean),
    customerView: String(customerView || '').trim(),
    configVersion: String(configVersion || '').trim()
  });

  const digest = crypto
    .createHash('sha1')
    .update(normalizedPayload)
    .digest('hex');

  return `${VISUALIZATION_CACHE_PREFIX}:response:${digest}`;
};

const getCachedVisualization = async (cacheKey) => {
  const client = await getRedisClient();
  if (!client) {
    return null;
  }

  try {
    const cachedPayload = await client.get(cacheKey);
    return cachedPayload ? JSON.parse(cachedPayload) : null;
  } catch (error) {
    logger.warn('Failed to read territory visualization cache entry', {
      error: error.message,
      cacheKey
    });
    return null;
  }
};

const cacheVisualizationResponse = async (cacheKey, payload) => {
  const client = await getRedisClient();
  if (!client) {
    return false;
  }

  try {
    await client.set(cacheKey, JSON.stringify(payload), {
      EX: VISUALIZATION_CACHE_TTL_SECONDS
    });
    await client.sAdd(VISUALIZATION_CACHE_KEYS_SET, cacheKey);
    return true;
  } catch (error) {
    logger.warn('Failed to write territory visualization cache entry', {
      error: error.message,
      cacheKey
    });
    return false;
  }
};

const invalidateTrackedVisualizationEntries = async (client) => {
  const trackedKeys = await client.sMembers(VISUALIZATION_CACHE_KEYS_SET);
  const keysToDelete = [...new Set([...trackedKeys, VISUALIZATION_CACHE_KEYS_SET])];

  if (keysToDelete.length === 0) {
    return false;
  }

  await client.del(keysToDelete);
  return true;
};

const invalidateVisualizationCacheIfNeeded = async ({
  latestJobId = null,
  configVersion
}) => {
  const client = await getRedisClient();
  if (!client) {
    return false;
  }

  try {
    const currentConfigVersion = String(configVersion || '').trim();
    const keysToRead = [VISUALIZATION_CACHE_CONFIG_VERSION_KEY];
    if (latestJobId) {
      keysToRead.push(VISUALIZATION_CACHE_LATEST_JOB_KEY);
    }

    const markerValues = await Promise.all(keysToRead.map((key) => client.get(key)));
    const cachedConfigVersion = markerValues[0];
    const cachedLatestJobId = latestJobId ? markerValues[1] : null;
    const normalizedLatestJobId = latestJobId ? String(latestJobId).trim() : null;

    const shouldInvalidate =
      (currentConfigVersion && cachedConfigVersion && currentConfigVersion !== cachedConfigVersion)
      || (
        normalizedLatestJobId
        && cachedLatestJobId
        && normalizedLatestJobId !== cachedLatestJobId
      );

    if (shouldInvalidate) {
      await invalidateTrackedVisualizationEntries(client);
    }

    if (currentConfigVersion) {
      await client.set(VISUALIZATION_CACHE_CONFIG_VERSION_KEY, currentConfigVersion);
    }

    if (normalizedLatestJobId) {
      await client.set(VISUALIZATION_CACHE_LATEST_JOB_KEY, normalizedLatestJobId);
    }

    return shouldInvalidate;
  } catch (error) {
    logger.warn('Failed to invalidate stale territory visualization cache entries', {
      error: error.message
    });
    return false;
  }
};

module.exports = {
  VISUALIZATION_CACHE_TTL_SECONDS,
  buildVisualizationCacheKey,
  getCachedVisualization,
  cacheVisualizationResponse,
  invalidateVisualizationCacheIfNeeded
};
