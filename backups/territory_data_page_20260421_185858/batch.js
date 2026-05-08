const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { query, transaction } = require('../config/database');
const { encodePocketId, decodePocketId, findNearestPocket, haversineDistance } = require('../utils/geometry');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const logger = require('../config/logger');
const { batchProcessQueue } = require('../config/queue');
const mappingService = require('../services/MappingService');
const branchFinderService = require('../services/BranchFinderService');
const { handleTerritoryAllocate } = require('./territoryAllocator');

const router = express.Router();

const withTimeout = async (promise, timeoutMs, errorMessage) => {
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
  }
};

// Create uploads directory for disk storage
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer with hybrid storage strategy
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${uuidv4()}-${file.originalname}`)
  }),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE_MB || '50', 10) * 1024 * 1024, // Increased to 50MB
  },
});

// Threshold for switching to Python worker (rows)
const PYTHON_WORKER_THRESHOLD = parseInt(process.env.PYTHON_WORKER_THRESHOLD || '5000', 10);
const MAX_VISUALIZATION_BRANCHES = 5;
const TARGET_POCKET_LEVEL_METERS = 5000;
// --- ORIGINAL BACKUP ---
// const BRANCH_CATCHMENT_RADIUS_METERS = 40000;
// --- ORIGINAL BACKUP ---
// const BRANCH_CATCHMENT_RADIUS_METERS = 50000;
const BRANCH_CATCHMENT_RADIUS_METERS = 40000;
const PERSISTENT_TERRITORY_VALIDATION_RADIUS_METERS = 50000;
const TIER2_BRANCH_GENERATION_RADIUS_METERS = 100000;
const TIER2_GRID_LEVELS_METERS = [20000, 5000, 1000];
const GLOBAL_EMPTY_GRID_LEVEL_METERS = 1000;
const DEFAULT_POCKET_CONFIG_ORIGIN_LAT = 8.0;
const DEFAULT_POCKET_CONFIG_ORIGIN_LON = 68.0;
const DEFAULT_POCKET_CONFIG_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUV';
const MAX_POCKET_CENTER_DISTANCE_TOLERANCE_METERS = 250;
const DEFAULT_CONFIG_GRID_LEVEL_METERS = [500000, 100000, 20000, 5000, 1000];
const DEFAULT_EMPLOYEE_TERRITORY_TOLERANCE = 0.10;
const MAX_EMPLOYEE_TERRITORY_TOLERANCE = 0.50;
const MIN_DYNAMIC_EMPLOYEE_COUNT = 1;
const MAX_DYNAMIC_EMPLOYEE_COUNT = 20;
const UNASSIGNED_TERRITORY_COLOR = '#E2E8F0';
const DEFAULT_PERSISTENT_TERRITORY_LEVEL_METERS = 5000;
const GENERATED_EMPLOYEE_ID_REGEX = /^emp_\d{3}$/;
// --- ORIGINAL BACKUP ---
// const CANONICAL_POCKET_CODE_SQL_PATTERN = '^[0-9]{2}(?:-[0-9]{2}){0,4}$';
// --- ORIGINAL BACKUP ---
// const CANONICAL_POCKET_CODE_SQL_PATTERN = '^[0-9A-Z]{2}(?:-[0-9A-Z]{2}){0,4}$';
// --- ORIGINAL BACKUP ---
// const CANONICAL_POCKET_CODE_SQL_PATTERN = '^[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*$';
const CANONICAL_POCKET_CODE_SQL_PATTERN = '^[0-9A-Z]{2}(?:-[0-9A-Z]{2}){0,4}$';
const EMPLOYEE_GRID_CELL_TABLE = 'employee_grid_cells';
const BRANCH_TERRITORY_TABLE = 'branch_territories';
const EMPLOYEE_TERRITORY_TABLE = 'employee_territories';
const TERRITORY_VISUALIZATION_MODE = Object.freeze({
  EXISTING_CUSTOMERS: 'existing_customers',
  NEAREST_POCKETS: 'nearest_pockets',
  CUSTOMER_AVAILABILITY: 'customer_availability'
});
const CUSTOMER_VISUALIZATION_VIEW = Object.freeze({
  SELECTED_POCKETS: 'selected_pockets',
  ORIGINAL_CUSTOMERS: 'original_customers'
});
const INDIA_STATE_BOUNDS_GEOJSON_CANDIDATE_PATHS = [
  path.resolve(__dirname, '../../data/indiaStateBounds_official.geojson'),
  path.resolve(__dirname, '../../public/data/indiaStateBounds_official.geojson'),
  path.resolve(__dirname, '../../../frontend/public/data/indiaStateBounds_official.geojson')
];
let cachedIndiaStateBoundsGeoJson = null;

// Use the shared batch process queue
const batchQueue = batchProcessQueue;

const getFirstDefinedValue = (row, aliases) => {
  for (const key of aliases) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) {
      continue;
    }

    const value = row[key];
    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value === 'string' && value.trim() === '') {
      continue;
    }

    return value;
  }

  return undefined;
};

const toNumber = (value) => {
  if (typeof value === 'number') {
    return value;
  }

  if (value === undefined || value === null) {
    return Number.NaN;
  }

  const normalized = String(value).replace(/,/g, '').trim();
  if (!normalized) {
    return Number.NaN;
  }

  return Number.parseFloat(normalized);
};

const isValidGeoCoordinate = (lat, lon) => (
  Number.isFinite(lat)
  && Number.isFinite(lon)
  && lat >= -90
  && lat <= 90
  && lon >= -180
  && lon <= 180
);

const sanitizePocketConfig = (rawConfig) => {
  const parsedOriginLat = Number(rawConfig?.originLat);
  const parsedOriginLon = Number(rawConfig?.originLon);
  const parsedAlphabet = typeof rawConfig?.alphabet === 'string'
    ? rawConfig.alphabet.trim()
    : '';

  return {
    originLat: Number.isFinite(parsedOriginLat) ? parsedOriginLat : DEFAULT_POCKET_CONFIG_ORIGIN_LAT,
    originLon: Number.isFinite(parsedOriginLon) ? parsedOriginLon : DEFAULT_POCKET_CONFIG_ORIGIN_LON,
    alphabet: parsedAlphabet.length === 30 ? parsedAlphabet : DEFAULT_POCKET_CONFIG_ALPHABET
  };
};

const isValidNearestPocketCandidate = (nearestPocket, pocketLevelMeters = TARGET_POCKET_LEVEL_METERS) => {
  if (!nearestPocket || typeof nearestPocket !== 'object') {
    return false;
  }

  const distanceMeters = Number(nearestPocket.distance);
  const centerLat = Number(nearestPocket.centerLat);
  const centerLon = Number(nearestPocket.centerLon);
  const maxExpectedDistanceMeters = ((Number(pocketLevelMeters) * Math.SQRT2) / 2)
    + MAX_POCKET_CENTER_DISTANCE_TOLERANCE_METERS;

  return (
    typeof nearestPocket.pocketId === 'string'
    && nearestPocket.pocketId.trim() !== ''
    && Number.isFinite(distanceMeters)
    && distanceMeters >= 0
    && Number.isFinite(centerLat)
    && Number.isFinite(centerLon)
    && centerLat >= -90
    && centerLat <= 90
    && centerLon >= -180
    && centerLon <= 180
    && distanceMeters <= maxExpectedDistanceMeters
  );
};

const resolveNearestPocketAssignment = (lat, lon, rawConfig) => {
  const primaryConfig = sanitizePocketConfig(rawConfig);
  const fallbackConfig = {
    originLat: DEFAULT_POCKET_CONFIG_ORIGIN_LAT,
    originLon: DEFAULT_POCKET_CONFIG_ORIGIN_LON,
    alphabet: primaryConfig.alphabet
  };
  const shouldTryFallback = (
    primaryConfig.originLat !== fallbackConfig.originLat
    || primaryConfig.originLon !== fallbackConfig.originLon
  );

  let lastError = null;
  const attemptResolution = (candidateConfig, usedFallbackConfig) => {
    const candidate = findNearestPocket(lat, lon, candidateConfig, {
      pocketLevelMeters: TARGET_POCKET_LEVEL_METERS
    });
    if (!isValidNearestPocketCandidate(candidate, TARGET_POCKET_LEVEL_METERS)) {
      throw new Error('Invalid pocket assignment candidate produced by current configuration');
    }

    return {
      nearestPocket: candidate,
      usedFallbackConfig
    };
  };

  try {
    return attemptResolution(primaryConfig, false);
  } catch (error) {
    lastError = error;
  }

  if (!shouldTryFallback) {
    throw lastError || new Error('Unable to resolve pocket assignment');
  }

  try {
    return attemptResolution(fallbackConfig, true);
  } catch (error) {
    lastError = error;
  }

  throw lastError || new Error('Unable to resolve pocket assignment');
};

const findNearestBranchFromPocketCatalog = (pocketLat, pocketLon, branchPocketCatalog) => {
  if (!Array.isArray(branchPocketCatalog) || branchPocketCatalog.length === 0) {
    return null;
  }

  let nearestBranch = null;
  let minDistance = Number.POSITIVE_INFINITY;

  for (const branchPocket of branchPocketCatalog) {
    const branchCenterLat = Number(branchPocket?.pocketCenterLat);
    const branchCenterLon = Number(branchPocket?.pocketCenterLon);
    if (!Number.isFinite(branchCenterLat) || !Number.isFinite(branchCenterLon)) {
      continue;
    }

    const distanceMeters = haversineDistance(
      pocketLat,
      pocketLon,
      branchCenterLat,
      branchCenterLon
    );

    if (!Number.isFinite(distanceMeters) || distanceMeters >= minDistance) {
      continue;
    }

    minDistance = distanceMeters;
    nearestBranch = {
      branchId: String(branchPocket.branchId || ''),
      branchLat: Number(branchPocket.branchLat),
      branchLon: Number(branchPocket.branchLon),
      branchPocketId: String(branchPocket.pocketId || ''),
      branchPocketCenterLat: branchCenterLat,
      branchPocketCenterLon: branchCenterLon,
      distance: distanceMeters
    };
  }

  return nearestBranch;
};

const parseBooleanFlag = (value, defaultValue = false) => {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
};

const parseTerritoryVisualizationMode = (rawMode) => {
  if (typeof rawMode !== 'string' || rawMode.trim() === '') {
    return TERRITORY_VISUALIZATION_MODE.EXISTING_CUSTOMERS;
  }

  const normalized = rawMode.trim().toLowerCase().replace(/-/g, '_');
  const aliasMap = {
    existing: TERRITORY_VISUALIZATION_MODE.EXISTING_CUSTOMERS,
    existing_customer: TERRITORY_VISUALIZATION_MODE.EXISTING_CUSTOMERS,
    existing_customers: TERRITORY_VISUALIZATION_MODE.EXISTING_CUSTOMERS,
    existing_customer_mapped: TERRITORY_VISUALIZATION_MODE.EXISTING_CUSTOMERS,
    nearest_pocket: TERRITORY_VISUALIZATION_MODE.NEAREST_POCKETS,
    nearest_pockets: TERRITORY_VISUALIZATION_MODE.NEAREST_POCKETS,
    branches_nearest_pockets: TERRITORY_VISUALIZATION_MODE.NEAREST_POCKETS,
    customer_availability: TERRITORY_VISUALIZATION_MODE.CUSTOMER_AVAILABILITY,
    availability: TERRITORY_VISUALIZATION_MODE.CUSTOMER_AVAILABILITY,
    branch_code: TERRITORY_VISUALIZATION_MODE.CUSTOMER_AVAILABILITY,
    branch_code_availability: TERRITORY_VISUALIZATION_MODE.CUSTOMER_AVAILABILITY
  };

  return aliasMap[normalized] || null;
};

const parseCustomerVisualizationView = (rawView) => {
  if (typeof rawView !== 'string' || rawView.trim() === '') {
    return CUSTOMER_VISUALIZATION_VIEW.SELECTED_POCKETS;
  }

  const normalized = rawView.trim().toLowerCase().replace(/-/g, '_');
  const aliasMap = {
    selected_pockets: CUSTOMER_VISUALIZATION_VIEW.SELECTED_POCKETS,
    selected_pocket: CUSTOMER_VISUALIZATION_VIEW.SELECTED_POCKETS,
    pockets: CUSTOMER_VISUALIZATION_VIEW.SELECTED_POCKETS,
    revised: CUSTOMER_VISUALIZATION_VIEW.SELECTED_POCKETS,
    revised_customers: CUSTOMER_VISUALIZATION_VIEW.SELECTED_POCKETS,
    original: CUSTOMER_VISUALIZATION_VIEW.ORIGINAL_CUSTOMERS,
    original_customers: CUSTOMER_VISUALIZATION_VIEW.ORIGINAL_CUSTOMERS,
    existing_customers: CUSTOMER_VISUALIZATION_VIEW.ORIGINAL_CUSTOMERS
  };

  return aliasMap[normalized] || null;
};

const parseBranchIds = (rawBranchIds) => {
  if (rawBranchIds === undefined || rawBranchIds === null) {
    return [];
  }

  const candidates = Array.isArray(rawBranchIds)
    ? rawBranchIds
    : String(rawBranchIds).split(',');

  const unique = new Set();
  candidates.forEach((entry) => {
    const value = String(entry).trim();
    if (value) {
      unique.add(value);
    }
  });

  return Array.from(unique);
};

const parseTerritoryTolerance = (rawTolerance) => {
  if (rawTolerance === undefined || rawTolerance === null || rawTolerance === '') {
    return DEFAULT_EMPLOYEE_TERRITORY_TOLERANCE;
  }

  const parsedTolerance = Number(rawTolerance);
  if (!Number.isFinite(parsedTolerance)) {
    throw new AppError(
      `Invalid tolerance value: ${rawTolerance}`,
      400,
      'INVALID_TOLERANCE'
    );
  }

  if (parsedTolerance < 0 || parsedTolerance > MAX_EMPLOYEE_TERRITORY_TOLERANCE) {
    throw new AppError(
      `Tolerance must be between 0 and ${MAX_EMPLOYEE_TERRITORY_TOLERANCE}.`,
      400,
      'INVALID_TOLERANCE'
    );
  }

  return parsedTolerance;
};

const parseDynamicEmployeeCount = (rawEmployeeCount) => {
  if (rawEmployeeCount === undefined || rawEmployeeCount === null || rawEmployeeCount === '') {
    return MIN_DYNAMIC_EMPLOYEE_COUNT;
  }

  const parsedEmployeeCount = Number(rawEmployeeCount);
  if (!Number.isInteger(parsedEmployeeCount)) {
    return MIN_DYNAMIC_EMPLOYEE_COUNT;
  }

  if (
    parsedEmployeeCount < MIN_DYNAMIC_EMPLOYEE_COUNT
    || parsedEmployeeCount > MAX_DYNAMIC_EMPLOYEE_COUNT
  ) {
    return MIN_DYNAMIC_EMPLOYEE_COUNT;
  }

  return parsedEmployeeCount;
};

const resolvePaddedCatchmentRadiusMeters = (levelMeters) => {
  const normalizedLevelMeters = Number.isFinite(Number(levelMeters)) && Number(levelMeters) > 0
    ? Math.round(Number(levelMeters))
    : DEFAULT_PERSISTENT_TERRITORY_LEVEL_METERS;
  const halfCellPadding = normalizedLevelMeters / 2;
  return Number(BRANCH_CATCHMENT_RADIUS_METERS) + Number(halfCellPadding);
};

const resolveEmployeeGridLevelKm = (
  levelMeters,
  fallbackLevelMeters = DEFAULT_PERSISTENT_TERRITORY_LEVEL_METERS
) => {
  const normalizedLevelMeters = Number.isFinite(Number(levelMeters)) && Number(levelMeters) > 0
    ? Math.round(Number(levelMeters))
    : Math.round(Number(fallbackLevelMeters));

  if (!Number.isFinite(normalizedLevelMeters) || normalizedLevelMeters <= 0) {
    throw new AppError('Employee grid level is invalid.', 400, 'INVALID_EMPLOYEE_GRID_LEVEL');
  }

  if (normalizedLevelMeters % 1000 !== 0) {
    throw new AppError(
      `Employee grid level ${normalizedLevelMeters}m is unsupported. Levels must be whole kilometers.`,
      400,
      'INVALID_EMPLOYEE_GRID_LEVEL'
    );
  }

  return Math.max(1, Math.round(normalizedLevelMeters / 1000));
};

const acquireBranchTerritoryLock = async (client, branchId) => {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1::text))',
    [`territory:${String(branchId || '').trim()}`]
  );
};

const normalizeConfigGridLevels = (rawGridLevels) => {
  const defaultLevels = [...DEFAULT_CONFIG_GRID_LEVEL_METERS];

  if (Array.isArray(rawGridLevels)) {
    const parsedLevels = rawGridLevels
      .map((level) => Number(level))
      .filter((level) => Number.isFinite(level) && level > 0);
    if (parsedLevels.length === defaultLevels.length) {
      return parsedLevels;
    }
    return defaultLevels;
  }

  if (!rawGridLevels || typeof rawGridLevels !== 'object') {
    return defaultLevels;
  }

  const candidateLevels = Array.isArray(rawGridLevels.levels)
    ? rawGridLevels.levels
    : (Array.isArray(rawGridLevels.gridLevels) ? rawGridLevels.gridLevels : null);

  if (!candidateLevels) {
    return defaultLevels;
  }

  const parsedLevels = candidateLevels
    .map((level) => Number(level))
    .filter((level) => Number.isFinite(level) && level > 0);

  return parsedLevels.length === defaultLevels.length
    ? parsedLevels
    : defaultLevels;
};

const resolvePocketLevelMeters = (pocketId, gridLevels) => {
  const normalizedPocketId = String(pocketId || '').trim();
  if (!normalizedPocketId) {
    return null;
  }

  const parts = normalizedPocketId.split('-').filter(Boolean);
  if (parts.length === 0) {
    return null;
  }

  const safeGridLevels = Array.isArray(gridLevels) && gridLevels.length > 0
    ? gridLevels
    : DEFAULT_CONFIG_GRID_LEVEL_METERS;

  const index = parts.length - 1;
  if (index < 0 || index >= safeGridLevels.length) {
    return null;
  }

  const levelMeters = Number(safeGridLevels[index]);
  if (!Number.isFinite(levelMeters) || levelMeters <= 0) {
    return null;
  }

  return Math.round(levelMeters);
};

const computePocketRowColIndex = (decodedPocket, targetLevelMeters) => {
  if (!decodedPocket || !Array.isArray(decodedPocket.indices) || decodedPocket.indices.length === 0) {
    return null;
  }

  const targetLevel = Number(targetLevelMeters);
  if (!Number.isFinite(targetLevel) || targetLevel <= 0) {
    return null;
  }

  let rowIndex = 0;
  let colIndex = 0;

  for (const indexEntry of decodedPocket.indices) {
    const levelSize = Number(indexEntry?.levelSize);
    const row = Number(indexEntry?.row);
    const col = Number(indexEntry?.col);
    if (!Number.isFinite(levelSize) || levelSize <= 0 || !Number.isFinite(row) || !Number.isFinite(col)) {
      return null;
    }

    const weight = levelSize / targetLevel;
    if (!Number.isFinite(weight)) {
      return null;
    }

    rowIndex += row * weight;
    colIndex += col * weight;
  }

  if (!Number.isFinite(rowIndex) || !Number.isFinite(colIndex)) {
    return null;
  }

  return {
    rowIndex: Math.round(rowIndex),
    colIndex: Math.round(colIndex)
  };
};

const normalizeEmployeeId = (employeeId) => {
  if (employeeId === undefined || employeeId === null) {
    return '';
  }

  return String(employeeId).trim();
};

const buildAssignmentDiagnosticsPayload = (rows) => {
  const events = Array.isArray(rows)
    ? rows.map((row) => ({
      iteration: Number(row.iteration || 0),
      claimType: String(row.claim_type || '').trim().toLowerCase(),
      employeeId: normalizeEmployeeId(row.employee_id),
      gridCellId: String(row.grid_cell_id || ''),
      accountCount: Number(row.account_count || 0),
      currentAccountsBefore: Number(row.current_accounts_before || 0),
      currentAccountsAfter: Number(row.current_accounts_after || 0),
      targetWorkload: Number(row.target_workload || 0),
      maxCapacity: Number(row.max_capacity || 0)
    }))
    : [];

  const claimCounts = {
    adjacent: 0,
    gap_jump: 0,
    orphan: 0
  };

  events.forEach((event) => {
    if (event.claimType === 'adjacent') {
      claimCounts.adjacent += 1;
      return;
    }
    if (event.claimType === 'gap_jump') {
      claimCounts.gap_jump += 1;
      return;
    }
    if (event.claimType === 'orphan') {
      claimCounts.orphan += 1;
    }
  });

  return {
    totalEvents: events.length,
    iterations: events.length > 0
      ? Math.max(...events.map((event) => event.iteration))
      : 0,
    claimCounts,
    events
  };
};

const getTerritoryModeLabel = (mode) => {
  switch (mode) {
    case TERRITORY_VISUALIZATION_MODE.EXISTING_CUSTOMERS:
      return 'Existing Customer Mapped';
    case TERRITORY_VISUALIZATION_MODE.NEAREST_POCKETS:
      return 'Branches -> Nearest Pockets';
    case TERRITORY_VISUALIZATION_MODE.CUSTOMER_AVAILABILITY:
      return 'Branches -> Pockets with Customer Availability';
    default:
      return mode;
  }
};

const loadIndiaStateBoundsGeoJson = () => {
  if (cachedIndiaStateBoundsGeoJson) {
    return cachedIndiaStateBoundsGeoJson;
  }

  const availablePath = INDIA_STATE_BOUNDS_GEOJSON_CANDIDATE_PATHS.find((candidatePath) =>
    fs.existsSync(candidatePath)
  );

  if (!availablePath) {
    throw new Error(
      `State boundary GeoJSON not found. Checked: ${INDIA_STATE_BOUNDS_GEOJSON_CANDIDATE_PATHS.join(', ')}`
    );
  }

  const rawContent = fs.readFileSync(availablePath, 'utf8');
  const parsed = JSON.parse(rawContent);
  if (!parsed || parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
    throw new Error('Invalid state boundary GeoJSON format');
  }

  cachedIndiaStateBoundsGeoJson = parsed;
  return cachedIndiaStateBoundsGeoJson;
};

const incrementCount = (counterMap, key, amount = 1) => {
  counterMap.set(key, (counterMap.get(key) || 0) + amount);
};

const findNearestBranchForCoordinates = (lat, lon, branchRows) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  let nearestBranch = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  branchRows.forEach((branch) => {
    const distance = haversineDistance(lat, lon, branch.lat, branch.lon);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestBranch = branch;
    }
  });

  return nearestBranch;
};

const buildCustomerPocketMappingRecord = ({
  customerId,
  customerLat,
  customerLon,
  uploadedBranchCode = null,
  existingBranchId = null,
  distanceCustomerToExistingBranch = null,
  nearestPocket,
  selectedBranch,
  customerBucket = null
}) => {
  if (!nearestPocket || !selectedBranch) {
    throw new Error('Both nearestPocket and selectedBranch are required to build a mapping record');
  }

  const distancePocketToBranch = haversineDistance(
    Number(nearestPocket.centerLat),
    Number(nearestPocket.centerLon),
    Number(selectedBranch.lat),
    Number(selectedBranch.lon)
  );
  const distanceCustomerToBranch = haversineDistance(
    Number(customerLat),
    Number(customerLon),
    Number(selectedBranch.lat),
    Number(selectedBranch.lon)
  );

  if (!Number.isFinite(distancePocketToBranch) || !Number.isFinite(distanceCustomerToBranch)) {
    throw new Error('Resolved branch distance was invalid for mapped pocket');
  }

  return {
    customerId,
    customerLat,
    customerLon,
    uploadedBranchCode,
    existingBranchId,
    distanceCustomerToExistingBranch,
    pocketId: nearestPocket.pocketId,
    distanceCustomerToPocket: nearestPocket.distance,
    nearestBranchId: selectedBranch.id,
    distancePocketToBranch,
    distanceCustomerToBranch,
    customerBucket,
  };
};

const getPocketCenterSafely = (pocketId, config) => {
  if (!pocketId) {
    return null;
  }

  try {
    const decoded = decodePocketId(pocketId, config);
    if (!Number.isFinite(decoded.centerLat) || !Number.isFinite(decoded.centerLon)) {
      return null;
    }

    return {
      lat: decoded.centerLat,
      lon: decoded.centerLon
    };
  } catch {
    return null;
  }
};

const refreshBranchEmployeeGridCells = async (client, branchId, jobId, pocketConfig) => {
  const pocketCountsResult = await client.query(
    `
      SELECT
        cpm.pocket_id,
        COUNT(*)::int AS account_count
      FROM customer_pocket_mappings cpm
      WHERE cpm.job_id = $1
        AND cpm.nearest_branch_id = $2
        AND cpm.pocket_id IS NOT NULL
        AND btrim(cpm.pocket_id) <> ''
      GROUP BY cpm.pocket_id
      ORDER BY cpm.pocket_id
    `,
    [jobId, branchId]
  );

  if (pocketCountsResult.rows.length === 0) {
    throw new AppError(
      'No mapped pockets found for the selected branch in the latest customer mapping snapshot.',
      404,
      'NO_BRANCH_MAPPING_POCKETS'
    );
  }

  const pocketIds = Array.from(new Set(
    pocketCountsResult.rows
      .map((row) => String(row.pocket_id || '').trim())
      .filter(Boolean)
  ));

  const configGridLevels = normalizeConfigGridLevels(pocketConfig?.gridLevels);
  const configVersion = Number.isFinite(Number(pocketConfig?.configVersion))
    ? Number(pocketConfig.configVersion)
    : 1;
  const decodeConfig = {
    originLat: Number(pocketConfig?.originLat),
    originLon: Number(pocketConfig?.originLon),
    alphabet: String(pocketConfig?.alphabet || '')
  };

  const expectedPocketEntries = pocketIds.map((pocketId) => {
    const levelMeters = resolvePocketLevelMeters(pocketId, configGridLevels);
    return {
      pocketId,
      levelMeters
    };
  });

  const unresolvedPocketLevels = expectedPocketEntries.filter((entry) => !Number.isFinite(entry.levelMeters));
  if (unresolvedPocketLevels.length > 0) {
    const sampleUnresolved = unresolvedPocketLevels.slice(0, 10).map((entry) => entry.pocketId);
    throw new AppError(
      `Unable to resolve grid level for ${unresolvedPocketLevels.length} mapped pockets. Sample pocket IDs: ${sampleUnresolved.join(', ')}`,
      422,
      'POCKET_LEVEL_RESOLUTION_FAILED'
    );
  }

  const distinctPocketLevels = Array.from(new Set(
    expectedPocketEntries.map((entry) => Number(entry.levelMeters))
  )).sort((a, b) => a - b);
  if (distinctPocketLevels.length > 1) {
    throw new AppError(
      `Mapped pockets span multiple levels (${distinctPocketLevels.join(', ')}). Mixed-level assignment is not supported in this run.`,
      422,
      'MIXED_POCKET_LEVELS_UNSUPPORTED'
    );
  }
  const assignmentLevelMeters = Number(distinctPocketLevels[0] || GLOBAL_EMPTY_GRID_LEVEL_METERS);
  const assignmentLevelKm = resolveEmployeeGridLevelKm(
    assignmentLevelMeters,
    GLOBAL_EMPTY_GRID_LEVEL_METERS
  );

  const fetchMasterGeometryRows = async (codes, levels) => {
    if (!Array.isArray(codes) || codes.length === 0 || !Array.isArray(levels) || levels.length === 0) {
      return [];
    }

    const masterGeometryResult = await client.query(
      `
        SELECT
          gc.code::text AS pocket_id,
          gc.level_m::int AS level_m,
          ST_AsGeoJSON(
            ST_GeometryN(
              ST_Multi(
                ST_CollectionExtract(
                  ST_MakeValid(gc.geom),
                  3
                )
              ),
              1
            )
          )::json AS geometry
        FROM grid_cells gc
        WHERE gc.level_m = ANY($1::int[])
          AND gc.code = ANY($2::text[])
          AND gc.geom IS NOT NULL
          AND NOT ST_IsEmpty(gc.geom)
      `,
      [levels, codes]
    );
    return masterGeometryResult.rows;
  };

  const masterGeometryByPocketKey = new Map();
  const initialMasterRows = await fetchMasterGeometryRows(
    expectedPocketEntries.map((entry) => entry.pocketId),
    distinctPocketLevels
  );
  initialMasterRows.forEach((row) => {
    const pocketId = String(row.pocket_id || '').trim();
    const levelMeters = Number(row.level_m);
    if (pocketId && Number.isFinite(levelMeters) && row.geometry) {
      masterGeometryByPocketKey.set(`${levelMeters}|${pocketId}`, row.geometry);
    }
  });

  let missingPocketEntries = expectedPocketEntries.filter((entry) =>
    !masterGeometryByPocketKey.has(`${entry.levelMeters}|${entry.pocketId}`)
  );

  if (missingPocketEntries.length > 0) {
    const generatedMasterRows = missingPocketEntries.map((entry) => {
      try {
        const decodedPocket = decodePocketId(entry.pocketId, decodeConfig);
        const rowColIndex = computePocketRowColIndex(decodedPocket, entry.levelMeters);
        if (!rowColIndex) {
          return null;
        }

        const corners = decodedPocket?.corners;
        if (
          !corners
          || !Number.isFinite(corners.sw?.lat)
          || !Number.isFinite(corners.sw?.lon)
          || !Number.isFinite(corners.se?.lat)
          || !Number.isFinite(corners.se?.lon)
          || !Number.isFinite(corners.ne?.lat)
          || !Number.isFinite(corners.ne?.lon)
          || !Number.isFinite(corners.nw?.lat)
          || !Number.isFinite(corners.nw?.lon)
        ) {
          return null;
        }

        return {
          code: entry.pocketId,
          level_m: Number(entry.levelMeters),
          row_idx: rowColIndex.rowIndex,
          col_idx: rowColIndex.colIndex,
          label_lat: Number(decodedPocket.centerLat),
          label_lon: Number(decodedPocket.centerLon),
          corners: {
            sw: { lat: Number(corners.sw.lat), lon: Number(corners.sw.lon) },
            se: { lat: Number(corners.se.lat), lon: Number(corners.se.lon) },
            nw: { lat: Number(corners.nw.lat), lon: Number(corners.nw.lon) },
            ne: { lat: Number(corners.ne.lat), lon: Number(corners.ne.lon) }
          },
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [Number(corners.sw.lon), Number(corners.sw.lat)],
              [Number(corners.se.lon), Number(corners.se.lat)],
              [Number(corners.ne.lon), Number(corners.ne.lat)],
              [Number(corners.nw.lon), Number(corners.nw.lat)],
              [Number(corners.sw.lon), Number(corners.sw.lat)]
            ]]
          }
        };
      } catch {
        return null;
      }
    }).filter(Boolean);

    if (generatedMasterRows.length > 0) {
      await client.query(
        `
          INSERT INTO grid_cells (
            config_version,
            level_m,
            row_idx,
            col_idx,
            code,
            label_lat,
            label_lon,
            corners,
            geom,
            label_geom
          )
          SELECT
            $1::integer AS config_version,
            generated.level_m::integer,
            generated.row_idx::integer,
            generated.col_idx::integer,
            generated.code::varchar(20),
            generated.label_lat::double precision,
            generated.label_lon::double precision,
            generated.corners::jsonb,
            ST_GeometryN(
              ST_Multi(
                ST_CollectionExtract(
                  ST_MakeValid(
                    ST_SetSRID(ST_GeomFromGeoJSON(generated.geometry::text), 4326)
                  ),
                  3
                )
              ),
              1
            )::geometry(POLYGON, 4326) AS geom,
            ST_SetSRID(
              ST_MakePoint(generated.label_lon::double precision, generated.label_lat::double precision),
              4326
            )::geometry(POINT, 4326) AS label_geom
          FROM jsonb_to_recordset($2::jsonb) AS generated(
            code text,
            level_m integer,
            row_idx integer,
            col_idx integer,
            label_lat double precision,
            label_lon double precision,
            corners jsonb,
            geometry jsonb
          )
          ON CONFLICT (config_version, level_m, row_idx, col_idx)
          DO UPDATE SET
            code = EXCLUDED.code,
            label_lat = EXCLUDED.label_lat,
            label_lon = EXCLUDED.label_lon,
            corners = EXCLUDED.corners,
            geom = EXCLUDED.geom,
            label_geom = EXCLUDED.label_geom
        `,
        [configVersion, JSON.stringify(generatedMasterRows)]
      );
    }

    const reloadedMasterRows = await fetchMasterGeometryRows(
      missingPocketEntries.map((entry) => entry.pocketId),
      Array.from(new Set(missingPocketEntries.map((entry) => Number(entry.levelMeters))))
    );
    reloadedMasterRows.forEach((row) => {
      const pocketId = String(row.pocket_id || '').trim();
      const levelMeters = Number(row.level_m);
      if (pocketId && Number.isFinite(levelMeters) && row.geometry) {
        masterGeometryByPocketKey.set(`${levelMeters}|${pocketId}`, row.geometry);
      }
    });

    missingPocketEntries = expectedPocketEntries.filter((entry) =>
      !masterGeometryByPocketKey.has(`${entry.levelMeters}|${entry.pocketId}`)
    );
  }

  if (missingPocketEntries.length > 0) {
    const sampleMissingPocketIds = missingPocketEntries.slice(0, 10).map((entry) => entry.pocketId);
    const expectedLevel = distinctPocketLevels[0];
    throw new AppError(
      `Missing exact ${expectedLevel}m geometries in grid_cells for ${missingPocketEntries.length} mapped pockets. Sample pocket IDs: ${sampleMissingPocketIds.join(', ')}`,
      422,
      'MASTER_GRID_GEOMETRY_MISSING'
    );
  }

  const assignmentPocketRows = pocketCountsResult.rows
    .map((row) => {
      const pocketId = String(row.pocket_id || '').trim();
      const levelMeters = resolvePocketLevelMeters(pocketId, configGridLevels);
      const geometry = masterGeometryByPocketKey.get(`${levelMeters}|${pocketId}`);
      if (!pocketId || !geometry) {
        return null;
      }

      return {
        pocket_id: pocketId,
        account_count: Number(row.account_count || 0),
        geometry
      };
    })
    .filter(Boolean);

  if (assignmentPocketRows.length === 0) {
    throw new AppError(
      'Unable to decode mapped pocket geometries for branch territory assignment.',
      422,
      'INVALID_POCKET_GEOMETRIES'
    );
  }

  await client.query(
    `
      DELETE FROM ${EMPLOYEE_GRID_CELL_TABLE}
      WHERE branch_id = $1
        AND COALESCE(level_km, 1) = $2::integer
    `,
    [branchId, assignmentLevelKm]
  );

  await client.query(
    `
      INSERT INTO ${EMPLOYEE_GRID_CELL_TABLE} (
        branch_id,
        pocket_id,
        level_km,
        account_count,
        assigned_employee_id,
        geom
      )
      SELECT
        $1::varchar AS branch_id,
        pockets.pocket_id::varchar,
        $3::integer AS level_km,
        GREATEST(COALESCE(pockets.account_count, 0), 0)::integer AS account_count,
        NULL::varchar AS assigned_employee_id,
        ST_GeometryN(
          ST_Multi(
            ST_CollectionExtract(
              ST_MakeValid(
                ST_SetSRID(
                  ST_GeomFromGeoJSON(pockets.geometry::text),
                  4326
                )
              ),
              3
            )
          ),
          1
        )::geometry(POLYGON, 4326) AS geom
      FROM jsonb_to_recordset($2::jsonb) AS pockets(
        pocket_id text,
        account_count integer,
        geometry jsonb
      )
      `,
    [branchId, JSON.stringify(assignmentPocketRows), assignmentLevelKm]
  );

  return {
    totalPocketCount: assignmentPocketRows.length,
    masterGeometryCount: assignmentPocketRows.length,
    fallbackGeometryCount: 0,
    assignmentLevelMeters
  };
};

const refreshBranchEmployeeGridCellsFromPersistentTerritories = async (
  client,
  branchId,
  jobId,
  requestedLevelMeters = null
) => {
  const resolvedLevelResult = await client.query(
    `
      WITH preferred_level AS (
        SELECT
          COALESCE(
            $2::integer,
            (
              SELECT bt.level_m
              FROM ${BRANCH_TERRITORY_TABLE} bt
              WHERE bt.branch_id = $1
                AND bt.grid_code ~ $3::text
              GROUP BY bt.level_m
              ORDER BY COUNT(*) DESC, bt.level_m DESC
              LIMIT 1
            )
          )::int AS level_m
      )
      SELECT preferred_level.level_m
      FROM preferred_level
    `,
    [
      branchId,
      Number.isFinite(Number(requestedLevelMeters))
        ? Math.round(Number(requestedLevelMeters))
        : null,
      CANONICAL_POCKET_CODE_SQL_PATTERN
    ]
  );

  const assignmentLevelMeters = Number(resolvedLevelResult.rows[0]?.level_m || 0);
  if (!Number.isFinite(assignmentLevelMeters) || assignmentLevelMeters <= 0) {
    throw new AppError(
      'No persistent branch territories found for this branch. Pre-allocate branch pockets before generating employee allocation.',
      404,
      'NO_PERSISTED_BRANCH_TERRITORIES'
    );
  }
  const assignmentLevelKm = resolveEmployeeGridLevelKm(
    assignmentLevelMeters,
    GLOBAL_EMPTY_GRID_LEVEL_METERS
  );

  const persistentRowsResult = await client.query(
    `
      WITH pocket_counts AS (
        SELECT
          cpm.pocket_id::text AS pocket_id,
          COUNT(*)::int AS account_count
        FROM customer_pocket_mappings cpm
        WHERE cpm.job_id = $2
          AND cpm.nearest_branch_id = $1
          AND cpm.pocket_id IS NOT NULL
          AND btrim(cpm.pocket_id) <> ''
        GROUP BY cpm.pocket_id
      )
      SELECT
        bt.grid_code::text AS pocket_id,
        COALESCE(pocket_counts.account_count, 0)::int AS account_count,
        ST_AsGeoJSON(
          ST_GeometryN(
            ST_Multi(
              ST_CollectionExtract(
                ST_MakeValid(gc.geom),
                3
              )
            ),
            1
          )
        )::json AS geometry
      FROM ${BRANCH_TERRITORY_TABLE} bt
      JOIN grid_cells gc
        ON gc.code = bt.grid_code
       AND gc.level_m = bt.level_m
      LEFT JOIN pocket_counts
        ON pocket_counts.pocket_id = bt.grid_code::text
      WHERE bt.branch_id = $1
        AND bt.level_m = $3::integer
        AND bt.grid_code ~ $4::text
        AND gc.geom IS NOT NULL
        AND NOT ST_IsEmpty(gc.geom)
      ORDER BY bt.grid_code
    `,
    [branchId, jobId, assignmentLevelMeters, CANONICAL_POCKET_CODE_SQL_PATTERN]
  );

  if (persistentRowsResult.rows.length === 0) {
    throw new AppError(
      `No persisted branch pockets with valid geometry found at level ${assignmentLevelMeters}m for this branch.`,
      404,
      'NO_PERSISTED_BRANCH_TERRITORIES'
    );
  }

  const assignmentPocketRows = persistentRowsResult.rows
    .map((row) => {
      const pocketId = String(row.pocket_id || '').trim();
      if (!pocketId || !row.geometry) {
        return null;
      }
      return {
        pocket_id: pocketId,
        account_count: Number(row.account_count || 0),
        geometry: row.geometry
      };
    })
    .filter(Boolean);

  await client.query(
    `
      DELETE FROM ${EMPLOYEE_GRID_CELL_TABLE}
      WHERE branch_id = $1
        AND COALESCE(level_km, 1) = $2::integer
    `,
    [branchId, assignmentLevelKm]
  );

  await client.query(
    `
      INSERT INTO ${EMPLOYEE_GRID_CELL_TABLE} (
        branch_id,
        pocket_id,
        level_km,
        account_count,
        assigned_employee_id,
        geom
      )
      SELECT
        $1::varchar AS branch_id,
        pockets.pocket_id::varchar,
        $3::integer AS level_km,
        GREATEST(COALESCE(pockets.account_count, 0), 0)::integer AS account_count,
        NULL::varchar AS assigned_employee_id,
        ST_GeometryN(
          ST_Multi(
            ST_CollectionExtract(
              ST_MakeValid(
                ST_SetSRID(
                  ST_GeomFromGeoJSON(pockets.geometry::text),
                  4326
                )
              ),
              3
            )
          ),
          1
        )::geometry(POLYGON, 4326) AS geom
      FROM jsonb_to_recordset($2::jsonb) AS pockets(
        pocket_id text,
        account_count integer,
        geometry jsonb
      )
      `,
    [branchId, JSON.stringify(assignmentPocketRows), assignmentLevelKm]
  );

  return {
    totalPocketCount: assignmentPocketRows.length,
    masterGeometryCount: assignmentPocketRows.length,
    fallbackGeometryCount: 0,
    assignmentLevelMeters
  };
};

const fillBranchTerritoryEmptyGridCoverage = async (
  client,
  branchId,
  jobId,
  assignmentLevelMeters
) => {
  const normalizedAssignmentLevel = Number(assignmentLevelMeters);
  const effectiveLevelMeters = Number.isFinite(normalizedAssignmentLevel) && normalizedAssignmentLevel > 0
    ? Math.round(normalizedAssignmentLevel)
    : GLOBAL_EMPTY_GRID_LEVEL_METERS;
  const effectiveLevelKm = resolveEmployeeGridLevelKm(
    effectiveLevelMeters,
    GLOBAL_EMPTY_GRID_LEVEL_METERS
  );
  const paddedCatchmentRadiusMeters = resolvePaddedCatchmentRadiusMeters(effectiveLevelMeters);

  const schemaCheckResult = await client.query(
    `
      SELECT
        COUNT(*)::int AS required_columns
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'grid_cells'
        AND column_name = ANY($1::text[])
    `,
    [['level_m', 'code', 'geom']]
  );

  const requiredColumns = Number(schemaCheckResult.rows[0]?.required_columns || 0);
  if (requiredColumns < 3) {
    return {
      candidateCount: 0,
      insertedCount: 0,
      skipped: true,
      reason: 'GLOBAL_GRID_SCHEMA_UNAVAILABLE',
      candidateSource: null,
      hasMasterGridLevel: false,
      generatedFallbackUsed: false
    };
  }

  const masterGridLevelResult = await client.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM grid_cells
        WHERE level_m = $1
        LIMIT 1
      ) AS has_level_rows
    `,
    [effectiveLevelMeters]
  );
  const hasMasterGridLevel = Boolean(masterGridLevelResult.rows[0]?.has_level_rows);
  if (!hasMasterGridLevel) {
    throw new AppError(
      `Master grid_cells does not contain level_m = ${effectiveLevelMeters}. Populate the complete master grid for the assignment pocket level before running territory assignment.`,
      422,
      'MASTER_GRID_LEVEL_UNAVAILABLE'
    );
  }

  const seededReferenceResult = await client.query(
    `
      SELECT
        COUNT(*) FILTER (
          WHERE assignment.employee_id IS NOT NULL
            AND COALESCE(assignment.account_count, 0) > 0
        )::int AS populated_reference_count,
        COUNT(*) FILTER (
          WHERE assignment.employee_id IS NOT NULL
        )::int AS total_reference_count
      FROM tmp_employee_territory_assignment assignment
    `
  );
  const populatedReferenceCount = Number(
    seededReferenceResult.rows[0]?.populated_reference_count || 0
  );
  const totalReferenceCount = Number(
    seededReferenceResult.rows[0]?.total_reference_count || 0
  );
  if (totalReferenceCount === 0) {
    return {
      candidateCount: 0,
      insertedCount: 0,
      skipped: true,
      reason: 'NO_REFERENCE_ASSIGNMENTS',
      candidateSource: `master_grid_cells_${Math.round(BRANCH_CATCHMENT_RADIUS_METERS / 1000)}km`,
      hasMasterGridLevel,
      generatedFallbackUsed: false
    };
  }

  const fillResult = await client.query(
    `
      WITH branch_geom AS (
        SELECT
          COALESCE(
            branches.geom::geometry,
            ST_SetSRID(ST_MakePoint(branches.lon, branches.lat), 4326)
          ) AS geom
        FROM branches
        WHERE branches.id = $1
      ),
      catchment_area AS (
        SELECT
          ST_Buffer(branch_geom.geom::geography, $3::numeric)::geometry AS geom
        FROM branch_geom
      ),
      pocket_accounts AS (
        SELECT
          cpm.pocket_id::text AS pocket_id,
          COUNT(*)::int AS account_count
        FROM customer_pocket_mappings cpm
        WHERE cpm.job_id = $2
          AND cpm.nearest_branch_id = $1
          AND cpm.pocket_id IS NOT NULL
          AND btrim(cpm.pocket_id) <> ''
        GROUP BY cpm.pocket_id
      ),
      catchment_grid_cells AS (
        SELECT
          gc.code::varchar AS pocket_id,
          gc.geom
        FROM grid_cells gc
        JOIN branch_geom bg
          -- --- ORIGINAL BACKUP ---
          -- ON ST_Intersects(gc.geom, catchment_area.geom)
          ON ST_DWithin(
            ST_PointOnSurface(gc.geom)::geography,
            bg.geom::geography,
            $3::double precision
          )
        WHERE gc.level_m = $4::integer
          AND gc.code IS NOT NULL
          AND btrim(gc.code) <> ''
          AND gc.code ~ $5::text
          AND gc.geom IS NOT NULL
          AND NOT ST_IsEmpty(gc.geom)
      ),
      assigned_seed_populated AS (
        SELECT
          assignment.employee_id,
          assignment.geom
        FROM tmp_employee_territory_assignment assignment
        WHERE assignment.employee_id IS NOT NULL
          AND COALESCE(assignment.account_count, 0) > 0
      ),
      assigned_seed AS (
        SELECT
          assigned_seed_populated.employee_id,
          assigned_seed_populated.geom
        FROM assigned_seed_populated
        UNION ALL
        SELECT
          assignment.employee_id,
          assignment.geom
        FROM tmp_employee_territory_assignment assignment
        WHERE assignment.employee_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM assigned_seed_populated
          )
      ),
      empty_candidates_raw AS (
        SELECT
          catchment_grid_cells.pocket_id,
          catchment_grid_cells.geom
        FROM catchment_grid_cells
        LEFT JOIN pocket_accounts
          ON pocket_accounts.pocket_id = catchment_grid_cells.pocket_id
        WHERE COALESCE(pocket_accounts.account_count, 0) = 0
          AND NOT EXISTS (
            SELECT 1
            FROM employee_grid_cells egc
            WHERE egc.branch_id = $1
              AND COALESCE(egc.level_km, 1) = $6::integer
              AND egc.pocket_id IS NOT NULL
              AND egc.pocket_id = catchment_grid_cells.pocket_id
          )
      ),
      empty_candidates AS (
        SELECT
          empty_candidates_raw.pocket_id,
          ST_GeometryN(
            ST_Multi(
              ST_CollectionExtract(
                ST_MakeValid(empty_candidates_raw.geom),
                3
              )
            ),
            1
          )::geometry(POLYGON, 4326) AS geom
        FROM empty_candidates_raw
      ),
      nearest_assignment AS (
        SELECT
          empty_candidates.pocket_id,
          empty_candidates.geom,
          nearest.employee_id
        FROM empty_candidates
        JOIN LATERAL (
          SELECT
            assigned_seed.employee_id
          FROM assigned_seed
          ORDER BY ST_Distance(
            ST_ClosestPoint(
              assigned_seed.geom,
              empty_candidates.geom
            )::geography,
            ST_PointOnSurface(empty_candidates.geom)::geography
          ),
          assigned_seed.employee_id
          LIMIT 1
        ) nearest
          ON TRUE
      ),
      inserted_cells AS (
        INSERT INTO employee_grid_cells (
          branch_id,
          pocket_id,
          level_km,
          account_count,
          assigned_employee_id,
          geom
        )
        SELECT
          $1::varchar AS branch_id,
          nearest_assignment.pocket_id,
          $6::integer AS level_km,
          0::integer AS account_count,
          nearest_assignment.employee_id AS assigned_employee_id,
          nearest_assignment.geom
        FROM nearest_assignment
        RETURNING
          branch_id,
          id::text AS grid_cell_id,
          assigned_employee_id AS employee_id,
          account_count,
          ST_Multi(
            ST_CollectionExtract(
              ST_MakeValid(geom),
              3
            )
          )::geometry(MULTIPOLYGON, 4326) AS geom
      ),
      inserted_into_tmp AS (
        INSERT INTO tmp_employee_territory_assignment (
          branch_id,
          grid_cell_id,
          employee_id,
          account_count,
          geom
        )
        SELECT
          inserted_cells.branch_id,
          inserted_cells.grid_cell_id,
          inserted_cells.employee_id,
          inserted_cells.account_count,
          inserted_cells.geom
        FROM inserted_cells
        RETURNING 1
      ),
      candidate_count AS (
        SELECT
          COUNT(*)::int AS candidate_count
        FROM empty_candidates
      ),
      catchment_grid_count AS (
        SELECT
          COUNT(*)::int AS catchment_grid_count
        FROM catchment_grid_cells
      )
      SELECT
        candidate_count.candidate_count,
        catchment_grid_count.catchment_grid_count,
        (
          SELECT COUNT(*)::int
          FROM inserted_into_tmp
        ) AS inserted_count
      FROM candidate_count
      CROSS JOIN catchment_grid_count
    `,
    [
      branchId,
      jobId,
      // --- ORIGINAL BACKUP ---
      // BRANCH_CATCHMENT_FETCH_RADIUS_METERS,
      paddedCatchmentRadiusMeters,
      effectiveLevelMeters,
      CANONICAL_POCKET_CODE_SQL_PATTERN,
      effectiveLevelKm
    ]
  );

  const candidateCount = Number(fillResult.rows[0]?.candidate_count || 0);
  const catchmentGridCount = Number(fillResult.rows[0]?.catchment_grid_count || 0);
  const insertedCount = Number(fillResult.rows[0]?.inserted_count || 0);
  if (catchmentGridCount === 0) {
    // --- ORIGINAL BACKUP ---
    // throw new AppError(
    //   `No level_m = ${effectiveLevelMeters} master grid cells found inside the 40km catchment for branch ${branchId}. Populate grid_cells coverage before assignment.`,
    //   422,
    //   'MASTER_GRID_CATCHMENT_EMPTY'
    // );
    throw new AppError(
      `No level_m = ${effectiveLevelMeters} master grid cells found inside the ${Math.round(paddedCatchmentRadiusMeters / 1000)}km padded catchment for branch ${branchId}. Populate grid_cells coverage before assignment.`,
      422,
      'MASTER_GRID_CATCHMENT_EMPTY'
    );
  }

  return {
    candidateCount,
    insertedCount,
    skipped: candidateCount === 0 && insertedCount === 0,
    reason: candidateCount === 0 ? 'NO_EMPTY_GRID_CANDIDATES_IN_40KM' : null,
    candidateSource: `master_grid_cells_${Math.round(paddedCatchmentRadiusMeters / 1000)}km_padded`,
    populatedReferenceCount,
    catchmentGridCount,
    hasMasterGridLevel,
    assignmentLevelMeters: effectiveLevelMeters,
    generatedFallbackUsed: false
  };
};

const persistBranchEmployeeTerritories = async (
  client,
  branchId,
  assignmentLevelMeters
) => {
  const normalizedLevelMeters = Number(assignmentLevelMeters);
  const effectiveLevelMeters = Number.isFinite(normalizedLevelMeters) && normalizedLevelMeters > 0
    ? Math.round(normalizedLevelMeters)
    : GLOBAL_EMPTY_GRID_LEVEL_METERS;
  const effectiveLevelKm = resolveEmployeeGridLevelKm(
    effectiveLevelMeters,
    GLOBAL_EMPTY_GRID_LEVEL_METERS
  );

  const deleteEmployeeAssignmentsResult = await client.query(
    `
      DELETE FROM ${EMPLOYEE_TERRITORY_TABLE} et
      USING ${BRANCH_TERRITORY_TABLE} bt
      WHERE bt.branch_id = $1
        AND bt.level_m = $2::integer
        AND et.branch_id = bt.branch_id
        AND et.grid_code = bt.grid_code
    `,
    [branchId, effectiveLevelMeters]
  );

  const deleteBranchTerritoriesResult = await client.query(
    `
      DELETE FROM ${BRANCH_TERRITORY_TABLE}
      WHERE branch_id = $1
        AND level_m = $2::integer
    `,
    [branchId, effectiveLevelMeters]
  );

  const insertBranchTerritoriesResult = await client.query(
    `
      INSERT INTO ${BRANCH_TERRITORY_TABLE} (
        branch_id,
        grid_code,
        level_m
      )
      SELECT DISTINCT
        egc.branch_id,
        egc.pocket_id::varchar AS grid_code,
        $2::integer AS level_m
      FROM ${EMPLOYEE_GRID_CELL_TABLE} egc
      WHERE egc.branch_id = $1
        AND COALESCE(egc.level_km, 1) = $4::integer
        AND egc.pocket_id IS NOT NULL
        AND btrim(egc.pocket_id) <> ''
        AND egc.pocket_id ~ $3::text
      ON CONFLICT (branch_id, grid_code)
      DO UPDATE SET
        level_m = EXCLUDED.level_m,
        updated_at = CURRENT_TIMESTAMP
      RETURNING 1
    `,
    [branchId, effectiveLevelMeters, CANONICAL_POCKET_CODE_SQL_PATTERN, effectiveLevelKm]
  );

  await client.query(
    `
      WITH distinct_assigned AS (
        SELECT DISTINCT
          egc.branch_id,
          egc.assigned_employee_id::varchar AS employee_code
        FROM ${EMPLOYEE_GRID_CELL_TABLE} egc
        WHERE egc.branch_id = $1
          AND COALESCE(egc.level_km, 1) = $2::integer
          AND egc.assigned_employee_id IS NOT NULL
          AND btrim(egc.assigned_employee_id) <> ''
      ),
      ordered_assigned AS (
        SELECT
          distinct_assigned.branch_id,
          distinct_assigned.employee_code,
          ROW_NUMBER() OVER (
            PARTITION BY distinct_assigned.branch_id
            ORDER BY distinct_assigned.employee_code
          ) - 1 AS color_ord
        FROM distinct_assigned
      ),
      color_palette AS (
        SELECT ARRAY[
          '#D50711', '#10B981', '#8B4513', '#B8860B', '#000000', '#FFFFFF'
        ]::text[] AS colors
      )
      INSERT INTO branch_employees (
        branch_id,
        employee_id,
        employee_name,
        name,
        color_code,
        is_active
      )
      SELECT
        ordered_assigned.branch_id,
        ordered_assigned.employee_code,
        ordered_assigned.employee_code,
        ordered_assigned.employee_code,
        color_palette.colors[
          (ordered_assigned.color_ord % array_length(color_palette.colors, 1)) + 1
        ]::varchar,
        TRUE
      FROM ordered_assigned
      CROSS JOIN color_palette
      LEFT JOIN branch_employees existing
        ON existing.branch_id = ordered_assigned.branch_id
       AND existing.employee_id = ordered_assigned.employee_code
      WHERE existing.id IS NULL
      ON CONFLICT (branch_id, employee_id)
      DO UPDATE SET
        is_active = TRUE,
        updated_at = CURRENT_TIMESTAMP
    `,
    [branchId, effectiveLevelKm]
  );

  const insertEmployeeTerritoriesResult = await client.query(
    `
      INSERT INTO ${EMPLOYEE_TERRITORY_TABLE} (
        branch_employee_id,
        employee_id,
        branch_id,
        grid_code
      )
      SELECT DISTINCT
        be.id::int AS branch_employee_id,
        egc.assigned_employee_id::varchar AS employee_id,
        egc.branch_id,
        egc.pocket_id::varchar AS grid_code
      FROM ${EMPLOYEE_GRID_CELL_TABLE} egc
      JOIN ${BRANCH_TERRITORY_TABLE} bt
        ON bt.branch_id = egc.branch_id
       AND bt.grid_code = egc.pocket_id::varchar
      JOIN branch_employees be
        ON be.branch_id = egc.branch_id
       AND be.employee_id = egc.assigned_employee_id::varchar
      WHERE egc.branch_id = $1
        AND COALESCE(egc.level_km, 1) = $2::integer
        AND egc.pocket_id IS NOT NULL
        AND btrim(egc.pocket_id) <> ''
        AND egc.assigned_employee_id IS NOT NULL
        AND btrim(egc.assigned_employee_id) <> ''
      ON CONFLICT (branch_id, grid_code)
      DO UPDATE SET
        branch_employee_id = EXCLUDED.branch_employee_id,
        employee_id = EXCLUDED.employee_id,
        branch_id = EXCLUDED.branch_id,
        updated_at = CURRENT_TIMESTAMP
      RETURNING 1
    `,
    [branchId, effectiveLevelKm]
  );

  return {
    assignmentLevelMeters: effectiveLevelMeters,
    deletedEmployeeAssignments: deleteEmployeeAssignmentsResult.rowCount,
    deletedBranchTerritories: deleteBranchTerritoriesResult.rowCount,
    insertedBranchTerritories: insertBranchTerritoriesResult.rowCount,
    insertedEmployeeTerritories: insertEmployeeTerritoriesResult.rowCount
  };
};

const clearBranchPersistentTerritoryState = async (
  client,
  branchId,
  levelMeters
) => {
  const normalizedLevelMeters = Number(levelMeters);
  const effectiveLevelMeters = Number.isFinite(normalizedLevelMeters) && normalizedLevelMeters > 0
    ? Math.round(normalizedLevelMeters)
    : DEFAULT_PERSISTENT_TERRITORY_LEVEL_METERS;

  const deleteEmployeeAssignmentsResult = await client.query(
    `
      DELETE FROM ${EMPLOYEE_TERRITORY_TABLE} et
      WHERE et.branch_id = $1
        AND EXISTS (
          SELECT 1
          FROM ${BRANCH_TERRITORY_TABLE} bt
          WHERE bt.branch_id = et.branch_id
            AND bt.grid_code = et.grid_code
            AND bt.level_m = $2::integer
        )
    `,
    [branchId, effectiveLevelMeters]
  );

  const deleteBranchAndClearGridResult = await client.query(
    `
      WITH deleted_branch_territories AS (
        DELETE FROM ${BRANCH_TERRITORY_TABLE}
        WHERE branch_id = $1
          AND level_m = $2::integer
        RETURNING grid_code, level_m
      ),
      cleared_grid_cells AS (
        UPDATE grid_cells gc
        SET
          allocated_employee_id = NULL,
          allocated_since = NULL
        FROM deleted_branch_territories deleted
        WHERE gc.code = deleted.grid_code
          AND gc.level_m = deleted.level_m
        RETURNING 1
      )
      SELECT
        (SELECT COUNT(*)::int FROM deleted_branch_territories) AS deleted_branch_territories,
        (SELECT COUNT(*)::int FROM cleared_grid_cells) AS cleared_grid_cells
    `,
    [branchId, effectiveLevelMeters]
  );

  return {
    assignmentLevelMeters: effectiveLevelMeters,
    deletedEmployeeAssignments: Number(deleteEmployeeAssignmentsResult.rowCount || 0),
    deletedBranchTerritories: Number(deleteBranchAndClearGridResult.rows[0]?.deleted_branch_territories || 0),
    clearedGridCells: Number(deleteBranchAndClearGridResult.rows[0]?.cleared_grid_cells || 0)
  };
};

const findPreferredBranchByVotes = (voteCounter) => {
  let selectedBranchId = null;
  let selectedCount = -1;

  voteCounter.forEach((count, branchId) => {
    if (count > selectedCount) {
      selectedCount = count;
      selectedBranchId = branchId;
      return;
    }

    if (count === selectedCount && selectedBranchId && String(branchId).localeCompare(selectedBranchId) < 0) {
      selectedBranchId = branchId;
    }
  });

  return selectedBranchId;
};

const resolveLatestMappingsJobId = async () => {
  const latestJobResult = await query(
    `
      SELECT cpm.job_id
      FROM customer_pocket_mappings cpm
      JOIN jobs j ON j.job_id = cpm.job_id
      ORDER BY j.completed_at DESC NULLS LAST, cpm.created_at DESC
      LIMIT 1
    `
  );

  return latestJobResult.rows.length > 0 ? latestJobResult.rows[0].job_id : null;
};

const resolvePersistentTerritoryLevelMeters = async (client, requestedLevelMeters) => {
  const parsedRequestedLevel = Number(requestedLevelMeters);
  if (Number.isFinite(parsedRequestedLevel) && parsedRequestedLevel > 0) {
    return Math.round(parsedRequestedLevel);
  }

  const configResult = await client.query(
    `
      SELECT grid_levels
      FROM config
      WHERE id = 1
    `
  );

  if (configResult.rows.length > 0) {
    const configLevels = normalizeConfigGridLevels(configResult.rows[0]?.grid_levels);
    const configuredDefault = Number(configLevels[3]);
    if (Number.isFinite(configuredDefault) && configuredDefault > 0) {
      return Math.round(configuredDefault);
    }
  }

  return DEFAULT_PERSISTENT_TERRITORY_LEVEL_METERS;
};

const ensureBranchCatchmentCoverage = async (
  client,
  branchId,
  levelMeters
) => {
  const effectiveLevelMeters = Number.isFinite(Number(levelMeters)) && Number(levelMeters) > 0
    ? Math.round(Number(levelMeters))
    : DEFAULT_PERSISTENT_TERRITORY_LEVEL_METERS;
  const paddedCatchmentRadiusMeters = resolvePaddedCatchmentRadiusMeters(effectiveLevelMeters);

  const result = await client.query(
    `
      WITH branch_geom AS (
        SELECT
          COALESCE(
            branches.geom::geometry,
            ST_SetSRID(ST_MakePoint(branches.lon, branches.lat), 4326)
          ) AS geom
        FROM branches
        WHERE branches.id = $1
      ),
      catchment AS (
        SELECT
          ST_Buffer(branch_geom.geom::geography, $3::numeric)::geometry AS geom
        FROM branch_geom
      ),
      catchment_master AS (
        SELECT DISTINCT
          grid_cells.code::varchar AS grid_code
        FROM branch_geom
        JOIN grid_cells
          ON grid_cells.level_m = $2::integer
         AND grid_cells.geom IS NOT NULL
         AND NOT ST_IsEmpty(grid_cells.geom)
         -- --- ORIGINAL BACKUP ---
         -- AND ST_Intersects(grid_cells.geom, catchment.geom)
         AND ST_DWithin(
           ST_PointOnSurface(grid_cells.geom)::geography,
           branch_geom.geom::geography,
           $3::double precision
         )
         AND grid_cells.code ~ $4::text
      ),
      removed_outside AS (
        DELETE FROM ${BRANCH_TERRITORY_TABLE} bt
        WHERE bt.branch_id = $1
          AND bt.level_m = $2::integer
          AND (
            bt.grid_code !~ $4::text
            OR NOT EXISTS (
              SELECT 1
              FROM catchment_master
              WHERE catchment_master.grid_code = bt.grid_code
            )
          )
        RETURNING 1
      ),
      upserted_branch AS (
        INSERT INTO ${BRANCH_TERRITORY_TABLE} (
          branch_id,
          grid_code,
          level_m
        )
        SELECT
          $1::varchar AS branch_id,
          catchment_master.grid_code,
          $2::integer AS level_m
        FROM catchment_master
        ON CONFLICT (branch_id, grid_code)
        DO UPDATE SET
          level_m = EXCLUDED.level_m,
          updated_at = CURRENT_TIMESTAMP
        RETURNING 1
      )
      SELECT
        0::int AS generated_candidate_count,
        0::int AS inserted_master_count,
        (SELECT COUNT(*)::int FROM catchment_master) AS catchment_grid_count,
        (SELECT COUNT(*)::int FROM removed_outside) AS removed_outside_count,
        (SELECT COUNT(*)::int FROM upserted_branch) AS upserted_branch_count
    `,
    [
      branchId,
      effectiveLevelMeters,
      // --- ORIGINAL BACKUP ---
      // BRANCH_CATCHMENT_FETCH_RADIUS_METERS,
      paddedCatchmentRadiusMeters,
      CANONICAL_POCKET_CODE_SQL_PATTERN
    ]
  );

  return {
    assignmentLevelMeters: effectiveLevelMeters,
    generatedCandidateCount: Number(result.rows[0]?.generated_candidate_count || 0),
    insertedMasterCount: Number(result.rows[0]?.inserted_master_count || 0),
    catchmentGridCount: Number(result.rows[0]?.catchment_grid_count || 0),
    removedOutsideCount: Number(result.rows[0]?.removed_outside_count || 0),
    upsertedBranchCount: Number(result.rows[0]?.upserted_branch_count || 0)
  };
};

const pruneBranchEmployeeGridCellsToCatchment = async (
  client,
  branchId,
  levelMeters
) => {
  const effectiveLevelMeters = Number.isFinite(Number(levelMeters)) && Number(levelMeters) > 0
    ? Math.round(Number(levelMeters))
    : DEFAULT_PERSISTENT_TERRITORY_LEVEL_METERS;
  const effectiveLevelKm = resolveEmployeeGridLevelKm(
    effectiveLevelMeters,
    DEFAULT_PERSISTENT_TERRITORY_LEVEL_METERS
  );
  const paddedCatchmentRadiusMeters = resolvePaddedCatchmentRadiusMeters(effectiveLevelMeters);

  const pruneResult = await client.query(
    `
      WITH branch_geom AS (
        SELECT
          COALESCE(
            branches.geom::geometry,
            ST_SetSRID(ST_MakePoint(branches.lon, branches.lat), 4326)
          ) AS geom
        FROM branches
        WHERE branches.id = $1
      ),
      removed_rows AS (
        DELETE FROM ${EMPLOYEE_GRID_CELL_TABLE} egc
        WHERE egc.branch_id = $1
          AND COALESCE(egc.level_km, 1) = $4::integer
          AND (
            egc.pocket_id IS NULL
            OR btrim(egc.pocket_id::text) = ''
            OR NOT EXISTS (
              SELECT 1
              FROM grid_cells gc
              CROSS JOIN branch_geom bg
              WHERE gc.code = egc.pocket_id::text
                AND gc.level_m = $2::integer
                AND gc.geom IS NOT NULL
                AND NOT ST_IsEmpty(gc.geom)
                AND ST_DWithin(
                  -- --- ORIGINAL BACKUP ---
                  -- gc.geom::geography,
                  ST_PointOnSurface(gc.geom)::geography,
                  bg.geom::geography,
                  $3::double precision
                )
            )
          )
        RETURNING 1
      )
      SELECT
        (SELECT COUNT(*)::int FROM removed_rows) AS removed_rows,
        (
          SELECT COUNT(*)::int
          FROM ${EMPLOYEE_GRID_CELL_TABLE} egc
          WHERE egc.branch_id = $1
            AND COALESCE(egc.level_km, 1) = $4::integer
        ) AS remaining_rows
    `,
    [
      branchId,
      effectiveLevelMeters,
      // --- ORIGINAL BACKUP ---
      // BRANCH_CATCHMENT_RADIUS_METERS
      paddedCatchmentRadiusMeters,
      effectiveLevelKm
    ]
  );

  return {
    assignmentLevelMeters: effectiveLevelMeters,
    removedRows: Number(pruneResult.rows[0]?.removed_rows || 0),
    remainingRows: Number(pruneResult.rows[0]?.remaining_rows || 0)
  };
};

const buildTier2MasterGridRow = (centerLat, centerLon, levelMeters, pocketConfig) => {
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLon)) {
    return null;
  }

  try {
    const nearestPocket = findNearestPocket(centerLat, centerLon, pocketConfig, {
      pocketLevelMeters: levelMeters
    });
    const pocketCode = String(nearestPocket?.pocketId || '').trim();
    if (!pocketCode) {
      return null;
    }

    const decodedPocket = decodePocketId(pocketCode, pocketConfig);
    const rowColIndex = computePocketRowColIndex(decodedPocket, levelMeters);
    if (!rowColIndex) {
      return null;
    }

    const corners = decodedPocket?.corners;
    if (
      !corners
      || !Number.isFinite(corners.sw?.lat)
      || !Number.isFinite(corners.sw?.lon)
      || !Number.isFinite(corners.se?.lat)
      || !Number.isFinite(corners.se?.lon)
      || !Number.isFinite(corners.ne?.lat)
      || !Number.isFinite(corners.ne?.lon)
      || !Number.isFinite(corners.nw?.lat)
      || !Number.isFinite(corners.nw?.lon)
    ) {
      return null;
    }

    return {
      code: pocketCode,
      level_m: Number(levelMeters),
      row_idx: Number(rowColIndex.rowIndex),
      col_idx: Number(rowColIndex.colIndex),
      label_lat: Number(decodedPocket.centerLat),
      label_lon: Number(decodedPocket.centerLon),
      corners: {
        sw: { lat: Number(corners.sw.lat), lon: Number(corners.sw.lon) },
        se: { lat: Number(corners.se.lat), lon: Number(corners.se.lon) },
        nw: { lat: Number(corners.nw.lat), lon: Number(corners.nw.lon) },
        ne: { lat: Number(corners.ne.lat), lon: Number(corners.ne.lon) }
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [Number(corners.sw.lon), Number(corners.sw.lat)],
          [Number(corners.se.lon), Number(corners.se.lat)],
          [Number(corners.ne.lon), Number(corners.ne.lat)],
          [Number(corners.nw.lon), Number(corners.nw.lat)],
          [Number(corners.sw.lon), Number(corners.sw.lat)]
        ]]
      }
    };
  } catch {
    return null;
  }
};

const normalizeTier2GenerationOptions = (rawOptions = {}) => {
  const requestedLevels = Array.isArray(rawOptions?.levels)
    ? rawOptions.levels
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => Math.round(value))
    : [];
  const normalizedLevels = Array.from(
    new Set(
      requestedLevels.filter((levelMeters) => TIER2_GRID_LEVELS_METERS.includes(levelMeters))
    )
  );

  const requestedBranchIds = Array.isArray(rawOptions?.branchIds)
    ? Array.from(
      new Set(
        rawOptions.branchIds
          .map((value) => String(value || '').trim())
          .filter(Boolean)
      )
    )
    : [];

  // --- ORIGINAL BACKUP ---
  // return {
  //   levels: normalizedLevels.length > 0
  //     ? normalizedLevels
  //     : [...TIER2_GRID_LEVELS_METERS],
  //   branchIds: requestedBranchIds.length > 0
  //     ? requestedBranchIds
  //     : null
  // };
  return {
    levels: normalizedLevels.length > 0
      ? normalizedLevels
      : [...TIER2_GRID_LEVELS_METERS],
    branchIds: requestedBranchIds.length > 0
      ? requestedBranchIds
      : null,
    force: parseBooleanFlag(rawOptions?.force, false)
  };
};

// --- ORIGINAL BACKUP ---
// const ensureTier2MasterTilesAroundBranches = async (client, pocketConfig) => {
//   const sanitizedPocketConfig = sanitizePocketConfig(pocketConfig);
//   const configVersion = Number.isFinite(Number(pocketConfig?.configVersion))
//     ? Math.round(Number(pocketConfig.configVersion))
//     : 1;
//   const levelStats = [];
//
//   for (const levelMeters of TIER2_GRID_LEVELS_METERS) {
//     const candidateCellsResult = await client.query(
//       `
//         WITH active_branches AS (
//           SELECT
//             branches.id::text AS branch_id,
//             COALESCE(
//               branches.geom::geometry,
//               ST_SetSRID(ST_MakePoint(branches.lon, branches.lat), 4326)
//             ) AS branch_geom
//           FROM branches
//         ),
//         catchments AS (
//           SELECT
//             ST_Buffer(active_branches.branch_geom::geography, $2::double precision)::geometry AS geom
//           FROM active_branches
//         ),
//         catchment_union AS (
//           SELECT ST_Union(catchments.geom) AS geom
//           FROM catchments
//         ),
//         generated_cells AS (
//           SELECT
//             ST_Transform(grid.geom, 4326)::geometry(POLYGON, 4326) AS geom
//           FROM catchment_union
//           JOIN LATERAL ST_SquareGrid(
//             $1::double precision,
//             ST_Transform(catchment_union.geom, 3857)
//           ) AS grid
//             ON catchment_union.geom IS NOT NULL
//         ),
//         filtered_cells AS (
//           SELECT DISTINCT generated_cells.geom
//           FROM generated_cells
//           WHERE generated_cells.geom IS NOT NULL
//             AND EXISTS (
//               SELECT 1
//               FROM catchments
//               WHERE generated_cells.geom && catchments.geom
//                 AND ST_Intersects(generated_cells.geom, catchments.geom)
//             )
//         )
//         SELECT
//           ST_Y(ST_PointOnSurface(filtered_cells.geom))::double precision AS center_lat,
//           ST_X(ST_PointOnSurface(filtered_cells.geom))::double precision AS center_lon
//         FROM filtered_cells
//       `,
//       [Number(levelMeters), Number(TIER2_BRANCH_GENERATION_RADIUS_METERS)]
//     );
// ...
// };
const ensureTier2MasterTilesAroundBranches = async (client, pocketConfig, options = {}) => {
  const sanitizedPocketConfig = sanitizePocketConfig(pocketConfig);
  const configVersion = Number.isFinite(Number(pocketConfig?.configVersion))
    ? Math.round(Number(pocketConfig.configVersion))
    : 1;
  const generationOptions = normalizeTier2GenerationOptions(options);
  const scopedBranchIds = Array.isArray(generationOptions.branchIds)
    ? generationOptions.branchIds
    : null;
  const levelStats = [];

  for (const levelMeters of generationOptions.levels) {
    const candidateCellsResult = await client.query(
      `
        WITH scoped_branches AS (
          SELECT
            branches.id::text AS branch_id,
            COALESCE(
              branches.geom::geometry,
              ST_SetSRID(ST_MakePoint(branches.lon, branches.lat), 4326)
            ) AS branch_geom
          FROM branches
          WHERE $3::text[] IS NULL
             OR branches.id::text = ANY($3::text[])
        ),
        branches_needing_generation AS (
          SELECT
            scoped_branches.branch_id,
            scoped_branches.branch_geom
          FROM scoped_branches
          -- --- ORIGINAL BACKUP ---
          -- WHERE NOT EXISTS (
          --   SELECT 1
          --   FROM grid_cells existing
          --   WHERE existing.level_m = $1::integer
          --     AND existing.geom IS NOT NULL
          --     AND NOT ST_IsEmpty(existing.geom)
          --     AND ST_DWithin(
          --       existing.geom::geography,
          --       scoped_branches.branch_geom::geography,
          --       $2::double precision
          --     )
          -- )
          WHERE $4::boolean = TRUE
             OR NOT EXISTS (
            SELECT 1
            FROM grid_cells existing
            WHERE existing.level_m = $1::integer
              AND existing.geom IS NOT NULL
              AND NOT ST_IsEmpty(existing.geom)
              AND ST_DWithin(
                existing.geom::geography,
                scoped_branches.branch_geom::geography,
                $2::double precision
              )
          )
        ),
        catchments AS (
          SELECT
            ST_Buffer(branches_needing_generation.branch_geom::geography, $2::double precision)::geometry AS geom
          FROM branches_needing_generation
        ),
        catchment_union AS (
          SELECT ST_Union(catchments.geom) AS geom
          FROM catchments
        ),
        generated_cells AS (
          SELECT
            ST_Transform(grid.geom, 4326)::geometry(POLYGON, 4326) AS geom
          FROM catchment_union
          JOIN LATERAL ST_SquareGrid(
            $1::double precision,
            ST_Transform(catchment_union.geom, 3857)
          ) AS grid
            ON catchment_union.geom IS NOT NULL
        ),
        filtered_cells AS (
          SELECT DISTINCT generated_cells.geom
          FROM generated_cells
          WHERE generated_cells.geom IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM catchments
              WHERE generated_cells.geom && catchments.geom
                AND ST_Intersects(generated_cells.geom, catchments.geom)
            )
        )
        SELECT
          ST_Y(ST_PointOnSurface(filtered_cells.geom))::double precision AS center_lat,
          ST_X(ST_PointOnSurface(filtered_cells.geom))::double precision AS center_lon
        FROM filtered_cells
      `,
      [
        Number(levelMeters),
        Number(TIER2_BRANCH_GENERATION_RADIUS_METERS),
        scopedBranchIds,
        Boolean(generationOptions.force)
      ]
    );

    const byCode = new Map();
    (candidateCellsResult.rows || []).forEach((row) => {
      const centerLat = Number(row.center_lat);
      const centerLon = Number(row.center_lon);
      const generatedRow = buildTier2MasterGridRow(
        centerLat,
        centerLon,
        Number(levelMeters),
        sanitizedPocketConfig
      );
      if (!generatedRow || !generatedRow.code) {
        return;
      }
      byCode.set(generatedRow.code, generatedRow);
    });

    const generatedRows = Array.from(byCode.values());
    if (generatedRows.length === 0) {
      levelStats.push({
        levelMeters: Number(levelMeters),
        candidateCenters: Number(candidateCellsResult.rows?.length || 0),
        generatedRows: 0,
        upsertedRows: 0
      });
      continue;
    }

    const upsertResult = await client.query(
      `
        INSERT INTO grid_cells (
          config_version,
          level_m,
          row_idx,
          col_idx,
          code,
          label_lat,
          label_lon,
          corners,
          geom,
          label_geom,
          min_lng,
          min_lat,
          max_lng,
          max_lat
        )
        SELECT
          $1::integer AS config_version,
          prepared.level_m::integer,
          prepared.row_idx::integer,
          prepared.col_idx::integer,
          prepared.code::varchar(20),
          prepared.label_lat::double precision,
          prepared.label_lon::double precision,
          prepared.corners::jsonb,
          prepared.geom::geometry(POLYGON, 4326),
          ST_SetSRID(
            ST_MakePoint(prepared.label_lon::double precision, prepared.label_lat::double precision),
            4326
          )::geometry(POINT, 4326) AS label_geom,
          ST_XMin(prepared.geom)::double precision AS min_lng,
          ST_YMin(prepared.geom)::double precision AS min_lat,
          ST_XMax(prepared.geom)::double precision AS max_lng,
          ST_YMax(prepared.geom)::double precision AS max_lat
        FROM (
          SELECT
            generated.code,
            generated.level_m,
            generated.row_idx,
            generated.col_idx,
            generated.label_lat,
            generated.label_lon,
            generated.corners,
            ST_GeometryN(
              ST_Multi(
                ST_CollectionExtract(
                  ST_MakeValid(
                    ST_SetSRID(
                      ST_GeomFromGeoJSON(generated.geometry::text),
                      4326
                    )
                  ),
                  3
                )
              ),
              1
            )::geometry(POLYGON, 4326) AS geom
          FROM jsonb_to_recordset($2::jsonb) AS generated(
            code text,
            level_m integer,
            row_idx integer,
            col_idx integer,
            label_lat double precision,
            label_lon double precision,
            corners jsonb,
            geometry jsonb
          )
        ) prepared
        ON CONFLICT (code)
        DO UPDATE SET
          config_version = EXCLUDED.config_version,
          level_m = EXCLUDED.level_m,
          row_idx = EXCLUDED.row_idx,
          col_idx = EXCLUDED.col_idx,
          label_lat = EXCLUDED.label_lat,
          label_lon = EXCLUDED.label_lon,
          corners = EXCLUDED.corners,
          geom = EXCLUDED.geom,
          label_geom = EXCLUDED.label_geom,
          min_lng = EXCLUDED.min_lng,
          min_lat = EXCLUDED.min_lat,
          max_lng = EXCLUDED.max_lng,
          max_lat = EXCLUDED.max_lat
      `,
      [configVersion, JSON.stringify(generatedRows)]
    );

    levelStats.push({
      levelMeters: Number(levelMeters),
      candidateCenters: Number(candidateCellsResult.rows?.length || 0),
      generatedRows: generatedRows.length,
      upsertedRows: Number(upsertResult.rowCount || 0)
    });
  }

  return {
    radiusMeters: Number(TIER2_BRANCH_GENERATION_RADIUS_METERS),
    scopedBranchCount: Array.isArray(scopedBranchIds) ? scopedBranchIds.length : null,
    levels: levelStats
  };
};

const runTwoWayAllocationSync = async (client, branchId, levelMeters, latestJobId) => {
  const effectiveLevelMeters = Number.isFinite(Number(levelMeters)) && Number(levelMeters) > 0
    ? Math.round(Number(levelMeters))
    : DEFAULT_PERSISTENT_TERRITORY_LEVEL_METERS;

  const clearedGridCellsResult = await client.query(
    `
      UPDATE grid_cells gc
      SET
        allocated_employee_id = NULL,
        allocated_since = NULL
      FROM ${BRANCH_TERRITORY_TABLE} bt
      WHERE bt.branch_id = $1
        AND bt.level_m = $2::integer
        AND bt.grid_code ~ $3::text
        AND gc.code = bt.grid_code
        AND gc.level_m = bt.level_m
    `,
    [branchId, effectiveLevelMeters, CANONICAL_POCKET_CODE_SQL_PATTERN]
  );

  const allocatedGridCellsResult = await client.query(
    `
      UPDATE grid_cells gc
      SET
        allocated_employee_id = et.branch_employee_id,
        allocated_since = CURRENT_TIMESTAMP
      FROM ${BRANCH_TERRITORY_TABLE} bt
      JOIN ${EMPLOYEE_TERRITORY_TABLE} et
        ON et.branch_id = bt.branch_id
       AND et.grid_code = bt.grid_code
      WHERE bt.branch_id = $1
        AND bt.level_m = $2::integer
        AND bt.grid_code ~ $3::text
        AND et.branch_employee_id IS NOT NULL
        AND gc.code = bt.grid_code
        AND gc.level_m = bt.level_m
    `,
    [branchId, effectiveLevelMeters, CANONICAL_POCKET_CODE_SQL_PATTERN]
  );

  const syncedEmployeePocketsResult = await client.query(
    `
      WITH employee_allocations AS (
        SELECT
          be.id::int AS branch_employee_id,
          COALESCE(
            jsonb_agg(et.grid_code::text ORDER BY et.grid_code::text)
              FILTER (WHERE bt.grid_code IS NOT NULL),
            '[]'::jsonb
          ) AS allocated_pockets
        FROM branch_employees be
        LEFT JOIN ${EMPLOYEE_TERRITORY_TABLE} et
          ON et.branch_employee_id = be.id
         AND et.branch_id = be.branch_id
        LEFT JOIN ${BRANCH_TERRITORY_TABLE} bt
          ON bt.branch_id = et.branch_id
         AND bt.grid_code = et.grid_code
         AND bt.level_m = $2::integer
         AND bt.grid_code ~ $3::text
        WHERE be.branch_id = $1
        GROUP BY be.id
      )
      UPDATE branch_employees be
      SET
        allocated_pockets = employee_allocations.allocated_pockets,
        updated_at = CURRENT_TIMESTAMP
      FROM employee_allocations
      WHERE be.id = employee_allocations.branch_employee_id
      RETURNING be.id
    `,
    [branchId, effectiveLevelMeters, CANONICAL_POCKET_CODE_SQL_PATTERN]
  );

  await client.query(
    `
      UPDATE branch_employees
      SET
        allocated_customer_count = 0,
        updated_at = CURRENT_TIMESTAMP
      WHERE branch_id = $1
    `,
    [branchId]
  );

  let syncedCustomerCounts = 0;
  if (latestJobId) {
    const syncedCustomerCountsResult = await client.query(
      `
        WITH employee_pockets AS (
          SELECT
            be.id::int AS branch_employee_id,
            gc.min_lat,
            gc.max_lat,
            gc.min_lng,
            gc.max_lng
          FROM branch_employees be
          JOIN ${EMPLOYEE_TERRITORY_TABLE} et
            ON et.branch_employee_id = be.id
           AND et.branch_id = be.branch_id
          JOIN ${BRANCH_TERRITORY_TABLE} bt
            ON bt.branch_id = et.branch_id
           AND bt.grid_code = et.grid_code
           AND bt.level_m = $2::integer
           AND bt.grid_code ~ $4::text
          JOIN grid_cells gc
            ON gc.code = bt.grid_code
           AND gc.level_m = bt.level_m
          WHERE be.branch_id = $1
            AND gc.min_lat IS NOT NULL
            AND gc.max_lat IS NOT NULL
            AND gc.min_lng IS NOT NULL
            AND gc.max_lng IS NOT NULL
        ),
        customer_counts AS (
          SELECT
            employee_pockets.branch_employee_id,
            COUNT(*)::int AS allocated_customer_count
          FROM employee_pockets
          JOIN customer_pocket_mappings cpm
            ON cpm.job_id = $3
           AND cpm.nearest_branch_id = $1
           AND cpm.customer_lat BETWEEN employee_pockets.min_lat AND employee_pockets.max_lat
           AND cpm.customer_lon BETWEEN employee_pockets.min_lng AND employee_pockets.max_lng
          GROUP BY employee_pockets.branch_employee_id
        )
        UPDATE branch_employees be
        SET
          allocated_customer_count = customer_counts.allocated_customer_count,
          updated_at = CURRENT_TIMESTAMP
        FROM customer_counts
        WHERE be.id = customer_counts.branch_employee_id
          AND be.branch_id = $1
        RETURNING be.id
      `,
      [branchId, effectiveLevelMeters, latestJobId, CANONICAL_POCKET_CODE_SQL_PATTERN]
    );

    syncedCustomerCounts = Number(syncedCustomerCountsResult.rowCount || 0);
  }

  return {
    assignmentLevelMeters: effectiveLevelMeters,
    clearedGridCells: Number(clearedGridCellsResult.rowCount || 0),
    allocatedGridCells: Number(allocatedGridCellsResult.rowCount || 0),
    syncedEmployeePockets: Number(syncedEmployeePocketsResult.rowCount || 0),
    syncedCustomerCounts
  };
};

const assessPersistedBranchTerritoryHealth = async (
  dbClient,
  branchId,
  levelMeters
) => {
  const dbQuery = typeof dbClient === 'function'
    ? dbClient
    : (dbClient && typeof dbClient.query === 'function' ? dbClient.query.bind(dbClient) : null);
  if (!dbQuery) {
    throw new AppError(
      'Database query client is unavailable for persisted territory validation.',
      500,
      'DB_CLIENT_UNAVAILABLE'
    );
  }

  const effectiveLevelMeters = Number.isFinite(Number(levelMeters)) && Number(levelMeters) > 0
    ? Math.round(Number(levelMeters))
    : null;
  const validationResult = await dbQuery(
    `
      WITH branch_info AS (
        SELECT
          COALESCE(
            branches.geom::geometry,
            ST_SetSRID(ST_MakePoint(branches.lon, branches.lat), 4326)
          ) AS branch_geom
        FROM branches
        WHERE branches.id = $1
      )
      SELECT
        COUNT(*)::int AS total_pockets,
        COUNT(*) FILTER (
          WHERE ST_DWithin(
            gc.geom::geography,
            branch_info.branch_geom::geography,
            $3::double precision
          )
        )::int AS pockets_within_radius
      FROM ${BRANCH_TERRITORY_TABLE} bt
      JOIN grid_cells gc
        ON gc.code = bt.grid_code
       AND gc.level_m = bt.level_m
      CROSS JOIN branch_info
      WHERE bt.branch_id = $1
        AND ($2::integer IS NULL OR bt.level_m = $2::integer)
        AND bt.grid_code ~ $4::text
        AND gc.geom IS NOT NULL
        AND NOT ST_IsEmpty(gc.geom)
    `,
    [
      branchId,
      effectiveLevelMeters,
      Number(PERSISTENT_TERRITORY_VALIDATION_RADIUS_METERS),
      CANONICAL_POCKET_CODE_SQL_PATTERN
    ]
  );

  return {
    totalPockets: Number(validationResult.rows[0]?.total_pockets || 0),
    pocketsWithinRadius: Number(validationResult.rows[0]?.pockets_within_radius || 0),
    validationRadiusMeters: Number(PERSISTENT_TERRITORY_VALIDATION_RADIUS_METERS)
  };
};

const buildEmptyFeatureCollection = () => ({
  type: 'FeatureCollection',
  features: []
});

const fetchPersistentBranchTerritoryPayload = async (
  dbClient,
  branchId,
  levelMeters = null
) => {
  const dbQuery = typeof dbClient === 'function'
    ? dbClient
    : (dbClient && typeof dbClient.query === 'function' ? dbClient.query.bind(dbClient) : null);
  if (!dbQuery) {
    throw new AppError(
      'Database query client is unavailable for persistent branch territory payload.',
      500,
      'DB_CLIENT_UNAVAILABLE'
    );
  }

  // --- ORIGINAL BACKUP ---
  // const persistentResult = await dbClient.query(
  const persistentResult = await dbQuery(
    `
      WITH latest_mapping_job AS (
        SELECT cpm.job_id
        FROM customer_pocket_mappings cpm
        JOIN jobs j
          ON j.job_id = cpm.job_id
        ORDER BY j.completed_at DESC NULLS LAST, cpm.created_at DESC
        LIMIT 1
      ),
      branch_employee_map AS (
        SELECT
          be.id::int AS branch_employee_id,
          be.employee_id::text AS employee_code,
          COALESCE(
            NULLIF(btrim(be.name), ''),
            NULLIF(btrim(be.employee_name), ''),
            NULLIF(btrim(be.employee_id), ''),
            'Employee ' || be.id::text
          )::text AS employee_name,
          CASE
            WHEN be.color_code ~ '^#[0-9A-Fa-f]{6}$' THEN upper(be.color_code)
            ELSE $2::text
          END AS color
        FROM branch_employees be
        WHERE be.branch_id = $1
      ),
      pocket_customer_breakdown AS (
        SELECT
          cpm.pocket_id::text AS pocket_id,
          COUNT(*)::int AS customer_count,
          COUNT(*) FILTER (
            WHERE cpm.nearest_branch_id = $1
          )::int AS selected_branch_customer_count,
          COUNT(*) FILTER (
            WHERE cpm.nearest_branch_id IS DISTINCT FROM $1
          )::int AS other_branch_customer_count
        FROM customer_pocket_mappings cpm
        WHERE cpm.pocket_id IS NOT NULL
          AND btrim(cpm.pocket_id) <> ''
          AND (
            (SELECT job_id FROM latest_mapping_job) IS NULL
            OR cpm.job_id = (SELECT job_id FROM latest_mapping_job)
          )
        GROUP BY cpm.pocket_id
      ),
      base_rows AS (
        SELECT
          bt.branch_id,
          bt.grid_code::text AS pocket_id,
          bt.level_m::int AS level_m,
          COALESCE(
            employee_by_id.branch_employee_id::text,
            employee_by_code.branch_employee_id::text,
            NULLIF(et.employee_id::text, '')
          ) AS employee_id,
          COALESCE(
            employee_by_id.employee_name,
            employee_by_code.employee_name,
            NULL
          ) AS employee_name,
          COALESCE(
            employee_by_id.color,
            employee_by_code.color,
            $2::text
          ) AS color,
          COALESCE(egc_snapshot.grid_cell_id, bt.grid_code::text) AS grid_cell_id,
          COALESCE(egc_snapshot.account_count, 0)::int AS account_count,
          COALESCE(
            pocket_customer_breakdown.customer_count,
            GREATEST(COALESCE(egc_snapshot.account_count, 0), 0)
          )::int AS customer_count,
          COALESCE(
            pocket_customer_breakdown.selected_branch_customer_count,
            GREATEST(COALESCE(egc_snapshot.account_count, 0), 0)
          )::int AS selected_branch_customer_count,
          COALESCE(
            pocket_customer_breakdown.other_branch_customer_count,
            0
          )::int AS other_branch_customer_count,
          ST_Multi(
            ST_CollectionExtract(
              ST_MakeValid(gc.geom),
              3
            )
          )::geometry(MULTIPOLYGON, 4326) AS geom
        FROM ${BRANCH_TERRITORY_TABLE} bt
        JOIN grid_cells gc
          ON gc.code = bt.grid_code
         AND gc.level_m = bt.level_m
        LEFT JOIN ${EMPLOYEE_TERRITORY_TABLE} et
          ON et.branch_id = bt.branch_id
         AND et.grid_code = bt.grid_code
        LEFT JOIN branch_employee_map employee_by_id
          ON employee_by_id.branch_employee_id = et.branch_employee_id
        LEFT JOIN branch_employee_map employee_by_code
          ON et.branch_employee_id IS NULL
         AND et.employee_id IS NOT NULL
         AND employee_by_code.employee_code = et.employee_id::text
        LEFT JOIN pocket_customer_breakdown
          ON pocket_customer_breakdown.pocket_id = bt.grid_code::text
        LEFT JOIN LATERAL (
          SELECT
            egc.id::text AS grid_cell_id,
            GREATEST(COALESCE(egc.account_count, 0), 0)::int AS account_count
          FROM ${EMPLOYEE_GRID_CELL_TABLE} egc
          WHERE egc.branch_id = bt.branch_id
            AND egc.pocket_id = bt.grid_code
            AND COALESCE(egc.level_km, 1) = GREATEST(1, bt.level_m / 1000)
          ORDER BY egc.updated_at DESC NULLS LAST, egc.id DESC
          LIMIT 1
        ) egc_snapshot
          ON TRUE
        WHERE bt.branch_id = $1
          AND ($3::integer IS NULL OR bt.level_m = $3::integer)
          AND bt.grid_code ~ $4::text
          AND gc.geom IS NOT NULL
          AND NOT ST_IsEmpty(gc.geom)
      ),
      pockets_fc AS (
        SELECT
          jsonb_build_object(
            'type', 'FeatureCollection',
            'features', COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'type', 'Feature',
                  'properties', jsonb_build_object(
                    'branch_id', base_rows.branch_id,
                    'grid_cell_id', base_rows.grid_cell_id,
                    'pocket_id', base_rows.pocket_id,
                    'employee_id', base_rows.employee_id,
                    'employee_name', base_rows.employee_name,
                    'account_count', base_rows.account_count,
                    'customer_count', base_rows.customer_count,
                    'selected_branch_customer_count', base_rows.selected_branch_customer_count,
                    'other_branch_customer_count', base_rows.other_branch_customer_count,
                    'level_m', base_rows.level_m,
                    'color', base_rows.color
                  ),
                  'geometry', ST_AsGeoJSON(base_rows.geom)::jsonb
                )
                ORDER BY base_rows.employee_id NULLS LAST, base_rows.pocket_id
              ),
              '[]'::jsonb
            )
          ) AS geojson
        FROM base_rows
      ),
      territory_groups AS (
        SELECT
          base_rows.employee_id,
          MIN(base_rows.employee_name)::text AS employee_name,
          MIN(base_rows.color)::text AS color,
          COUNT(*)::int AS pocket_count,
          COALESCE(SUM(base_rows.account_count), 0)::int AS total_accounts,
          ST_Multi(
            ST_CollectionExtract(
              ST_MakeValid(
                ST_Union(base_rows.geom)
              ),
              3
            )
          )::geometry(MULTIPOLYGON, 4326) AS geom
        FROM base_rows
        GROUP BY base_rows.employee_id
      ),
      territories_fc AS (
        SELECT
          jsonb_build_object(
            'type', 'FeatureCollection',
            'features', COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'type', 'Feature',
                  'properties', jsonb_build_object(
                    'employee_id', territory_groups.employee_id,
                    'employee_name', territory_groups.employee_name,
                    'pocket_count', territory_groups.pocket_count,
                    'total_accounts', territory_groups.total_accounts,
                    'color', territory_groups.color
                  ),
                  'geometry', ST_AsGeoJSON(territory_groups.geom)::jsonb
                )
                ORDER BY territory_groups.employee_id NULLS LAST
              ),
              '[]'::jsonb
            )
          ) AS geojson
        FROM territory_groups
      ),
      summary AS (
        SELECT
          COUNT(*)::int AS total_pockets,
          COUNT(DISTINCT base_rows.employee_id)::int AS assigned_employees,
          COALESCE(SUM(base_rows.account_count), 0)::int AS total_accounts,
          COALESCE(MIN(base_rows.level_m), 0)::int AS assignment_level_meters
        FROM base_rows
      )
      SELECT
        pockets_fc.geojson AS pockets,
        territories_fc.geojson AS territories,
        summary.total_pockets,
        summary.assigned_employees,
        summary.total_accounts,
        summary.assignment_level_meters
      FROM pockets_fc
      CROSS JOIN territories_fc
      CROSS JOIN summary
    `,
    [
      branchId,
      UNASSIGNED_TERRITORY_COLOR,
      Number.isFinite(Number(levelMeters)) ? Math.round(Number(levelMeters)) : null,
      CANONICAL_POCKET_CODE_SQL_PATTERN
    ]
  );

  const payload = persistentResult.rows[0] || {
    pockets: buildEmptyFeatureCollection(),
    territories: buildEmptyFeatureCollection(),
    total_pockets: 0,
    assigned_employees: 0,
    total_accounts: 0,
    assignment_level_meters: 0
  };

  return {
    pockets: payload.pockets || buildEmptyFeatureCollection(),
    territories: payload.territories || buildEmptyFeatureCollection(),
    summary: {
      totalPockets: Number(payload.total_pockets || 0),
      assignedEmployees: Number(payload.assigned_employees || 0),
      totalAccounts: Number(payload.total_accounts || 0),
      mergedTerritories: Number(
        Array.isArray(payload.territories?.features)
          ? payload.territories.features.length
          : 0
      )
    },
    assignmentLevelMeters: Number(payload.assignment_level_meters || 0)
  };
};

const buildTerritoryFeatureCollection = (rows, customerCountByBranchId) => ({
  type: 'FeatureCollection',
  features: rows.map((row) => ({
    type: 'Feature',
    properties: {
      branchId: row.branch_id,
      city: row.city,
      customerCount: Number(customerCountByBranchId.get(row.branch_id) || 0)
    },
    geometry: row.geometry
  }))
});

const buildCustomerCoverageByBranch = async (customerAssignments) => {
  if (!Array.isArray(customerAssignments) || customerAssignments.length === 0) {
    return [];
  }

  const sanitizedAssignments = customerAssignments
    .filter((entry) =>
      entry &&
      typeof entry.branchId === 'string' &&
      entry.branchId.trim() !== '' &&
      Number.isFinite(entry.customerLat) &&
      Number.isFinite(entry.customerLon)
    )
    .map((entry) => ({
      branch_id: entry.branchId,
      lat: entry.customerLat,
      lon: entry.customerLon
    }));

  if (sanitizedAssignments.length === 0) {
    return [];
  }

  const coverageResult = await query(
    `
      WITH assignment_points AS (
        SELECT
          data.branch_id::text AS branch_id,
          ST_SetSRID(ST_MakePoint(data.lon::double precision, data.lat::double precision), 4326) AS geom
        FROM jsonb_to_recordset($1::jsonb) AS data(branch_id text, lat double precision, lon double precision)
      ),
      grouped AS (
        SELECT
          branch_id,
          COUNT(*)::int AS point_count,
          ST_Collect(geom) AS point_collection
        FROM assignment_points
        GROUP BY branch_id
      ),
      coverage AS (
        SELECT
          branch_id,
          CASE
            WHEN point_count <= 2 THEN ST_Buffer(ST_ConvexHull(point_collection)::geography, 1000)::geometry
            ELSE ST_ConvexHull(point_collection)
          END AS geom
        FROM grouped
      )
      SELECT
        branch_id,
        ST_AsGeoJSON(ST_CollectionExtract(ST_MakeValid(geom), 3))::json AS geometry
      FROM coverage
      WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)
    `,
    [JSON.stringify(sanitizedAssignments)]
  );

  return coverageResult.rows
    .filter((row) => row.geometry)
    .map((row) => ({
      branchId: row.branch_id,
      geometry: row.geometry
    }));
};

const buildVoronoiTerritoriesForSelectedBranches = async (
  selectedBranches,
  indiaStateBoundsGeoJson,
  coverageGeometriesByBranch = []
) => {
  if (selectedBranches.length === 0) {
    return [];
  }

  const stateGeoJsonParam = JSON.stringify(indiaStateBoundsGeoJson);
  const coverageMap = new Map(
    coverageGeometriesByBranch
      .filter((coverageEntry) => coverageEntry && coverageEntry.branchId && coverageEntry.geometry)
      .map((coverageEntry) => [coverageEntry.branchId, coverageEntry.geometry])
  );

  if (selectedBranches.length === 1) {
    const selectedBranch = selectedBranches[0];
    const branchCoverage = coverageMap.get(selectedBranch.id);

    if (branchCoverage) {
      // Fast path for single-branch view: coverage geometry is already branch-scoped.
      return [
        {
          branch_id: selectedBranch.id,
          city: selectedBranch.city,
          geometry: branchCoverage
        }
      ];
    }
    return [];
  }

  const coverageParam = JSON.stringify(
    coverageGeometriesByBranch
      .filter((coverageEntry) => coverageEntry && coverageEntry.branchId && coverageEntry.geometry)
      .map((coverageEntry) => ({
        branch_id: coverageEntry.branchId,
        geometry: coverageEntry.geometry
      }))
  );

  const territoryResult = await query(
    `
      WITH selected_branches AS (
        SELECT
          branch.id::text AS id,
          branch.city::text AS city,
          branch.lat::double precision AS lat,
          branch.lon::double precision AS lon,
          ST_SetSRID(ST_MakePoint(branch.lon::double precision, branch.lat::double precision), 4326) AS geom
        FROM jsonb_to_recordset($1::jsonb) AS branch(id text, city text, lat double precision, lon double precision)
      ),
      state_polygons AS (
        SELECT ST_SetSRID(ST_MakeValid(ST_GeomFromGeoJSON((feature->'geometry')::text)), 4326) AS geom
        FROM jsonb_array_elements(($2::jsonb)->'features') AS feature
      ),
      clip_envelope AS (
        SELECT ST_Expand(ST_Extent(geom)::geometry, 0.5) AS env
        FROM state_polygons
      ),
      voronoi_cells AS (
        SELECT (
          ST_Dump(
            ST_VoronoiPolygons(
              (SELECT ST_Collect(geom) FROM selected_branches),
              0,
              (SELECT env FROM clip_envelope)
            )
          )
        ).geom AS geom
      ),
      raw_territories AS (
        SELECT
          nearest_branch.id AS branch_id,
          nearest_branch.city AS city,
          voronoi_cells.geom AS geom
        FROM voronoi_cells
        JOIN LATERAL (
          SELECT id, city, geom
          FROM selected_branches
          ORDER BY voronoi_cells.geom <-> geom
          LIMIT 1
        ) AS nearest_branch ON TRUE
      ),
      clipped_fragments AS (
        SELECT
          raw_territories.branch_id,
          raw_territories.city,
          (ST_Dump(ST_Intersection(raw_territories.geom, state_polygons.geom))).geom AS geom
        FROM raw_territories
        JOIN state_polygons ON ST_Intersects(raw_territories.geom, state_polygons.geom)
      ),
      merged_territories AS (
        SELECT
          branch_id,
          city,
          ST_CollectionExtract(ST_Collect(geom), 3) AS geom
        FROM clipped_fragments
        GROUP BY branch_id, city
      ),
      branch_coverage AS (
        SELECT
          coverage.branch_id::text AS branch_id,
          ST_SetSRID(ST_MakeValid(ST_GeomFromGeoJSON(coverage.geometry::text)), 4326) AS geom
        FROM jsonb_to_recordset($3::jsonb) AS coverage(branch_id text, geometry jsonb)
      ),
      final_territories AS (
        SELECT
          merged_territories.branch_id,
          merged_territories.city,
          branch_coverage.geom AS geom
        FROM merged_territories
        JOIN branch_coverage
          ON branch_coverage.branch_id = merged_territories.branch_id
      )
      SELECT
        branch_id,
        city,
        ST_AsGeoJSON(ST_CollectionExtract(ST_MakeValid(geom), 3))::json AS geometry
      FROM final_territories
      WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)
      ORDER BY branch_id
    `,
    [JSON.stringify(selectedBranches), stateGeoJsonParam, coverageParam]
  );

  return territoryResult.rows;
};

// Process jobs (Node.js worker for small files)
batchQueue.process(async (job) => {
  const { jobId, data, config, fileName, filePath, replaceExisting = false } = job.data;
  let rows = data;

  if (!rows) {
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error('Uploaded file not found for processing');
    }

    // Parse Excel inside the background worker so upload endpoint can return immediately.
    const workbook = xlsx.read(fs.readFileSync(filePath), { type: 'buffer' });
    rows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

    if (rows.length === 0) {
      throw new Error('Excel file is empty');
    }

    await query('UPDATE jobs SET total = $1 WHERE job_id = $2', [rows.length, jobId]);
  }

  logger.info('Processing batch job (Node.js worker)', { jobId, rows: rows.length });

  const results = [];
  const errors = [];
  const pocketStats = {}; // Track count per pocket
  const mappings = []; // Collect mappings for persistence
  const pocketCenters = new Map(); // Cache pocket centers to avoid recalculation
  const branchLookupForExisting = new Map();
  const branchRows = [];
  // --- ORIGINAL BACKUP ---
  // [IST 2026-03-09] fallback metric had been disabled with the pocket logic.
  // let fallbackPocketConfigHits = 0;
  let fallbackPocketConfigHits = 0;
  let branchPocketFallbackHits = 0;
  const branchPocketCatalog = [];

  try {
    const branchesForExistingResult = await query('SELECT id, lat, lon FROM branches');
    branchesForExistingResult.rows.forEach((row) => {
      const id = String(row.id);
      const payload = {
        id,
        lat: Number(row.lat),
        lon: Number(row.lon),
      };
      branchLookupForExisting.set(id, payload);
      branchLookupForExisting.set(id.toUpperCase(), payload);
      if (Number.isFinite(payload.lat) && Number.isFinite(payload.lon)) {
        branchRows.push(payload);
      }

      // Sequence guard: branch pocket references are resolved before processing customers.
      if (Number.isFinite(payload.lat) && Number.isFinite(payload.lon)) {
        try {
          const branchPocketAssignment = resolveNearestPocketAssignment(payload.lat, payload.lon, config);
          if (branchPocketAssignment.usedFallbackConfig) {
            branchPocketFallbackHits += 1;
          }
          const branchPocket = branchPocketAssignment.nearestPocket;
          branchPocketCatalog.push({
            branchId: id,
            branchLat: payload.lat,
            branchLon: payload.lon,
            pocketId: String(branchPocket.pocketId || '').trim(),
            pocketCenterLat: Number(branchPocket.centerLat),
            pocketCenterLon: Number(branchPocket.centerLon)
          });
        } catch (error) {
          logger.warn('Skipping branch from pre-mapped pocket catalog due to invalid pocket resolution', {
            branchId: id,
            error: error.message
          });
        }
      }
    });

    if (branchRows.length === 0) {
      throw new Error('No valid branch coordinates were found. Verify branch latitude and longitude values.');
    }

    if (branchPocketCatalog.length === 0) {
      logger.warn('Branch pocket catalog could not be precomputed; falling back to raw branch coordinates.', {
        jobId,
        branchCount: branchRows.length
      });
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      
      try {
        // Update progress
        job.progress(Math.floor((i / rows.length) * 100));

        const lat = toNumber(getFirstDefinedValue(row, [
          'canon_lat',
          'CANON_LAT',
          'Canon_Lat',
          'canonLat',
          'CanonLat',
          'Latitude',
          'latitude',
          'Lat',
          'lat'
        ]));
        const lon = toNumber(getFirstDefinedValue(row, [
          'canon_long',
          'CANON_LONG',
          'Canon_Long',
          'canonLong',
          'CanonLong',
          'Longitude',
          'longitude',
          'Lon',
          'lon'
        ]));

        // --- ORIGINAL BACKUP ---
        // if (!isValidGeoCoordinate(lat, lon)) {
        //   errors.push({ row: i + 2, error: 'Invalid coordinates (latitude must be -90..90 and longitude -180..180)' });
        //   results.push({ ...row, PocketID: 'ERROR', Distance: 'N/A' });
        //   continue;
        // }
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          errors.push({ row: i + 2, error: 'Invalid coordinates' });
          results.push({ ...row, PocketID: 'ERROR', Distance: 'N/A' });
          continue;
        }

        const branchCodeRaw = getFirstDefinedValue(row, [
          'branch_code',
          'BRANCH_CODE',
          'Branch_Code',
          'branchCode',
          'BranchCode',
          'Branch Code'
        ]);
        const branchCode = branchCodeRaw === undefined || branchCodeRaw === null
          ? null
          : String(branchCodeRaw).trim() || null;
        let existingBranchId = null;
        let distanceCustomerToExistingBranch = null;
        if (branchCode) {
          const matchedExistingBranch =
            branchLookupForExisting.get(branchCode) ||
            branchLookupForExisting.get(branchCode.toUpperCase());

          if (matchedExistingBranch) {
            existingBranchId = matchedExistingBranch.id;
            distanceCustomerToExistingBranch = haversineDistance(
              lat,
              lon,
              matchedExistingBranch.lat,
              matchedExistingBranch.lon
            );
          }
        }

        // --- ORIGINAL BACKUP ---
        // // Identify containing pocket at 5km level (no new pocket creation).
        // const pocketAssignment = resolveNearestPocketAssignment(lat, lon, config);
        // const nearestPocket = pocketAssignment.nearestPocket;
        // if (pocketAssignment.usedFallbackConfig) {
        //   fallbackPocketConfigHits += 1;
        // }
        // --- ORIGINAL BACKUP ---
        // [IST 2026-03-09] Disabled current pocket logic block:
        // 1) Pocket ID generation
        // 2) Pocket -> branch preparation metadata
        // 3) Pocket -> customer mapping collection
        // // Identify containing pocket at 5km level (no new pocket creation).
        // const nearestPocket = findNearestPocket(lat, lon, config, {
        //   pocketLevelMeters: TARGET_POCKET_LEVEL_METERS
        // });
        //
        // results.push({
        //   ...row,
        //   PocketID: nearestPocket.pocketId,
        //   'Distance to Pocket Center (m)': Math.round(nearestPocket.distance),
        //   'Pocket Center Lat': nearestPocket.centerLat.toFixed(6),
        //   'Pocket Center Lon': nearestPocket.centerLon.toFixed(6),
        // });
        //
        // // Count accounts per pocket
        // if (nearestPocket.pocketId !== 'ERROR') {
        //   pocketStats[nearestPocket.pocketId] = (pocketStats[nearestPocket.pocketId] || 0) + 1;
        //
        //   // Cache pocket center
        //   if (!pocketCenters.has(nearestPocket.pocketId)) {
        //     pocketCenters.set(nearestPocket.pocketId, {
        //       lat: nearestPocket.centerLat,
        //       lon: nearestPocket.centerLon,
        //     });
        //   }
        //
        //   // Extract customer ID from row (try common column names)
        //   const customerIdRaw = getFirstDefinedValue(row, [
        //     'lan',
        //     'LAN',
        //     'Lan',
        //     'CustomerID',
        //     'customer_id',
        //     'customerId',
        //     'ID',
        //     'id'
        //   ]);
        //   const normalizedCustomerId =
        //     customerIdRaw === undefined || customerIdRaw === null
        //       ? ''
        //       : String(customerIdRaw).trim();
        //   const customerId = normalizedCustomerId !== '' ? normalizedCustomerId : `CUST_${i + 1}`;
        //
        //   // Collect mapping data for persistence
        //   mappings.push({
        //     customerId,
        //     customerLat: lat,
        //     customerLon: lon,
        //     customerBranchCode: branchCode,
        //     existingBranchId,
        //     distanceCustomerToExistingBranch,
        //     pocketId: nearestPocket.pocketId,
        //     distanceCustomerToPocket: nearestPocket.distance,
        //     pocketCenterLat: nearestPocket.centerLat,
        //     pocketCenterLon: nearestPocket.centerLon,
        //   });
        // }

        const pocketAssignment = resolveNearestPocketAssignment(lat, lon, config);
        const nearestPocket = pocketAssignment.nearestPocket;
        if (pocketAssignment.usedFallbackConfig) {
          fallbackPocketConfigHits += 1;
        }

        results.push({
          ...row,
          PocketID: nearestPocket.pocketId,
          'Distance to Pocket Center (m)': Math.round(nearestPocket.distance),
          'Pocket Center Lat': nearestPocket.centerLat.toFixed(6),
          'Pocket Center Lon': nearestPocket.centerLon.toFixed(6),
        });

        if (nearestPocket.pocketId !== 'ERROR') {
          pocketStats[nearestPocket.pocketId] = (pocketStats[nearestPocket.pocketId] || 0) + 1;

          if (!pocketCenters.has(nearestPocket.pocketId)) {
            pocketCenters.set(nearestPocket.pocketId, {
              lat: nearestPocket.centerLat,
              lon: nearestPocket.centerLon,
            });
          }

          const cachedPocket = pocketCenters.get(nearestPocket.pocketId);
          if (!cachedPocket.nearestBranch) {
            cachedPocket.nearestBranch = findNearestBranchForCoordinates(
              nearestPocket.centerLat,
              nearestPocket.centerLon,
              branchRows
            );
          }

          const selectedBranch = cachedPocket.nearestBranch;
          if (!selectedBranch || !selectedBranch.id) {
            logger.warn('No nearest branch resolved for mapped pocket', {
              pocketId: nearestPocket.pocketId,
              customerRow: i + 2
            });
            continue;
          }

          const customerIdRaw = getFirstDefinedValue(row, [
            'lan',
            'LAN',
            'Lan',
            'CustomerID',
            'customer_id',
            'customerId',
            'ID',
            'id'
          ]);
          const normalizedCustomerId =
            customerIdRaw === undefined || customerIdRaw === null
              ? ''
              : String(customerIdRaw).trim();
          const customerId = normalizedCustomerId !== '' ? normalizedCustomerId : `CUST_${i + 1}`;
          const customerBucketRaw = getFirstDefinedValue(row, [
            'customer_bucket',
            'Customer Bucket',
            'CustomerBucket',
            'customerBucket',
            'bucket',
            'Bucket',
            'tag',
            'Tag',
            'customer_tag',
            'Customer Tag',
            'customerTag'
          ]);
          const customerBucket = customerBucketRaw === undefined || customerBucketRaw === null
            ? null
            : String(customerBucketRaw).trim() || null;

          try {
            mappings.push(buildCustomerPocketMappingRecord({
              customerId,
              customerLat: lat,
              customerLon: lon,
              uploadedBranchCode: branchCode,
              existingBranchId,
              distanceCustomerToExistingBranch,
              nearestPocket,
              selectedBranch,
              customerBucket,
            }));
          } catch (mappingError) {
            logger.warn(mappingError.message, {
              pocketId: nearestPocket.pocketId,
              customerRow: i + 2,
              branchId: selectedBranch.id
            });
            continue;
          }
        }
      } catch (error) {
        errors.push({ row: i + 2, error: error.message });
        results.push({ ...row, PocketID: 'ERROR', Distance: 'N/A' });
      }
    }

    // Create Excel file
    const worksheet = xlsx.utils.json_to_sheet(results);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Results');

    // Add statistics sheet
    const statsData = Object.entries(pocketStats)
      .map(([pocketId, count]) => ({
        'Pocket ID': pocketId,
        'Account Count': count,
      }))
      .sort((a, b) => b['Account Count'] - a['Account Count']); // Sort by count descending

    const statsWorksheet = xlsx.utils.json_to_sheet(statsData);
    xlsx.utils.book_append_sheet(workbook, statsWorksheet, 'Statistics');

    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Persist mappings to database
    let mappingsPersisted = 0;
    let replacedMappingsCount = 0;
    if (mappings.length > 0) {
      // --- ORIGINAL BACKUP ---
      // [IST 2026-03-09] Disabled current mapping persistence logic block:
      // 1) Pocket -> branch mapping via nearest branch lookup
      // 2) Pocket -> customer mapping enrichment
      // 3) customer_pocket_mappings persistence write path
      // try {
      //   logger.info('Starting mapping persistence', { jobId, mappingCount: mappings.length });
      //
      //   if (replaceExisting) {
      //     const deleteMappingsResult = await query('DELETE FROM customer_pocket_mappings');
      //     replacedMappingsCount = deleteMappingsResult.rowCount || 0;
      //     logger.info('Cleared existing customer mappings before replacement upload', {
      //       jobId,
      //       deletedMappings: replacedMappingsCount
      //     });
      //   }
      //
      //   // Get unique pockets and find nearest branches
      //   const uniquePockets = Array.from(pocketCenters.entries()).map(([pocketId, center]) => ({
      //     pocketId,
      //     lat: center.lat,
      //     lon: center.lon,
      //   }));
      //
      //   const pocketBranchMap = await branchFinderService.findNearestBranchesForPockets(uniquePockets);
      //
      //   // Enrich mappings with branch information
      //   const enrichedMappings = mappings.map(mapping => {
      //     const branchInfo = pocketBranchMap.get(mapping.pocketId);
      //
      //     if (!branchInfo) {
      //       logger.warn('No branch found for pocket', { pocketId: mapping.pocketId });
      //       throw new Error(`No branch found for pocket ${mapping.pocketId}`);
      //     }
      //
      //     const targetBranchId = branchInfo.branchId;
      //     const distancePocketToBranch = branchInfo.distance;
      //
      //     const uploadedBranchCode = mapping.customerBranchCode
      //       ? String(mapping.customerBranchCode).trim()
      //       : null;
      //     const existingBranchId = mapping.existingBranchId || null;
      //     const distanceCustomerToExistingBranch =
      //       Number.isFinite(mapping.distanceCustomerToExistingBranch)
      //         ? mapping.distanceCustomerToExistingBranch
      //         : null;
      //     const distanceCustomerToBranch = distancePocketToBranch;
      //
      //     return {
      //       customerId: mapping.customerId,
      //       customerLat: mapping.customerLat,
      //       customerLon: mapping.customerLon,
      //       pocketId: mapping.pocketId,
      //       distanceCustomerToPocket: mapping.distanceCustomerToPocket,
      //       nearestBranchId: targetBranchId,
      //       distancePocketToBranch,
      //       distanceCustomerToBranch: distanceCustomerToBranch,
      //       uploadedBranchCode,
      //       existingBranchId,
      //       distanceCustomerToExistingBranch,
      //     };
      //   });
      //
      //   // Save mappings using UUID job_id (matches FK customer_pocket_mappings.job_id -> jobs.job_id)
      //   const saveResult = await mappingService.saveMappings(jobId, enrichedMappings);
      //   mappingsPersisted = saveResult.insertedCount;
      //
      //   if (!saveResult.success) {
      //     logger.error('Mapping persistence had errors', {
      //       jobId,
      //       insertedCount: saveResult.insertedCount,
      //       totalMappings: enrichedMappings.length,
      //       errors: saveResult.errors,
      //     });
      //   } else {
      //     logger.info('Mapping persistence successful', {
      //       jobId,
      //       insertedCount: saveResult.insertedCount,
      //     });
      //   }
      // } catch (error) {
      //   // Log error but continue processing - don't fail the batch job
      //   logger.error('Failed to persist mappings', {
      //     jobId,
      //     error: error.message,
      //     stack: error.stack,
      //     mappingCount: mappings.length,
      //   });
      //   // Continue with Excel export even if persistence fails
      // }
      try {
        logger.info('Starting mapping persistence (actual branch distances)', {
          jobId,
          mappingCount: mappings.length,
          fallbackPocketConfigHits,
          branchPocketFallbackHits,
          branchPocketCount: branchPocketCatalog.length
        });

        const saveResult = await mappingService.saveMappings(jobId, mappings, {
          replaceExisting: Boolean(replaceExisting)
        });
        mappingsPersisted = saveResult.insertedCount;
        replacedMappingsCount = Number(saveResult.replacedCount || 0);

        if (!saveResult.success) {
          logger.error('Mapping persistence had errors', {
            jobId,
            insertedCount: saveResult.insertedCount,
            totalMappings: mappings.length,
            errors: saveResult.errors,
            replacedMappingsCount
          });
        } else {
          logger.info('Mapping persistence successful', {
            jobId,
            insertedCount: saveResult.insertedCount,
            replacedMappingsCount
          });
        }
      } catch (error) {
        logger.error('Failed to persist mappings', {
          jobId,
          error: error.message,
          stack: error.stack,
          mappingCount: mappings.length
        });
      }
    }

    // Update job in database with statistics
    await query(
      `UPDATE jobs 
       SET status = 'completed', 
           progress = 100, 
           completed_at = CURRENT_TIMESTAMP,
           result_url = $1,
           data = $2
       WHERE job_id = $3`,
      [
        `/api/v1/batch/download/${jobId}`, 
        JSON.stringify({ 
          fileName: job.data.fileName,
          pocketStats, 
          totalPockets: Object.keys(pocketStats).length,
          totalAccounts: rows.length - errors.length,
          // --- ORIGINAL BACKUP ---
          // mappingsPersisted,
          // fallbackPocketConfigHits,
          // replaceExisting: Boolean(replaceExisting),
          mappingsPersisted,
          fallbackPocketConfigHits,
          branchPocketFallbackHits,
          replaceExisting: Boolean(replaceExisting),
          replacedMappingsCount,
          territoryUrl: `/api/v1/batch/territories/job/${jobId}`,
          worker: 'nodejs'
        }),
        jobId
      ]
    );

    logger.info('Batch job completed (Node.js worker)', { 
      jobId, 
      total: rows.length, 
      errors: errors.length,
      uniquePockets: Object.keys(pocketStats).length,
      // --- ORIGINAL BACKUP ---
      // mappingsPersisted,
      // fallbackPocketConfigHits,
      mappingsPersisted,
      fallbackPocketConfigHits,
      branchPocketFallbackHits,
      replacedMappingsCount,
    });

    // Clean up uploaded file if it exists
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        logger.info('Cleaned up uploaded file', { jobId, filePath });
      } catch (err) {
        logger.warn('Failed to clean up file', { jobId, filePath, error: err.message });
      }
    }

    return {
      jobId,
      total: rows.length,
      errors: errors.length,
      pocketStats,
      // --- ORIGINAL BACKUP ---
      // mappingsPersisted,
      // fallbackPocketConfigHits,
      mappingsPersisted,
      fallbackPocketConfigHits,
      branchPocketFallbackHits,
      replacedMappingsCount,
      buffer: buffer.toString('base64'),
    };
  } catch (error) {
    // Clean up file on error
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        logger.warn('Failed to clean up file after error', { jobId, filePath });
      }
    }
    throw error;
  }
});

// Handle job failures
batchQueue.on('failed', async (job, err) => {
  logger.error('Batch job failed', { jobId: job.data.jobId, error: err.message });

  await query(
    `UPDATE jobs 
     SET status = 'failed', 
         error = $1
     WHERE job_id = $2`,
    [err.message, job.data.jobId]
  );
});

/**
 * POST /api/v1/batch/encode
 * Upload Excel file for batch Pocket ID encoding
 * HYBRID APPROACH: Small files use Node.js, large files use Python worker
 */
router.post(
  '/encode',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    console.log("1. Route hit, file uploaded to disk:", req.file?.path);
    
    if (!req.file) {
      throw new AppError('No file uploaded', 400, 'NO_FILE');
    }

    const fileName = req.file.originalname;
    const filePath = req.file.path;
    const fileSizeMB = req.file.size / (1024 * 1024);
    const replaceExisting = parseBooleanFlag(req.body?.replaceExisting, false);
    
    // We cannot use xlsx.read() here because large files will crash the Node.js event loop.
    // Instead, we use file size as a fast, safe proxy for the Python worker threshold.
    // 0.5 MB is approximately 5000 rows of standard location data.
    const usePythonWorker = fileSizeMB > 0.5; 

    // Get current configuration
    const configResult = await query('SELECT * FROM config WHERE id = 1');
    const config = configResult.rows.length > 0 ? {
      originLat: configResult.rows[0].origin_lat,
      originLon: configResult.rows[0].origin_lon,
      alphabet: configResult.rows[0].alphabet,
    } : {};

    const jobId = uuidv4();

    console.log("2. About to run DB insert...");
    // Create job in database (Setting total to 0, the worker will update it with exact count)
    await query(
      `INSERT INTO jobs (job_id, type, status, total, data)
       VALUES ($1, 'batch_encode', 'pending', 0, $2)`,
      [jobId, JSON.stringify({ 
        fileName,
        replaceExisting,
        worker: usePythonWorker ? 'python' : 'nodejs'
      })]
    );
    console.log("3. DB insert finished. About to push to Redis...");

    if (usePythonWorker) {
      logger.info('Routing to Python worker (large file)', { jobId, fileSizeMB, fileName });

      // Python worker runs in Docker/Linux in many deployments. Send basename so the worker
      // resolves against its UPLOAD_DIR mount instead of a host-absolute Windows path.
      const pythonWorkerFilePath = path.basename(filePath);
      // --- ORIGINAL BACKUP ---
      // const jobPayload = {
      //   jobId,
      //   filePath,
      //   fileName,
      //   config,
      //   replaceExisting
      // };
      const jobPayload = {
        jobId,
        filePath: pythonWorkerFilePath,
        originalFilePath: filePath,
        fileName,
        config,
        replaceExisting
      };
      
      // CRITICAL FIX: Use Bull's existing Redis client instead of separate pythonRedisClient
      // This avoids the "ready" status issue that was causing uploads to hang
      try {
        await withTimeout(
          batchQueue.client.lpush('python_batch_jobs', JSON.stringify(jobPayload)),
          10000,
          'Timed out while queueing Python job'
        );
        console.log("4. Raw Redis push finished using Bull's client.");
        logger.info('Python job queued successfully', { jobId });
      } catch (err) {
        logger.error('Failed to queue Python job', { error: err.message, stack: err.stack, jobId });
        
        // Clean up uploaded file on error
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
            logger.info('Cleaned up uploaded file after Redis error', { jobId, filePath });
          } catch (cleanupErr) {
            logger.warn('Failed to clean up file after Redis error', { jobId, filePath });
          }
        }
        
        // Update job status to failed
        await query(
          `UPDATE jobs SET status = 'failed', error = $1 WHERE job_id = $2`,
          ['Failed to queue job to Python worker: ' + err.message, jobId]
        );
        
        throw new AppError('Failed to queue job to Python worker', 500, 'REDIS_PUSH_ERROR');
      }

      res.json({
        message: 'Large file uploaded successfully. Processing with optimized Python worker.',
        jobId,
        fileName,
        replaceExisting,
        worker: 'python',
        statusUrl: `/api/v1/batch/status/${jobId}`,
      });
    } else {
      logger.info('Routing to Node.js worker (small file)', { jobId, fileSizeMB, fileName });

      // Queue file path for background parsing/processing to return response immediately.
      try {
        await withTimeout(
          batchQueue.add({
            jobId,
            config,
            fileName,
            filePath,
            replaceExisting
          }),
          10000,
          'Timed out while queueing Node.js job'
        );
      } catch (err) {
        logger.error('Failed to queue Node.js job', {
          error: err.message,
          stack: err.stack,
          jobId,
        });

        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
            logger.info('Cleaned up uploaded file after queue error', { jobId, filePath });
          } catch (cleanupErr) {
            logger.warn('Failed to clean up file after queue error', { jobId, filePath });
          }
        }

        await query(
          `UPDATE jobs SET status = 'failed', error = $1 WHERE job_id = $2`,
          ['Failed to queue job to Node.js worker: ' + err.message, jobId]
        );

        throw new AppError('Failed to queue job to Node.js worker', 500, 'QUEUE_PUSH_ERROR');
      }

      res.status(202).json({
        message: 'File uploaded successfully. Processing in background.',
        jobId,
        fileName,
        replaceExisting,
        worker: 'nodejs',
        statusUrl: `/api/v1/batch/status/${jobId}`,
      });
    }
  })
);

/**
 * GET /api/v1/batch/status/:jobId
 * Get batch job status
 */
router.get(
  '/status/:jobId',
  asyncHandler(async (req, res) => {
    const { jobId } = req.params;

    const result = await query(
      'SELECT * FROM jobs WHERE job_id = $1',
      [jobId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
    }

    const job = result.rows[0];

    res.json({
      jobId: job.job_id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      total: job.total,
      resultUrl: job.result_url,
      error: job.error,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      completedAt: job.completed_at,
    });
  })
);

/**
 * GET /api/v1/batch/download/:jobId
 * Download batch job result
 * Handles both Node.js (in-memory) and Python (disk-based) results
 */
router.get(
  '/download/:jobId',
  asyncHandler(async (req, res) => {
    const { jobId } = req.params;

    // Check job status in database first
    const jobRecord = await query('SELECT * FROM jobs WHERE job_id = $1', [jobId]);
    
    if (jobRecord.rows.length === 0) {
      throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
    }

    const job = jobRecord.rows[0];
    // Postgres pg driver auto-parses JSONB. Only parse if it comes back as a string.
    const jobData = typeof job.data === 'string' ? JSON.parse(job.data) : (job.data || {});
    const worker = jobData.worker || 'nodejs'; // Default to nodejs for old jobs

    if (job.status !== 'completed') {
      throw new AppError(
        `Job is not completed. Current status: ${job.status}`,
        400,
        'JOB_NOT_READY'
      );
    }

    if (worker === 'python') {
      // Python worker: File saved to disk
      const resultPath = path.join(uploadDir, `result_${jobId}.xlsx`);
      
      if (!fs.existsSync(resultPath)) {
        logger.warn('Python result file not found, trying Bull queue', { jobId, resultPath });
        // Fallback to Bull queue if file doesn't exist
        const bullJob = await batchQueue.getJob(jobId);
        if (!bullJob || !bullJob.returnvalue || !bullJob.returnvalue.buffer) {
          throw new AppError('Result file not found', 404, 'FILE_NOT_FOUND');
        }
        
        const buffer = Buffer.from(bullJob.returnvalue.buffer, 'base64');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=pocket_ids_${jobId}.xlsx`);
        return res.send(buffer);
      }

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=pocket_ids_${jobId}.xlsx`
      );
      
      // Stream file from disk
      const fileStream = fs.createReadStream(resultPath);
      fileStream.pipe(res);
    } else {
      // Node.js worker: File in Bull queue memory
      const bullJob = await batchQueue.getJob(jobId);

      if (!bullJob) {
        throw new AppError('Job not found in queue', 404, 'JOB_NOT_FOUND');
      }

      const state = await bullJob.getState();

      if (state !== 'completed') {
        throw new AppError(
          `Job is not completed. Current status: ${state}`,
          400,
          'JOB_NOT_READY'
        );
      }

      const result = bullJob.returnvalue;

      if (!result || !result.buffer) {
        throw new AppError('Result file not found', 404, 'FILE_NOT_FOUND');
      }

      const buffer = Buffer.from(result.buffer, 'base64');

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=pocket_ids_${jobId}.xlsx`
      );
      res.send(buffer);
    }
  })
);

const normalizeCompassAngle = (angleDegrees) => {
  const normalized = Number(angleDegrees) % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

const calculateClockwiseAngleDegrees = (
  originLat,
  originLng,
  targetLat,
  targetLng
) => {
  const radians = Math.atan2(
    Number(targetLng) - Number(originLng),
    Number(targetLat) - Number(originLat)
  );
  return normalizeCompassAngle((radians * 180) / Math.PI);
};

const calculateAngularDifferenceDegrees = (angleA, angleB) => {
  const normalizedA = normalizeCompassAngle(angleA);
  const normalizedB = normalizeCompassAngle(angleB);
  const absoluteDifference = Math.abs(normalizedA - normalizedB);
  return Math.min(absoluteDifference, 360 - absoluteDifference);
};

const buildPocketAdjacencyMap = (pockets, levelMeters, referenceLat) => {
  const adjacencyMap = new Map();
  pockets.forEach((pocket) => {
    adjacencyMap.set(pocket.pocketId, new Set());
  });

  if (pockets.length <= 1) {
    return adjacencyMap;
  }

  const thresholdMeters = Math.max(Number(levelMeters) * 1.45, 1);
  const latitudeBucketSize = Math.max(thresholdMeters / 111320, 1e-6);
  const cosLatitude = Math.cos((Number(referenceLat) * Math.PI) / 180);
  const metersPerDegreeLongitude = Math.max(
    111320 * Math.max(Math.abs(cosLatitude), 0.15),
    1
  );
  const longitudeBucketSize = Math.max(thresholdMeters / metersPerDegreeLongitude, 1e-6);

  const bucketMap = new Map();
  const pocketBucketLookup = new Map();

  pockets.forEach((pocket, index) => {
    const bucketY = Math.floor(Number(pocket.centerLat) / latitudeBucketSize);
    const bucketX = Math.floor(Number(pocket.centerLng) / longitudeBucketSize);
    const bucketKey = `${bucketX}|${bucketY}`;
    if (!bucketMap.has(bucketKey)) {
      bucketMap.set(bucketKey, []);
    }
    bucketMap.get(bucketKey).push(index);
    pocketBucketLookup.set(pocket.pocketId, { bucketX, bucketY });
  });

  pockets.forEach((pocket, index) => {
    const bucketCoordinates = pocketBucketLookup.get(pocket.pocketId);
    if (!bucketCoordinates) {
      return;
    }

    for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
      for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
        const candidateBucketKey = `${bucketCoordinates.bucketX + deltaX}|${bucketCoordinates.bucketY + deltaY}`;
        const candidateIndices = bucketMap.get(candidateBucketKey);
        if (!candidateIndices || candidateIndices.length === 0) {
          continue;
        }

        candidateIndices.forEach((candidateIndex) => {
          if (candidateIndex <= index) {
            return;
          }

          const candidatePocket = pockets[candidateIndex];
          if (!candidatePocket) {
            return;
          }

          const distanceMeters = haversineDistance(
            Number(pocket.centerLat),
            Number(pocket.centerLng),
            Number(candidatePocket.centerLat),
            Number(candidatePocket.centerLng)
          );
          if (!Number.isFinite(distanceMeters) || distanceMeters > thresholdMeters) {
            return;
          }

          adjacencyMap.get(pocket.pocketId)?.add(candidatePocket.pocketId);
          adjacencyMap.get(candidatePocket.pocketId)?.add(pocket.pocketId);
        });
      }
    }
  });

  return adjacencyMap;
};

const pickNearestFrontierPocket = (employeeState, pocketById, unassignedPocketIds) => {
  let selectedPocketId = null;
  let selectedDistance = Number.POSITIVE_INFINITY;
  const stalePocketIds = [];

  employeeState.frontier.forEach((pocketId) => {
    if (!unassignedPocketIds.has(pocketId)) {
      stalePocketIds.push(pocketId);
      return;
    }

    const candidatePocket = pocketById.get(pocketId);
    if (!candidatePocket) {
      stalePocketIds.push(pocketId);
      return;
    }

    const distanceFromSeedMeters = haversineDistance(
      Number(employeeState.seedCenterLat),
      Number(employeeState.seedCenterLng),
      Number(candidatePocket.centerLat),
      Number(candidatePocket.centerLng)
    );
    if (!Number.isFinite(distanceFromSeedMeters)) {
      return;
    }

    if (distanceFromSeedMeters < selectedDistance) {
      selectedDistance = distanceFromSeedMeters;
      selectedPocketId = pocketId;
      return;
    }

    if (
      distanceFromSeedMeters === selectedDistance
      && selectedPocketId
      && String(pocketId).localeCompare(String(selectedPocketId)) < 0
    ) {
      selectedPocketId = pocketId;
    }
  });

  stalePocketIds.forEach((pocketId) => {
    employeeState.frontier.delete(pocketId);
  });

  return selectedPocketId;
};

const refillFrontierFromOwnedPockets = (employeeState, adjacencyMap, unassignedPocketIds) => {
  employeeState.ownedPocketIds.forEach((ownedPocketId) => {
    const neighbors = adjacencyMap.get(ownedPocketId);
    if (!neighbors) {
      return;
    }
    neighbors.forEach((neighborPocketId) => {
      if (unassignedPocketIds.has(neighborPocketId)) {
        employeeState.frontier.add(neighborPocketId);
      }
    });
  });
};

// --- ORIGINAL BACKUP ---
/*
const runClockwiseSeededContiguousAllocation = async (
  client,
  {
    branchId,
    levelMeters,
    latestJobId
  }
) => {
  const effectiveLevelMeters = Number.isFinite(Number(levelMeters)) && Number(levelMeters) > 0
    ? Math.round(Number(levelMeters))
    : DEFAULT_PERSISTENT_TERRITORY_LEVEL_METERS;

  const branchResult = await client.query(
    `
      SELECT
        branches.id::text AS branch_id,
        COALESCE(
          ST_Y(branches.geom::geometry),
          branches.lat
        )::double precision AS branch_lat,
        COALESCE(
          ST_X(branches.geom::geometry),
          branches.lon
        )::double precision AS branch_lng
      FROM branches
      WHERE branches.id = $1
      LIMIT 1
    `,
    [branchId]
  );

  if (branchResult.rows.length === 0) {
    throw new AppError('Branch not found for allocation run.', 404, 'BRANCH_NOT_FOUND');
  }

  const branchLat = Number(branchResult.rows[0]?.branch_lat);
  const branchLng = Number(branchResult.rows[0]?.branch_lng);
  if (!isValidGeoCoordinate(branchLat, branchLng)) {
    throw new AppError(
      `Branch ${branchId} has invalid coordinates. Configure branch latitude/longitude before allocation.`,
      422,
      'BRANCH_COORDINATES_INVALID'
    );
  }

  const employeesResult = await client.query(
    `
      SELECT
        branch_employees.id::int AS branch_employee_id,
        branch_employees.employee_id::text AS employee_id
      FROM branch_employees
      WHERE branch_employees.branch_id = $1
        AND branch_employees.is_active = TRUE
      ORDER BY branch_employees.employee_id
    `,
    [branchId]
  );
  const employees = employeesResult.rows.map((row) => ({
    branchEmployeeId: Number(row.branch_employee_id),
    employeeId: String(row.employee_id || '').trim()
  })).filter((row) => row.employeeId);

  if (employees.length === 0) {
    throw new AppError(
      `No active employees found for branch ${branchId}. Add active employees before running auto-allocation.`,
      422,
      'NO_ACTIVE_EMPLOYEES'
    );
  }
  const paddedCatchmentRadiusMeters = resolvePaddedCatchmentRadiusMeters(effectiveLevelMeters);

  const pocketsResult = await client.query(
    `
      WITH branch_geom AS (
        SELECT
          COALESCE(
            branches.geom::geometry,
            ST_SetSRID(ST_MakePoint(branches.lon, branches.lat), 4326)
          ) AS geom
        FROM branches
        WHERE branches.id = $1
      ),
      catchment_pockets AS (
        SELECT
          gc.code::text AS pocket_id,
          COALESCE(gc.label_lat, ST_Y(ST_PointOnSurface(gc.geom)))::double precision AS center_lat,
          COALESCE(gc.label_lon, ST_X(ST_PointOnSurface(gc.geom)))::double precision AS center_lng,
          COALESCE(gc.min_lat, ST_YMin(gc.geom))::double precision AS min_lat,
          COALESCE(gc.max_lat, ST_YMax(gc.geom))::double precision AS max_lat,
          COALESCE(gc.min_lng, ST_XMin(gc.geom))::double precision AS min_lng,
          COALESCE(gc.max_lng, ST_XMax(gc.geom))::double precision AS max_lng,
          ST_AsGeoJSON(
            ST_GeometryN(
              ST_Multi(
                ST_CollectionExtract(
                  ST_MakeValid(gc.geom),
                  3
                )
              ),
              1
            )
          )::json AS geometry
        FROM grid_cells gc
        CROSS JOIN branch_geom bg
        WHERE gc.level_m = $2::integer
          AND gc.code IS NOT NULL
          AND btrim(gc.code) <> ''
          AND gc.code ~ $5::text
          AND gc.geom IS NOT NULL
          AND NOT ST_IsEmpty(gc.geom)
          -- --- ORIGINAL BACKUP ---
          -- AND ST_DWithin(
          --   gc.geom::geography,
          --   bg.geom::geography,
          --   $3::double precision
          -- )
          AND ST_DWithin(
            ST_PointOnSurface(gc.geom)::geography,
            bg.geom::geography,
            $3::double precision
          )
      ),
      pocket_customers AS (
        SELECT
          catchment_pockets.pocket_id,
          COUNT(cpm.job_id)::int AS customer_count
        FROM catchment_pockets
        LEFT JOIN customer_pocket_mappings cpm
          ON cpm.job_id = $4
         AND cpm.nearest_branch_id = $1
         AND cpm.customer_lat >= catchment_pockets.min_lat
         AND cpm.customer_lat <= catchment_pockets.max_lat
         AND cpm.customer_lon >= catchment_pockets.min_lng
         AND cpm.customer_lon <= catchment_pockets.max_lng
        GROUP BY catchment_pockets.pocket_id
      )
      SELECT
        catchment_pockets.pocket_id,
        catchment_pockets.center_lat,
        catchment_pockets.center_lng,
        catchment_pockets.geometry,
        COALESCE(pocket_customers.customer_count, 0)::int AS customer_count
      FROM catchment_pockets
      LEFT JOIN pocket_customers
        ON pocket_customers.pocket_id = catchment_pockets.pocket_id
      ORDER BY catchment_pockets.pocket_id
    `,
    [
      branchId,
      effectiveLevelMeters,
      // --- ORIGINAL BACKUP ---
      // BRANCH_CATCHMENT_RADIUS_METERS,
      paddedCatchmentRadiusMeters,
      latestJobId,
      CANONICAL_POCKET_CODE_SQL_PATTERN
    ]
  );

  const pockets = pocketsResult.rows.map((row) => ({
    pocketId: String(row.pocket_id || '').trim(),
    centerLat: Number(row.center_lat),
    centerLng: Number(row.center_lng),
    customerCount: Math.max(Number(row.customer_count || 0), 0),
    geometry: row.geometry
  })).filter((pocket) =>
    pocket.pocketId
    && Number.isFinite(pocket.centerLat)
    && Number.isFinite(pocket.centerLng)
    && pocket.geometry
  );

  if (pockets.length === 0) {
    throw new AppError(
      `No ${effectiveLevelMeters}m master grid pockets were found inside the ${Math.round(BRANCH_CATCHMENT_RADIUS_METERS / 1000)}km catchment for branch ${branchId}. Populate grid_cells for this level before running allocation.`,
      422,
      'MASTER_GRID_CATCHMENT_EMPTY'
    );
  }

  if (pockets.length < employees.length) {
    throw new AppError(
      `Branch ${branchId} has ${employees.length} active employees but only ${pockets.length} eligible pockets at ${effectiveLevelMeters}m.`,
      422,
      'INSUFFICIENT_POCKETS_FOR_EMPLOYEES'
    );
  }

  const pocketById = new Map();
  let maxDistanceFromBranch = 0;
  pockets.forEach((pocket) => {
    const distanceFromBranch = haversineDistance(
      branchLat,
      branchLng,
      pocket.centerLat,
      pocket.centerLng
    );
    const angleDegrees = calculateClockwiseAngleDegrees(
      branchLat,
      branchLng,
      pocket.centerLat,
      pocket.centerLng
    );
    const enrichedPocket = {
      ...pocket,
      distanceFromBranch,
      angleDegrees
    };
    pocketById.set(enrichedPocket.pocketId, enrichedPocket);
    if (Number.isFinite(distanceFromBranch) && distanceFromBranch > maxDistanceFromBranch) {
      maxDistanceFromBranch = distanceFromBranch;
    }
  });

  const adjacencyMap = buildPocketAdjacencyMap(pockets, effectiveLevelMeters, branchLat);
  const unassignedPocketIds = new Set(pockets.map((pocket) => pocket.pocketId));
  const assignmentByPocketId = new Map();
  const employeeCount = employees.length;
  const totalCustomers = pockets.reduce(
    (sum, pocket) => sum + Math.max(Number(pocket.customerCount || 0), 0),
    0
  );
  const targetCustomers = employeeCount > 0 ? totalCustomers / employeeCount : 0;
  const targetArea = employeeCount > 0 ? pockets.length / employeeCount : 0;
  // --- ORIGINAL BACKUP ---
  // const areaSafeguardLimit = targetArea * 1.5;
  const areaSafeguardLimit = targetArea * 1.3;
  const diagnostics = [];

  const employeeStates = employees.map((employee, index) => ({
    ...employee,
    targetAngle: normalizeCompassAngle((360 / employeeCount) * index),
    seedPocketId: null,
    seedCenterLat: branchLat,
    seedCenterLng: branchLng,
    currentCustomers: 0,
    currentArea: 0,
    frontier: new Set(),
    ownedPocketIds: new Set(),
    done: false,
    waiting: false
  }));

  const claimPocket = (employeeState, pocketId, claimType) => {
    if (!unassignedPocketIds.has(pocketId)) {
      return false;
    }

    const pocket = pocketById.get(pocketId);
    if (!pocket) {
      return false;
    }

    const beforeCustomers = Number(employeeState.currentCustomers || 0);

    unassignedPocketIds.delete(pocketId);
    assignmentByPocketId.set(pocketId, employeeState);
    employeeState.ownedPocketIds.add(pocketId);
    employeeState.currentCustomers = beforeCustomers + Number(pocket.customerCount || 0);
    employeeState.currentArea += 1;
    employeeState.frontier.delete(pocketId);

    const neighbors = adjacencyMap.get(pocketId);
    if (neighbors) {
      neighbors.forEach((neighborPocketId) => {
        if (unassignedPocketIds.has(neighborPocketId)) {
          employeeState.frontier.add(neighborPocketId);
        }
      });
    }

    diagnostics.push({
      iteration: diagnostics.length + 1,
      claim_type: claimType,
      employee_id: employeeState.employeeId,
      grid_cell_id: pocketId,
      account_count: Number(pocket.customerCount || 0),
      current_accounts_before: beforeCustomers,
      current_accounts_after: Number(employeeState.currentCustomers || 0),
      target_workload: Number(targetCustomers || 0),
      max_capacity: Number(targetCustomers || 0)
    });

    return true;
  };

  // --- ORIGINAL BACKUP ---
  // const seedAngleWeight = 0.6;
  // const seedDistanceWeight = 0.4;
  // employeeStates.forEach((employeeState) => {
  //   if (unassignedPocketIds.size === 0) {
  //     return;
  //   }
  //
  //   let bestPocketId = null;
  //   let bestScore = Number.POSITIVE_INFINITY;
  //   let bestDistance = Number.POSITIVE_INFINITY;
  //
  //   unassignedPocketIds.forEach((candidatePocketId) => {
  //     const candidatePocket = pocketById.get(candidatePocketId);
  //     if (!candidatePocket) {
  //       return;
  //     }
  //
  //     const angleDifference = calculateAngularDifferenceDegrees(
  //       candidatePocket.angleDegrees,
  //       employeeState.targetAngle
  //     );
  //     const normalizedAngleDifference = angleDifference / 180;
  //     const normalizedDistance = maxDistanceFromBranch > 0
  //       ? (candidatePocket.distanceFromBranch / maxDistanceFromBranch)
  //       : 0;
  //     const score = (seedAngleWeight * normalizedAngleDifference)
  //       + (seedDistanceWeight * normalizedDistance);
  //
  //     if (score < bestScore) {
  //       bestScore = score;
  //       bestDistance = Number(candidatePocket.distanceFromBranch || 0);
  //       bestPocketId = candidatePocketId;
  //       return;
  //     }
  //
  //     if (
  //       score === bestScore
  //       && Number(candidatePocket.distanceFromBranch || 0) < bestDistance
  //     ) {
  //       bestDistance = Number(candidatePocket.distanceFromBranch || 0);
  //       bestPocketId = candidatePocketId;
  //     }
  //   });
  //
  //   if (!bestPocketId) {
  //     employeeState.waiting = true;
  //     return;
  //   }
  //
  //   const seedPocket = pocketById.get(bestPocketId);
  //   employeeState.seedPocketId = bestPocketId;
  //   employeeState.seedCenterLat = Number(seedPocket?.centerLat || branchLat);
  //   employeeState.seedCenterLng = Number(seedPocket?.centerLng || branchLng);
  //   claimPocket(employeeState, bestPocketId, 'seed');
  // });
  const selectedSeedPocketIds = [];
  if (employeeStates.length > 0 && unassignedPocketIds.size > 0) {
    let firstSeedPocketId = null;
    let firstSeedCustomers = Number.NEGATIVE_INFINITY;
    let firstSeedDistance = Number.POSITIVE_INFINITY;

    unassignedPocketIds.forEach((candidatePocketId) => {
      const candidatePocket = pocketById.get(candidatePocketId);
      if (!candidatePocket) {
        return;
      }

      const candidateCustomers = Number(candidatePocket.customerCount || 0);
      const candidateDistance = Number(candidatePocket.distanceFromBranch || 0);
      if (candidateCustomers > firstSeedCustomers) {
        firstSeedCustomers = candidateCustomers;
        firstSeedDistance = candidateDistance;
        firstSeedPocketId = candidatePocketId;
        return;
      }

      if (
        candidateCustomers === firstSeedCustomers
        && candidateDistance < firstSeedDistance
      ) {
        firstSeedDistance = candidateDistance;
        firstSeedPocketId = candidatePocketId;
        return;
      }

      if (
        candidateCustomers === firstSeedCustomers
        && candidateDistance === firstSeedDistance
        && firstSeedPocketId
        && String(candidatePocketId).localeCompare(String(firstSeedPocketId)) < 0
      ) {
        firstSeedPocketId = candidatePocketId;
      }
    });

    if (firstSeedPocketId) {
      const firstSeedPocket = pocketById.get(firstSeedPocketId);
      const firstEmployeeState = employeeStates[0];
      firstEmployeeState.seedPocketId = firstSeedPocketId;
      firstEmployeeState.seedCenterLat = Number(firstSeedPocket?.centerLat || branchLat);
      firstEmployeeState.seedCenterLng = Number(firstSeedPocket?.centerLng || branchLng);
      claimPocket(firstEmployeeState, firstSeedPocketId, 'seed_density_primary');
      selectedSeedPocketIds.push(firstSeedPocketId);
    } else {
      employeeStates[0].waiting = true;
    }
  }

  for (let employeeIndex = 1; employeeIndex < employeeStates.length; employeeIndex += 1) {
    const employeeState = employeeStates[employeeIndex];
    if (unassignedPocketIds.size === 0) {
      employeeState.waiting = true;
      continue;
    }

    let bestSeedPocketId = null;
    let bestSuitabilityScore = Number.NEGATIVE_INFINITY;
    let bestSeedCustomers = Number.NEGATIVE_INFINITY;
    let bestDistanceToSeed = Number.NEGATIVE_INFINITY;

    unassignedPocketIds.forEach((candidatePocketId) => {
      const candidatePocket = pocketById.get(candidatePocketId);
      if (!candidatePocket) {
        return;
      }

      let distanceToClosestSeed = Number(candidatePocket.distanceFromBranch || 0);
      if (selectedSeedPocketIds.length > 0) {
        distanceToClosestSeed = Number.POSITIVE_INFINITY;
        selectedSeedPocketIds.forEach((seedPocketId) => {
          const seedPocket = pocketById.get(seedPocketId);
          if (!seedPocket) {
            return;
          }
          const candidateDistance = haversineDistance(
            Number(candidatePocket.centerLat),
            Number(candidatePocket.centerLng),
            Number(seedPocket.centerLat),
            Number(seedPocket.centerLng)
          );
          if (Number.isFinite(candidateDistance) && candidateDistance < distanceToClosestSeed) {
            distanceToClosestSeed = candidateDistance;
          }
        });
      }

      if (!Number.isFinite(distanceToClosestSeed)) {
        distanceToClosestSeed = 0;
      }

      const customerCount = Number(candidatePocket.customerCount || 0);
      const suitabilityScore = customerCount * Math.max(distanceToClosestSeed, 1);

      if (suitabilityScore > bestSuitabilityScore) {
        bestSuitabilityScore = suitabilityScore;
        bestSeedCustomers = customerCount;
        bestDistanceToSeed = distanceToClosestSeed;
        bestSeedPocketId = candidatePocketId;
        return;
      }

      if (
        suitabilityScore === bestSuitabilityScore
        && customerCount > bestSeedCustomers
      ) {
        bestSeedCustomers = customerCount;
        bestDistanceToSeed = distanceToClosestSeed;
        bestSeedPocketId = candidatePocketId;
        return;
      }

      if (
        suitabilityScore === bestSuitabilityScore
        && customerCount === bestSeedCustomers
        && distanceToClosestSeed > bestDistanceToSeed
      ) {
        bestDistanceToSeed = distanceToClosestSeed;
        bestSeedPocketId = candidatePocketId;
      }
    });

    if (!bestSeedPocketId) {
      employeeState.waiting = true;
      continue;
    }

    const bestSeedPocket = pocketById.get(bestSeedPocketId);
    employeeState.seedPocketId = bestSeedPocketId;
    employeeState.seedCenterLat = Number(bestSeedPocket?.centerLat || branchLat);
    employeeState.seedCenterLng = Number(bestSeedPocket?.centerLng || branchLng);
    claimPocket(employeeState, bestSeedPocketId, 'seed_density');
    selectedSeedPocketIds.push(bestSeedPocketId);
  }

  let phaseOneProgress = true;
  while (unassignedPocketIds.size > 0 && phaseOneProgress) {
    phaseOneProgress = false;
    let activeEmployeeCount = 0;

    employeeStates.forEach((employeeState) => {
      if (!employeeState.seedPocketId) {
        employeeState.done = true;
        return;
      }
      if (employeeState.done || employeeState.waiting) {
        return;
      }

      activeEmployeeCount += 1;

      // --- ORIGINAL BACKUP ---
      // if (
      //   Number(employeeState.currentCustomers || 0) >= targetCustomers
      //   || Number(employeeState.currentArea || 0) > areaSafeguardLimit
      // ) {
      //   employeeState.done = true;
      //   return;
      // }
      const customerProgress = targetCustomers > 0
        ? (Number(employeeState.currentCustomers || 0) / targetCustomers)
        : 1;
      const areaProgress = targetArea > 0
        ? (Number(employeeState.currentArea || 0) / targetArea)
        : 1;
      const blendedScore = (customerProgress * 0.5) + (areaProgress * 0.5);
      if (
        blendedScore >= 1.0
        || Number(employeeState.currentArea || 0) >= areaSafeguardLimit
      ) {
        employeeState.done = true;
        return;
      }

      const nextPocketId = pickNearestFrontierPocket(
        employeeState,
        pocketById,
        unassignedPocketIds
      );
      if (!nextPocketId) {
        employeeState.waiting = true;
        return;
      }

      if (claimPocket(employeeState, nextPocketId, 'phase1_claim')) {
        phaseOneProgress = true;
      }
    });

    if (activeEmployeeCount === 0) {
      break;
    }
  }

  employeeStates.forEach((employeeState) => {
    if (!employeeState.seedPocketId) {
      return;
    }
    employeeState.done = false;
    employeeState.waiting = false;
  });

  let phaseTwoProgress = true;
  while (unassignedPocketIds.size > 0 && phaseTwoProgress) {
    phaseTwoProgress = false;

    employeeStates.forEach((employeeState) => {
      if (!employeeState.seedPocketId) {
        return;
      }

      if (employeeState.frontier.size === 0) {
        refillFrontierFromOwnedPockets(
          employeeState,
          adjacencyMap,
          unassignedPocketIds
        );
      }

      const nextPocketId = pickNearestFrontierPocket(
        employeeState,
        pocketById,
        unassignedPocketIds
      );
      if (!nextPocketId) {
        return;
      }

      if (claimPocket(employeeState, nextPocketId, 'phase2_claim')) {
        phaseTwoProgress = true;
      }
    });
  }

  let isolatedPocketAssignments = 0;
  if (unassignedPocketIds.size > 0) {
    const fallbackOwner = employeeStates.find((employeeState) =>
      employeeState.ownedPocketIds.size > 0
    ) || employeeStates[0];

    Array.from(unassignedPocketIds).forEach((orphanPocketId) => {
      const orphanPocket = pocketById.get(orphanPocketId);
      if (!orphanPocket) {
        return;
      }

      let nearestOwner = fallbackOwner;
      let nearestDistance = Number.POSITIVE_INFINITY;

      assignmentByPocketId.forEach((ownerState, assignedPocketId) => {
        const assignedPocket = pocketById.get(assignedPocketId);
        if (!assignedPocket) {
          return;
        }

        const distanceMeters = haversineDistance(
          orphanPocket.centerLat,
          orphanPocket.centerLng,
          assignedPocket.centerLat,
          assignedPocket.centerLng
        );
        if (!Number.isFinite(distanceMeters) || distanceMeters >= nearestDistance) {
          return;
        }

        nearestDistance = distanceMeters;
        nearestOwner = ownerState;
      });

      if (claimPocket(nearestOwner, orphanPocketId, 'isolated_fallback')) {
        isolatedPocketAssignments += 1;
      }
    });
  }

  if (unassignedPocketIds.size > 0) {
    let fallbackIndex = 0;
    const fallbackEmployees = employeeStates.length > 0 ? employeeStates : [];
    Array.from(unassignedPocketIds).forEach((pocketId) => {
      const fallbackEmployee = fallbackEmployees[fallbackIndex % fallbackEmployees.length];
      fallbackIndex += 1;
      claimPocket(fallbackEmployee, pocketId, 'safety_fallback');
    });
  }

  const assignmentRows = pockets.map((pocket) => {
    const ownerState = assignmentByPocketId.get(pocket.pocketId)
      || employeeStates[0];
    return {
      pocket_id: pocket.pocketId,
      employee_id: ownerState?.employeeId || null,
      account_count: Math.max(Number(pocket.customerCount || 0), 0),
      geometry: pocket.geometry
    };
  });

  return {
    assignmentLevelMeters: effectiveLevelMeters,
    targetCustomers,
    targetArea,
    totalCustomers,
    totalPockets: pockets.length,
    isolatedPocketAssignments,
    assignmentRows,
    diagnostics
  };
};
*/

const runCoreAndDonutAllocation = async (
  client,
  {
    branchId,
    levelMeters,
    latestJobId
  }
) => {
  const effectiveLevelMeters = Number.isFinite(Number(levelMeters)) && Number(levelMeters) > 0
    ? Math.round(Number(levelMeters))
    : DEFAULT_PERSISTENT_TERRITORY_LEVEL_METERS;

  const branchResult = await client.query(
    `
      SELECT
        branches.id::text AS branch_id,
        COALESCE(
          ST_Y(branches.geom::geometry),
          branches.lat
        )::double precision AS branch_lat,
        COALESCE(
          ST_X(branches.geom::geometry),
          branches.lon
        )::double precision AS branch_lng
      FROM branches
      WHERE branches.id = $1
      LIMIT 1
    `,
    [branchId]
  );

  if (branchResult.rows.length === 0) {
    throw new AppError('Branch not found for allocation run.', 404, 'BRANCH_NOT_FOUND');
  }

  const branchLat = Number(branchResult.rows[0]?.branch_lat);
  const branchLng = Number(branchResult.rows[0]?.branch_lng);
  if (!isValidGeoCoordinate(branchLat, branchLng)) {
    throw new AppError(
      `Branch ${branchId} has invalid coordinates. Configure branch latitude/longitude before allocation.`,
      422,
      'BRANCH_COORDINATES_INVALID'
    );
  }

  const employeesResult = await client.query(
    `
      SELECT
        branch_employees.id::int AS branch_employee_id,
        branch_employees.employee_id::text AS employee_id
      FROM branch_employees
      WHERE branch_employees.branch_id = $1
        AND branch_employees.is_active = TRUE
      ORDER BY branch_employees.employee_id
    `,
    [branchId]
  );
  const employees = employeesResult.rows.map((row) => ({
    branchEmployeeId: Number(row.branch_employee_id),
    employeeId: String(row.employee_id || '').trim()
  })).filter((row) => row.employeeId);

  if (employees.length === 0) {
    throw new AppError(
      `No active employees found for branch ${branchId}. Add active employees before running auto-allocation.`,
      422,
      'NO_ACTIVE_EMPLOYEES'
    );
  }

  const pocketsResult = await client.query(
    `
      WITH branch_geom AS (
        SELECT
          COALESCE(
            branches.geom::geometry,
            ST_SetSRID(ST_MakePoint(branches.lon, branches.lat), 4326)
          ) AS geom
        FROM branches
        WHERE branches.id = $1
      ),
      catchment_pockets AS (
        SELECT
          gc.code::text AS pocket_id,
          COALESCE(gc.label_lat, ST_Y(ST_PointOnSurface(gc.geom)))::double precision AS center_lat,
          COALESCE(gc.label_lon, ST_X(ST_PointOnSurface(gc.geom)))::double precision AS center_lng,
          COALESCE(gc.min_lat, ST_YMin(gc.geom))::double precision AS min_lat,
          COALESCE(gc.max_lat, ST_YMax(gc.geom))::double precision AS max_lat,
          COALESCE(gc.min_lng, ST_XMin(gc.geom))::double precision AS min_lng,
          COALESCE(gc.max_lng, ST_XMax(gc.geom))::double precision AS max_lng,
          ST_AsGeoJSON(
            ST_GeometryN(
              ST_Multi(
                ST_CollectionExtract(
                  ST_MakeValid(gc.geom),
                  3
                )
              ),
              1
            )
          )::json AS geometry
        FROM grid_cells gc
        CROSS JOIN branch_geom bg
        WHERE gc.level_m = $2::integer
          AND gc.code IS NOT NULL
          AND btrim(gc.code) <> ''
          AND gc.code ~ $5::text
          AND gc.geom IS NOT NULL
          AND NOT ST_IsEmpty(gc.geom)
          AND ST_DWithin(
            gc.geom::geography,
            bg.geom::geography,
            $3::double precision
          )
      ),
      pocket_customers AS (
        SELECT
          catchment_pockets.pocket_id,
          COUNT(cpm.job_id)::int AS customer_count
        FROM catchment_pockets
        LEFT JOIN customer_pocket_mappings cpm
          ON cpm.job_id = $4
         AND cpm.nearest_branch_id = $1
         AND cpm.customer_lat >= catchment_pockets.min_lat
         AND cpm.customer_lat <= catchment_pockets.max_lat
         AND cpm.customer_lon >= catchment_pockets.min_lng
         AND cpm.customer_lon <= catchment_pockets.max_lng
        GROUP BY catchment_pockets.pocket_id
      )
      SELECT
        catchment_pockets.pocket_id,
        catchment_pockets.center_lat,
        catchment_pockets.center_lng,
        catchment_pockets.geometry,
        COALESCE(pocket_customers.customer_count, 0)::int AS customer_count
      FROM catchment_pockets
      LEFT JOIN pocket_customers
        ON pocket_customers.pocket_id = catchment_pockets.pocket_id
      ORDER BY catchment_pockets.pocket_id
    `,
    [
      branchId,
      effectiveLevelMeters,
      BRANCH_CATCHMENT_RADIUS_METERS,
      latestJobId,
      CANONICAL_POCKET_CODE_SQL_PATTERN
    ]
  );

  const pockets = pocketsResult.rows.map((row) => ({
    pocketId: String(row.pocket_id || '').trim(),
    centerLat: Number(row.center_lat),
    centerLng: Number(row.center_lng),
    customerCount: Math.max(Number(row.customer_count || 0), 0),
    geometry: row.geometry
  })).filter((pocket) =>
    pocket.pocketId
    && Number.isFinite(pocket.centerLat)
    && Number.isFinite(pocket.centerLng)
    && pocket.geometry
  );

  if (pockets.length === 0) {
    throw new AppError(
      `No ${effectiveLevelMeters}m master grid pockets were found inside the ${Math.round(BRANCH_CATCHMENT_RADIUS_METERS / 1000)}km catchment for branch ${branchId}. Populate grid_cells for this level before running allocation.`,
      422,
      'MASTER_GRID_CATCHMENT_EMPTY'
    );
  }

  if (pockets.length < employees.length) {
    throw new AppError(
      `Branch ${branchId} has ${employees.length} active employees but only ${pockets.length} eligible pockets at ${effectiveLevelMeters}m.`,
      422,
      'INSUFFICIENT_POCKETS_FOR_EMPLOYEES'
    );
  }

  const pocketById = new Map();
  pockets.forEach((pocket) => {
    const distanceFromBranch = haversineDistance(
      branchLat,
      branchLng,
      pocket.centerLat,
      pocket.centerLng
    );
    const angleDegrees = calculateClockwiseAngleDegrees(
      branchLat,
      branchLng,
      pocket.centerLat,
      pocket.centerLng
    );
    pocketById.set(pocket.pocketId, {
      ...pocket,
      distanceFromBranch,
      angleDegrees
    });
  });

  const adjacencyMap = buildPocketAdjacencyMap(pockets, effectiveLevelMeters, branchLat);
  const unassignedPocketIds = new Set(pockets.map((pocket) => pocket.pocketId));
  const assignmentByPocketId = new Map();
  const employeeCount = employees.length;
  const totalCustomers = pockets.reduce(
    (sum, pocket) => sum + Math.max(Number(pocket.customerCount || 0), 0),
    0
  );
  const targetCustomers = employeeCount > 0 ? totalCustomers / employeeCount : 0;
  const targetArea = employeeCount > 0 ? pockets.length / employeeCount : 0;
  const donutAreaSafeguardLimit = targetArea * 1.5;
  const diagnostics = [];

  const employeeStates = employees.map((employee) => ({
    ...employee,
    seedPocketId: null,
    seedCenterLat: branchLat,
    seedCenterLng: branchLng,
    currentCustomers: 0,
    currentArea: 0,
    frontier: new Set(),
    ownedPocketIds: new Set(),
    done: false,
    waiting: false
  }));

  const coreEmployeeState = employeeStates[0];
  const donutEmployeeStates = employeeStates.slice(1);

  const claimPocket = (employeeState, pocketId, claimType) => {
    if (!employeeState || !unassignedPocketIds.has(pocketId)) {
      return false;
    }

    const pocket = pocketById.get(pocketId);
    if (!pocket) {
      return false;
    }

    const beforeCustomers = Number(employeeState.currentCustomers || 0);
    unassignedPocketIds.delete(pocketId);
    assignmentByPocketId.set(pocketId, employeeState);
    employeeState.ownedPocketIds.add(pocketId);
    employeeState.currentCustomers = beforeCustomers + Number(pocket.customerCount || 0);
    employeeState.currentArea += 1;
    employeeState.frontier.delete(pocketId);

    const neighbors = adjacencyMap.get(pocketId);
    if (neighbors) {
      neighbors.forEach((neighborPocketId) => {
        if (unassignedPocketIds.has(neighborPocketId)) {
          employeeState.frontier.add(neighborPocketId);
        }
      });
    }

    diagnostics.push({
      iteration: diagnostics.length + 1,
      claim_type: claimType,
      employee_id: employeeState.employeeId,
      grid_cell_id: pocketId,
      account_count: Number(pocket.customerCount || 0),
      current_accounts_before: beforeCustomers,
      current_accounts_after: Number(employeeState.currentCustomers || 0),
      target_workload: Number(targetCustomers || 0),
      max_capacity: Number(targetCustomers || 0)
    });

    return true;
  };

  const pickClosestPocketToBranch = (candidatePocketIds) => {
    let selectedPocketId = null;
    let selectedDistance = Number.POSITIVE_INFINITY;

    candidatePocketIds.forEach((pocketId) => {
      const pocket = pocketById.get(pocketId);
      if (!pocket) {
        return;
      }
      const candidateDistance = Number(pocket.distanceFromBranch || 0);
      if (candidateDistance < selectedDistance) {
        selectedDistance = candidateDistance;
        selectedPocketId = pocketId;
        return;
      }
      if (
        candidateDistance === selectedDistance
        && selectedPocketId
        && String(pocketId).localeCompare(String(selectedPocketId)) < 0
      ) {
        selectedPocketId = pocketId;
      }
    });

    return selectedPocketId;
  };

  const pickClosestFrontierToBranch = (employeeState) => {
    const candidatePocketIds = new Set();
    employeeState.frontier.forEach((pocketId) => {
      if (unassignedPocketIds.has(pocketId)) {
        candidatePocketIds.add(pocketId);
      }
    });
    return pickClosestPocketToBranch(candidatePocketIds);
  };

  const refillFrontierForState = (employeeState) => {
    refillFrontierFromOwnedPockets(employeeState, adjacencyMap, unassignedPocketIds);
  };

  // Phase 1: Core (Employee 0)
  if (coreEmployeeState) {
    const coreSeedPocketId = pickClosestPocketToBranch(unassignedPocketIds);
    if (coreSeedPocketId) {
      const seedPocket = pocketById.get(coreSeedPocketId);
      coreEmployeeState.seedPocketId = coreSeedPocketId;
      coreEmployeeState.seedCenterLat = Number(seedPocket?.centerLat || branchLat);
      coreEmployeeState.seedCenterLng = Number(seedPocket?.centerLng || branchLng);
      claimPocket(coreEmployeeState, coreSeedPocketId, 'core_seed');

      while (
        unassignedPocketIds.size > 0
        && Number(coreEmployeeState.currentCustomers || 0) < targetCustomers
      ) {
        if (coreEmployeeState.frontier.size === 0) {
          refillFrontierForState(coreEmployeeState);
        }

        const nextPocketId = pickClosestFrontierToBranch(coreEmployeeState);
        if (!nextPocketId) {
          break;
        }
        claimPocket(coreEmployeeState, nextPocketId, 'core_growth');
      }
    }

    coreEmployeeState.done = true;
    coreEmployeeState.waiting = false;
  }

  // Phase 2: Donut seeds (Employees 1..N-1)
  if (donutEmployeeStates.length > 0 && unassignedPocketIds.size > 0) {
    const donutCount = donutEmployeeStates.length;
    donutEmployeeStates.forEach((employeeState, donutIndex) => {
      if (unassignedPocketIds.size === 0) {
        employeeState.waiting = true;
        return;
      }

      const targetAngle = normalizeCompassAngle((360 / donutCount) * donutIndex);
      let selectedPocketId = null;
      let selectedAngleDifference = Number.POSITIVE_INFINITY;
      let selectedDistanceFromBranch = Number.POSITIVE_INFINITY;

      unassignedPocketIds.forEach((candidatePocketId) => {
        const candidatePocket = pocketById.get(candidatePocketId);
        if (!candidatePocket) {
          return;
        }
        const angleDifference = calculateAngularDifferenceDegrees(
          Number(candidatePocket.angleDegrees || 0),
          targetAngle
        );
        const distanceFromBranch = Number(candidatePocket.distanceFromBranch || 0);

        if (angleDifference < selectedAngleDifference) {
          selectedAngleDifference = angleDifference;
          selectedDistanceFromBranch = distanceFromBranch;
          selectedPocketId = candidatePocketId;
          return;
        }
        if (
          angleDifference === selectedAngleDifference
          && distanceFromBranch < selectedDistanceFromBranch
        ) {
          selectedDistanceFromBranch = distanceFromBranch;
          selectedPocketId = candidatePocketId;
          return;
        }
        if (
          angleDifference === selectedAngleDifference
          && distanceFromBranch === selectedDistanceFromBranch
          && selectedPocketId
          && String(candidatePocketId).localeCompare(String(selectedPocketId)) < 0
        ) {
          selectedPocketId = candidatePocketId;
        }
      });

      if (!selectedPocketId) {
        employeeState.waiting = true;
        return;
      }

      const seedPocket = pocketById.get(selectedPocketId);
      employeeState.seedPocketId = selectedPocketId;
      employeeState.seedCenterLat = Number(seedPocket?.centerLat || branchLat);
      employeeState.seedCenterLng = Number(seedPocket?.centerLng || branchLng);
      claimPocket(employeeState, selectedPocketId, 'donut_seed');
      employeeState.waiting = false;
      employeeState.done = false;
    });
  }

  // Phase 3: Donut expansion
  let donutExpansionProgress = true;
  while (unassignedPocketIds.size > 0 && donutExpansionProgress) {
    donutExpansionProgress = false;
    let activeDonutEmployees = 0;

    donutEmployeeStates.forEach((employeeState) => {
      if (!employeeState.seedPocketId || employeeState.done || employeeState.waiting) {
        return;
      }
      activeDonutEmployees += 1;

      const customerProgress = targetCustomers > 0
        ? (Number(employeeState.currentCustomers || 0) / targetCustomers)
        : 1;
      const areaProgress = targetArea > 0
        ? (Number(employeeState.currentArea || 0) / targetArea)
        : 1;
      const blendedScore = (customerProgress * 0.5) + (areaProgress * 0.5);
      if (
        blendedScore >= 1.0
        || Number(employeeState.currentArea || 0) >= donutAreaSafeguardLimit
      ) {
        employeeState.done = true;
        return;
      }

      if (employeeState.frontier.size === 0) {
        refillFrontierForState(employeeState);
      }

      const nextPocketId = pickNearestFrontierPocket(
        employeeState,
        pocketById,
        unassignedPocketIds
      );
      if (!nextPocketId) {
        employeeState.waiting = true;
        return;
      }

      if (claimPocket(employeeState, nextPocketId, 'donut_growth')) {
        donutExpansionProgress = true;
      }
    });

    if (activeDonutEmployees === 0) {
      break;
    }
  }

  // Phase 4: Orphan cleanup (donut reps only; core stays locked)
  donutEmployeeStates.forEach((employeeState) => {
    if (!employeeState.seedPocketId) {
      return;
    }
    employeeState.done = false;
    employeeState.waiting = false;
  });

  let donutCleanupProgress = true;
  while (unassignedPocketIds.size > 0 && donutCleanupProgress) {
    donutCleanupProgress = false;

    donutEmployeeStates.forEach((employeeState) => {
      if (!employeeState.seedPocketId) {
        return;
      }
      if (employeeState.frontier.size === 0) {
        refillFrontierForState(employeeState);
      }

      const nextPocketId = pickNearestFrontierPocket(
        employeeState,
        pocketById,
        unassignedPocketIds
      );
      if (!nextPocketId) {
        return;
      }

      if (claimPocket(employeeState, nextPocketId, 'donut_cleanup')) {
        donutCleanupProgress = true;
      }
    });
  }

  let isolatedPocketAssignments = 0;
  if (unassignedPocketIds.size > 0) {
    const donutOwners = donutEmployeeStates.filter(
      (employeeState) => employeeState.ownedPocketIds.size > 0
    );

    Array.from(unassignedPocketIds).forEach((orphanPocketId) => {
      const orphanPocket = pocketById.get(orphanPocketId);
      if (!orphanPocket) {
        return;
      }

      let nearestDonutOwner = donutOwners[0] || null;
      let nearestDistance = Number.POSITIVE_INFINITY;

      assignmentByPocketId.forEach((ownerState, assignedPocketId) => {
        if (!ownerState || ownerState === coreEmployeeState) {
          return;
        }
        const assignedPocket = pocketById.get(assignedPocketId);
        if (!assignedPocket) {
          return;
        }
        const distanceMeters = haversineDistance(
          Number(orphanPocket.centerLat),
          Number(orphanPocket.centerLng),
          Number(assignedPocket.centerLat),
          Number(assignedPocket.centerLng)
        );
        if (!Number.isFinite(distanceMeters) || distanceMeters >= nearestDistance) {
          return;
        }
        nearestDistance = distanceMeters;
        nearestDonutOwner = ownerState;
      });

      if (!nearestDonutOwner && coreEmployeeState) {
        nearestDonutOwner = coreEmployeeState;
      }

      if (claimPocket(nearestDonutOwner, orphanPocketId, 'donut_orphan_fallback')) {
        isolatedPocketAssignments += 1;
      }
    });
  }

  if (unassignedPocketIds.size > 0 && coreEmployeeState) {
    Array.from(unassignedPocketIds).forEach((pocketId) => {
      claimPocket(coreEmployeeState, pocketId, 'core_safety_fallback');
    });
  }

  // --- ORIGINAL BACKUP ---
  // const assignmentRows = pockets.map((pocket) => {
  //   const ownerState = assignmentByPocketId.get(pocket.pocketId) || coreEmployeeState || employeeStates[0];
  //   return {
  //     pocket_id: pocket.pocketId,
  //     employee_id: ownerState?.employeeId || null,
  //     account_count: Math.max(Number(pocket.customerCount || 0), 0),
  //     geometry: pocket.geometry
  //   };
  // });
  let aggressiveVacuumAssignments = 0;
  const fallbackOwnerState = coreEmployeeState || employeeStates[0] || null;

  pockets.forEach((unassignedPocketCandidate) => {
    const unassignedPocketId = String(unassignedPocketCandidate?.pocketId || '').trim();
    if (!unassignedPocketId) {
      return;
    }
    if (assignmentByPocketId.has(unassignedPocketId)) {
      return;
    }

    let nearestOwnerState = null;
    let nearestDistanceMeters = Number.POSITIVE_INFINITY;

    assignmentByPocketId.forEach((ownerState, assignedPocketId) => {
      if (!ownerState) {
        return;
      }
      const assignedPocket = pocketById.get(assignedPocketId);
      if (!assignedPocket) {
        return;
      }

      const distanceMeters = haversineDistance(
        Number(unassignedPocketCandidate.centerLat),
        Number(unassignedPocketCandidate.centerLng),
        Number(assignedPocket.centerLat),
        Number(assignedPocket.centerLng)
      );
      if (!Number.isFinite(distanceMeters) || distanceMeters >= nearestDistanceMeters) {
        return;
      }

      nearestDistanceMeters = distanceMeters;
      nearestOwnerState = ownerState;
    });

    const resolvedOwnerState = nearestOwnerState || fallbackOwnerState;
    if (!resolvedOwnerState) {
      return;
    }

    const claimedWithStandardFlow = claimPocket(
      resolvedOwnerState,
      unassignedPocketId,
      'aggressive_vacuum'
    );

    if (!claimedWithStandardFlow) {
      const beforeCustomers = Number(resolvedOwnerState.currentCustomers || 0);
      assignmentByPocketId.set(unassignedPocketId, resolvedOwnerState);
      resolvedOwnerState.ownedPocketIds.add(unassignedPocketId);
      resolvedOwnerState.currentCustomers = beforeCustomers
        + Number(unassignedPocketCandidate.customerCount || 0);
      resolvedOwnerState.currentArea += 1;
      resolvedOwnerState.frontier.delete(unassignedPocketId);
      unassignedPocketIds.delete(unassignedPocketId);

      diagnostics.push({
        iteration: diagnostics.length + 1,
        claim_type: 'aggressive_vacuum_force',
        employee_id: resolvedOwnerState.employeeId,
        grid_cell_id: unassignedPocketId,
        account_count: Number(unassignedPocketCandidate.customerCount || 0),
        current_accounts_before: beforeCustomers,
        current_accounts_after: Number(resolvedOwnerState.currentCustomers || 0),
        target_workload: Number(targetCustomers || 0),
        max_capacity: Number(targetCustomers || 0)
      });
    }

    aggressiveVacuumAssignments += 1;
  });

  isolatedPocketAssignments += aggressiveVacuumAssignments;

  const assignmentRows = pockets.map((pocket) => {
    const ownerState = assignmentByPocketId.get(pocket.pocketId) || fallbackOwnerState;
    return {
      pocket_id: pocket.pocketId,
      employee_id: ownerState?.employeeId || null,
      account_count: Math.max(Number(pocket.customerCount || 0), 0),
      geometry: pocket.geometry
    };
  });

  return {
    assignmentLevelMeters: effectiveLevelMeters,
    targetCustomers,
    targetArea,
    totalCustomers,
    totalPockets: pockets.length,
    isolatedPocketAssignments,
    assignmentRows,
    diagnostics
  };
};

const materializeClockwiseContiguousAllocation = async (
  client,
  branchId,
  allocationResult
) => {
  const assignmentRows = Array.isArray(allocationResult?.assignmentRows)
    ? allocationResult.assignmentRows
    : [];
  if (assignmentRows.length === 0) {
    throw new AppError(
      `Clockwise contiguous allocation produced no assignments for branch ${branchId}.`,
      422,
      'ALLOCATION_EMPTY'
    );
  }
  const assignmentLevelMeters = Number(allocationResult?.assignmentLevelMeters || 0)
    || DEFAULT_PERSISTENT_TERRITORY_LEVEL_METERS;
  const assignmentLevelKm = resolveEmployeeGridLevelKm(
    assignmentLevelMeters,
    DEFAULT_PERSISTENT_TERRITORY_LEVEL_METERS
  );

  await client.query(
    `
      DELETE FROM ${EMPLOYEE_GRID_CELL_TABLE}
      WHERE branch_id = $1
        AND COALESCE(level_km, 1) = $2::integer
    `,
    [branchId, assignmentLevelKm]
  );

  await client.query(
    `
      INSERT INTO ${EMPLOYEE_GRID_CELL_TABLE} (
        branch_id,
        pocket_id,
        level_km,
        account_count,
        assigned_employee_id,
        geom
      )
      SELECT
        $1::varchar AS branch_id,
        assignments.pocket_id::varchar,
        $3::integer AS level_km,
        GREATEST(COALESCE(assignments.account_count, 0), 0)::integer AS account_count,
        assignments.employee_id::varchar AS assigned_employee_id,
        ST_GeometryN(
          ST_Multi(
            ST_CollectionExtract(
              ST_MakeValid(
                ST_SetSRID(
                  ST_GeomFromGeoJSON(assignments.geometry::text),
                  4326
                )
              ),
              3
            )
          ),
          1
        )::geometry(POLYGON, 4326) AS geom
      FROM jsonb_to_recordset($2::jsonb) AS assignments(
        pocket_id text,
        employee_id text,
        account_count integer,
        geometry jsonb
      )
      `,
    [branchId, JSON.stringify(assignmentRows), assignmentLevelKm]
  );

  await client.query(
    `
      CREATE TEMP TABLE tmp_employee_territory_assignment ON COMMIT DROP AS
      SELECT
        egc.branch_id,
        egc.id::text AS grid_cell_id,
        egc.assigned_employee_id AS employee_id,
        GREATEST(COALESCE(egc.account_count, 0), 0)::int AS account_count,
        ST_Multi(
          ST_CollectionExtract(
            ST_MakeValid(egc.geom),
            3
          )
        )::geometry(MULTIPOLYGON, 4326) AS geom
      FROM ${EMPLOYEE_GRID_CELL_TABLE} egc
      WHERE egc.branch_id = $1
        AND COALESCE(egc.level_km, 1) = $2::integer
    `,
    [branchId, assignmentLevelKm]
  );

  await client.query(
    `
      CREATE TEMP TABLE tmp_employee_territory_diagnostics (
        iteration INTEGER NOT NULL,
        claim_type TEXT NOT NULL,
        employee_id VARCHAR(50) NOT NULL,
        grid_cell_id TEXT NOT NULL,
        account_count INTEGER NOT NULL,
        current_accounts_before NUMERIC NOT NULL,
        current_accounts_after NUMERIC NOT NULL,
        target_workload NUMERIC NOT NULL,
        max_capacity NUMERIC NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ON COMMIT DROP
    `
  );

  if (Array.isArray(allocationResult?.diagnostics) && allocationResult.diagnostics.length > 0) {
    await client.query(
      `
        INSERT INTO tmp_employee_territory_diagnostics (
          iteration,
          claim_type,
          employee_id,
          grid_cell_id,
          account_count,
          current_accounts_before,
          current_accounts_after,
          target_workload,
          max_capacity
        )
        SELECT
          diagnostics.iteration::int,
          diagnostics.claim_type::text,
          diagnostics.employee_id::varchar,
          diagnostics.grid_cell_id::text,
          diagnostics.account_count::int,
          diagnostics.current_accounts_before::numeric,
          diagnostics.current_accounts_after::numeric,
          diagnostics.target_workload::numeric,
          diagnostics.max_capacity::numeric
        FROM jsonb_to_recordset($1::jsonb) AS diagnostics(
          iteration integer,
          claim_type text,
          employee_id text,
          grid_cell_id text,
          account_count integer,
          current_accounts_before numeric,
          current_accounts_after numeric,
          target_workload numeric,
          max_capacity numeric
        )
      `,
      [JSON.stringify(allocationResult.diagnostics)]
    );
  }
};

/**
 * POST /api/v1/batch/territory-allocate
 * Run residence-seeded or bucket-aware territory allocation.
 */
router.post(
  '/territory-allocate',
  asyncHandler(async (req, res) => {
    const payload = await transaction(async (client) => handleTerritoryAllocate(req, client));
    res.json(payload);
  })
);

/**
 * Shared handler for employee territory allocation.
 * Supports:
 * - POST /api/v1/batch/territories/assign/:branchId (legacy)
 * - POST /api/v1/batch/territories/run-allocation/:branchId (batch trigger)
 */
const assignEmployeeTerritoriesHandler = asyncHandler(async (req, res) => {
    const branchId = String(req.params.branchId || '').trim();
    if (!branchId) {
      throw new AppError('Branch ID is required', 400, 'MISSING_BRANCH_ID');
    }
    const isRunAllocationEndpoint = String(req.path || '').includes('/run-allocation/');

    const tolerance = parseTerritoryTolerance(
      req.body?.tolerance ?? req.query?.tolerance
    );
    const employeeCount = isRunAllocationEndpoint
      ? null
      : parseDynamicEmployeeCount(
        req.body?.employeeCount ?? req.query?.employeeCount
      );
    const useExistingTerritoriesOnly = parseBooleanFlag(
      req.body?.useExistingTerritoriesOnly ?? req.query?.useExistingTerritoriesOnly,
      isRunAllocationEndpoint
    );
    const forceRepair = parseBooleanFlag(
      req.body?.forceRepair ?? req.query?.forceRepair,
      false
    );
    const requestedPersistentLevelMeters =
      req.body?.level_m
      ?? req.body?.levelM
      ?? req.query?.level_m
      ?? req.query?.levelM;
    const normalizedRequestedPersistentLevelMeters = Number.isFinite(Number(requestedPersistentLevelMeters))
      ? Math.round(Number(requestedPersistentLevelMeters))
      : null;
    const scopedTier2GenerationLevels = (
      Number.isFinite(Number(normalizedRequestedPersistentLevelMeters))
      && TIER2_GRID_LEVELS_METERS.includes(Number(normalizedRequestedPersistentLevelMeters))
    )
      ? [Number(normalizedRequestedPersistentLevelMeters)]
      : [...TIER2_GRID_LEVELS_METERS];

    const branchExistsResult = await query(
      'SELECT id, city FROM branches WHERE id = $1',
      [branchId]
    );

    if (branchExistsResult.rows.length === 0) {
      throw new AppError('Branch not found', 404, 'BRANCH_NOT_FOUND');
    }

    const effectiveJobId = await resolveLatestMappingsJobId();
    if (!effectiveJobId) {
      throw new AppError(
        'No customer mappings available. Upload and process mappings before assigning employee territories.',
        404,
        'NO_MAPPINGS'
      );
    }

    const configResult = await query(
      `
        SELECT
          version,
          origin_lat,
          origin_lon,
          alphabet,
          grid_levels
        FROM config
        WHERE id = 1
      `
    );
    if (configResult.rows.length === 0) {
      throw new AppError(
        'System pocket configuration is not initialized. Configure origin/alphabet/grid levels before assignment.',
        503,
        'POCKET_CONFIG_UNAVAILABLE'
      );
    }

    const activePocketConfig = {
      configVersion: Number(configResult.rows[0].version || 1),
      originLat: Number(configResult.rows[0].origin_lat),
      originLon: Number(configResult.rows[0].origin_lon),
      alphabet: String(configResult.rows[0].alphabet || ''),
      gridLevels: configResult.rows[0].grid_levels
    };

    const runAssignmentTransaction = async (enforceContiguity) =>
      transaction(async (client) => {
        await acquireBranchTerritoryLock(client, branchId);

        // --- ORIGINAL BACKUP ---
        // const resolvedPersistentLevelMeters = useExistingTerritoriesOnly
        //   ? await resolvePersistentTerritoryLevelMeters(client, requestedPersistentLevelMeters)
        //   : null;
        // --- ORIGINAL BACKUP ---
        // await ensureTier2MasterTilesAroundBranches(client, activePocketConfig);
        // --- ORIGINAL BACKUP ---
        // await ensureTier2MasterTilesAroundBranches(client, activePocketConfig, {
        //   branchIds: [branchId],
        //   levels: scopedTier2GenerationLevels
        // });
        await ensureTier2MasterTilesAroundBranches(client, activePocketConfig, {
          branchIds: [branchId],
          levels: scopedTier2GenerationLevels,
          force: forceRepair
        });

        // --- ORIGINAL BACKUP ---
        // const resolvedPersistentLevelMeters = useExistingTerritoriesOnly
        //   ? await resolvePersistentTerritoryLevelMeters(client, requestedPersistentLevelMeters)
        //   : null;
        const resolvedPersistentLevelMeters = (useExistingTerritoriesOnly || forceRepair)
          ? await resolvePersistentTerritoryLevelMeters(client, requestedPersistentLevelMeters)
          : null;

        let forceRepairState = null;
        if (forceRepair) {
          forceRepairState = await clearBranchPersistentTerritoryState(
            client,
            branchId,
            resolvedPersistentLevelMeters
          );
        }

        // --- ORIGINAL BACKUP ---
        // const branchCoverage = useExistingTerritoriesOnly
        //   ? await ensureBranchCatchmentCoverage(
        //     client,
        //     branchId,
        //     resolvedPersistentLevelMeters
        //   )
        //   : null;
        const branchCoverage = useExistingTerritoriesOnly && !forceRepair
          ? await ensureBranchCatchmentCoverage(
            client,
            branchId,
            resolvedPersistentLevelMeters
          )
          : null;
        // --- ORIGINAL BACKUP ---
        // const persistentCoverageUnavailable = useExistingTerritoriesOnly
        //   && Number(branchCoverage?.catchmentGridCount || 0) === 0;
        const persistentCoverageUnavailable = useExistingTerritoriesOnly
          && !forceRepair
          && Number(branchCoverage?.catchmentGridCount || 0) === 0;
        // --- ORIGINAL BACKUP ---
        // const shouldUsePersistentTerritories = useExistingTerritoriesOnly && !persistentCoverageUnavailable;
        const shouldUsePersistentTerritories = useExistingTerritoriesOnly
          && !forceRepair
          && !persistentCoverageUnavailable;
        // --- ORIGINAL BACKUP ---
        // const fallbackReason = persistentCoverageUnavailable
        //   ? `No ${Number(resolvedPersistentLevelMeters || 0)}m master grid pockets were found inside the 40km catchment for branch ${branchId}. Falling back to customer-pocket allocation for this run.`
        //   : null;
        const fallbackReason = persistentCoverageUnavailable
          ? `No ${Number(resolvedPersistentLevelMeters || 0)}m master grid pockets were found inside the ${Math.round(BRANCH_CATCHMENT_RADIUS_METERS / 1000)}km catchment for branch ${branchId}. Falling back to customer-pocket allocation for this run.`
          : null;

        if (persistentCoverageUnavailable) {
          logger.warn('Persistent territory catchment unavailable; falling back to customer-pocket allocation', {
            branchId,
            requestedLevelMeters: Number(resolvedPersistentLevelMeters || 0),
            catchmentGridCount: Number(branchCoverage?.catchmentGridCount || 0)
          });
        }

        const geometryAlignment = shouldUsePersistentTerritories
          ? await refreshBranchEmployeeGridCellsFromPersistentTerritories(
            client,
            branchId,
            effectiveJobId,
            resolvedPersistentLevelMeters
          )
          : await refreshBranchEmployeeGridCells(
            client,
            branchId,
            effectiveJobId,
            activePocketConfig
          );

        let forceRepairPruneState = null;
        if (forceRepair) {
          forceRepairPruneState = await pruneBranchEmployeeGridCellsToCatchment(
            client,
            branchId,
            geometryAlignment.assignmentLevelMeters
          );
        }

        // --- ORIGINAL BACKUP ---
        // let normalizedBranchCoverage;
        let normalizedBranchCoverage;
        if (shouldUsePersistentTerritories) {
          normalizedBranchCoverage = {
            assignmentLevelMeters: Number(branchCoverage?.assignmentLevelMeters || geometryAlignment.assignmentLevelMeters || 0),
            generatedCandidateCount: Number(branchCoverage?.generatedCandidateCount || 0),
            insertedMasterCount: Number(branchCoverage?.insertedMasterCount || 0),
            catchmentGridCount: Number(branchCoverage?.catchmentGridCount || 0),
            removedOutsideCount: Number(branchCoverage?.removedOutsideCount || 0),
            upsertedBranchCount: Number(branchCoverage?.upsertedBranchCount || 0),
            skipped: false,
            reason: null
          };
        // --- ORIGINAL BACKUP ---
        // } else if (useExistingTerritoriesOnly) {
        } else if (useExistingTerritoriesOnly && !forceRepair) {
          normalizedBranchCoverage = {
            assignmentLevelMeters: Number(resolvedPersistentLevelMeters || geometryAlignment.assignmentLevelMeters || 0),
            generatedCandidateCount: Number(branchCoverage?.generatedCandidateCount || 0),
            insertedMasterCount: Number(branchCoverage?.insertedMasterCount || 0),
            catchmentGridCount: Number(branchCoverage?.catchmentGridCount || 0),
            removedOutsideCount: Number(branchCoverage?.removedOutsideCount || 0),
            upsertedBranchCount: Number(branchCoverage?.upsertedBranchCount || 0),
            skipped: true,
            reason: fallbackReason
          };
        } else {
          normalizedBranchCoverage = await ensureBranchCatchmentCoverage(
            client,
            branchId,
            geometryAlignment.assignmentLevelMeters
          );
        }
        await client.query('DROP TABLE IF EXISTS tmp_employee_territory_assignment');
        await client.query('DROP TABLE IF EXISTS tmp_employee_territory_diagnostics');

        // --- ORIGINAL BACKUP ---
        // await client.query(
        //   `
        //     CREATE TEMP TABLE tmp_employee_territory_assignment ON COMMIT DROP AS
        //     SELECT *
        //     FROM assign_employee_territories(
        //       $1::varchar,
        //       $2::numeric,
        //       $3::integer,
        //       $4::boolean
        //     )
        //   `,
        //   [branchId, tolerance, employeeCount, enforceContiguity]
        // );
        // --- ORIGINAL BACKUP ---
        // const clockwiseAllocation = await runClockwiseSeededContiguousAllocation(
        //   client,
        //   {
        //     branchId,
        //     levelMeters: geometryAlignment.assignmentLevelMeters,
        //     latestJobId: effectiveJobId
        //   }
        // );
        const clockwiseAllocation = await runCoreAndDonutAllocation(
          client,
          {
            branchId,
            levelMeters: geometryAlignment.assignmentLevelMeters,
            latestJobId: effectiveJobId
          }
        );
        await materializeClockwiseContiguousAllocation(
          client,
          branchId,
          clockwiseAllocation
        );

        // --- ORIGINAL BACKUP ---
        // const emptyGridFill = useExistingTerritoriesOnly
        //   ? {
        //     candidateCount: 0,
        //     insertedCount: 0,
        //     skipped: true,
        //     reason: 'EXISTING_BRANCH_TERRITORIES_ONLY',
        //     candidateSource: 'persistent_branch_territories',
        //     populatedReferenceCount: Number(geometryAlignment.totalPocketCount || 0),
        //     catchmentGridCount: Number(geometryAlignment.totalPocketCount || 0),
        //     hasMasterGridLevel: true,
        //     assignmentLevelMeters: Number(geometryAlignment.assignmentLevelMeters || 0),
        //     generatedFallbackUsed: false
        //   }
        //   : await fillBranchTerritoryEmptyGridCoverage(
        //     client,
        //     branchId,
        //     effectiveJobId,
        //     geometryAlignment.assignmentLevelMeters
        //   );
        const emptyGridFill = useExistingTerritoriesOnly && !forceRepair
          ? {
            candidateCount: 0,
            insertedCount: 0,
            skipped: true,
            reason: 'EXISTING_BRANCH_TERRITORIES_ONLY',
            candidateSource: 'persistent_branch_territories',
            populatedReferenceCount: Number(geometryAlignment.totalPocketCount || 0),
            catchmentGridCount: Number(geometryAlignment.totalPocketCount || 0),
            hasMasterGridLevel: true,
            assignmentLevelMeters: Number(geometryAlignment.assignmentLevelMeters || 0),
            generatedFallbackUsed: false
          }
          : await fillBranchTerritoryEmptyGridCoverage(
            client,
            branchId,
            effectiveJobId,
            geometryAlignment.assignmentLevelMeters
          );

        const persistentTerritories = await persistBranchEmployeeTerritories(
          client,
          branchId,
          geometryAlignment.assignmentLevelMeters
        );
        // --- ORIGINAL BACKUP ---
        // const pocketsResult = await client.query(
        const twoWaySync = await runTwoWayAllocationSync(
          client,
          branchId,
          geometryAlignment.assignmentLevelMeters,
          effectiveJobId
        );

        const pocketsResult = await client.query(
          `
            SELECT
              assignment.branch_id,
              assignment.grid_cell_id,
              COALESCE(egc.pocket_id::text, assignment.grid_cell_id)::text AS pocket_id,
              assignment.employee_id,
              assignment.account_count::int AS account_count,
              assignment.account_count::int AS customer_count,
              assignment.account_count::int AS selected_branch_customer_count,
              0::int AS other_branch_customer_count,
              ST_AsGeoJSON(assignment.geom)::json AS geometry
            FROM tmp_employee_territory_assignment assignment
            LEFT JOIN ${EMPLOYEE_GRID_CELL_TABLE} egc
              ON egc.branch_id = assignment.branch_id
             AND egc.id::text = assignment.grid_cell_id
            ORDER BY assignment.employee_id NULLS LAST, assignment.grid_cell_id
          `
        );

        const territoriesResult = await client.query(
          `
            SELECT
              employee_id,
              COUNT(*)::int AS pocket_count,
              COALESCE(SUM(account_count), 0)::int AS total_accounts,
              ST_AsGeoJSON(ST_Multi(ST_Union(geom)))::json AS geometry
            FROM tmp_employee_territory_assignment
            GROUP BY employee_id
            ORDER BY employee_id NULLS LAST
          `
        );

        const summaryResult = await client.query(
          `
            SELECT
              COUNT(*)::int AS total_pockets,
              COUNT(DISTINCT employee_id)::int AS assigned_employees,
              COALESCE(SUM(account_count), 0)::int AS total_accounts
            FROM tmp_employee_territory_assignment
          `
        );

        let diagnosticsRows = [];
        try {
          const diagnosticsResult = await client.query(
            `
              SELECT
                iteration::int AS iteration,
                claim_type,
                employee_id,
                grid_cell_id,
                account_count::int AS account_count,
                current_accounts_before::numeric AS current_accounts_before,
                current_accounts_after::numeric AS current_accounts_after,
                target_workload::numeric AS target_workload,
                max_capacity::numeric AS max_capacity
              FROM tmp_employee_territory_diagnostics
              ORDER BY iteration, created_at, employee_id, grid_cell_id
            `
          );
          diagnosticsRows = diagnosticsResult.rows;
        } catch (diagnosticsError) {
          if (!diagnosticsError || diagnosticsError.code !== '42P01') {
            throw diagnosticsError;
          }
        }

        // --- ORIGINAL BACKUP ---
        // return {
        //   pockets: pocketsResult.rows,
        //   territories: territoriesResult.rows,
        //   diagnostics: diagnosticsRows,
        //   branchCoverage: normalizedBranchCoverage,
        //   emptyGridFill,
        //   persistentTerritories,
        //   geometryAlignment,
        //   summary: summaryResult.rows[0] || {
        //     total_pockets: 0,
        //     assigned_employees: 0,
        //     total_accounts: 0
        //   },
        //   contiguityRelaxed: !enforceContiguity
        // };
        return {
          pockets: pocketsResult.rows,
          territories: territoriesResult.rows,
          diagnostics: diagnosticsRows,
          forceRepairState,
          forceRepairPruneState,
          branchCoverage: normalizedBranchCoverage,
          emptyGridFill,
          persistentTerritories,
          twoWaySync,
          clockwiseAllocation: {
            assignmentLevelMeters: Number(clockwiseAllocation?.assignmentLevelMeters || 0),
            totalCustomers: Number(clockwiseAllocation?.totalCustomers || 0),
            totalPockets: Number(clockwiseAllocation?.totalPockets || 0),
            targetCustomers: Number(clockwiseAllocation?.targetCustomers || 0),
            targetArea: Number(clockwiseAllocation?.targetArea || 0),
            isolatedPocketAssignments: Number(clockwiseAllocation?.isolatedPocketAssignments || 0)
          },
          geometryAlignment,
          summary: summaryResult.rows[0] || {
            total_pockets: 0,
            assigned_employees: 0,
            total_accounts: 0
          },
          // --- ORIGINAL BACKUP ---
          // contiguityRelaxed: !enforceContiguity
          contiguityRelaxed: !enforceContiguity || Number(clockwiseAllocation?.isolatedPocketAssignments || 0) > 0
        };
      });

    const mapAssignmentInitializationError = (error) => {
      if (error && error.code === '42883' && String(error.message || '').includes('assign_employee_territories')) {
        return new AppError(
          'Employee territory assignment function is not initialized in the database. Apply the territory assignment migration before using this endpoint.',
          503,
          'EMPLOYEE_ASSIGNMENT_NOT_INITIALIZED'
        );
      }

      if (error && (error.code === '42P01' || error.code === '42703')) {
        const message = String(error.message || '').toLowerCase();
        if (
          message.includes(BRANCH_TERRITORY_TABLE)
          || message.includes(EMPLOYEE_TERRITORY_TABLE)
          || message.includes('branch_employee_id')
          || message.includes('branch_employees')
        ) {
          return new AppError(
            'Persistent territory tables are not initialized. Apply the persistent territory migration before using this endpoint.',
            503,
            'PERSISTENT_TERRITORY_TABLES_NOT_INITIALIZED'
          );
        }
      }
      return error;
    };

    let assignmentPayload;
    try {
      assignmentPayload = await runAssignmentTransaction(true);
    } catch (error) {
      throw mapAssignmentInitializationError(error);
    }

    const persistedPayload = await transaction(async (client) =>
      fetchPersistentBranchTerritoryPayload(
        client,
        branchId,
        assignmentPayload.geometryAlignment.assignmentLevelMeters
      )
    );

    const pocketsFeatureCollection = persistedPayload.pockets || buildEmptyFeatureCollection();
    const territoriesFeatureCollection = persistedPayload.territories || buildEmptyFeatureCollection();

    const assignmentDiagnostics = buildAssignmentDiagnosticsPayload(
      assignmentPayload.diagnostics
    );

    res.json({
      branchId,
      branchCity: branchExistsResult.rows[0].city || '',
      employeeCount: Number(
        employeeCount || assignmentPayload.summary.assigned_employees || 0
      ),
      useExistingTerritoriesOnly,
      forceRepair,
      tolerance,
      contiguityRelaxed: Boolean(assignmentPayload.contiguityRelaxed),
      forceRepairState: {
        assignmentLevelMeters: Number(assignmentPayload.forceRepairState?.assignmentLevelMeters || 0),
        deletedEmployeeAssignments: Number(assignmentPayload.forceRepairState?.deletedEmployeeAssignments || 0),
        deletedBranchTerritories: Number(assignmentPayload.forceRepairState?.deletedBranchTerritories || 0),
        clearedGridCells: Number(assignmentPayload.forceRepairState?.clearedGridCells || 0)
      },
      forceRepairPruneState: {
        assignmentLevelMeters: Number(assignmentPayload.forceRepairPruneState?.assignmentLevelMeters || 0),
        removedRows: Number(assignmentPayload.forceRepairPruneState?.removedRows || 0),
        remainingRows: Number(assignmentPayload.forceRepairPruneState?.remainingRows || 0)
      },
      emptyGridFill: {
        candidateCount: Number(assignmentPayload.emptyGridFill?.candidateCount || 0),
        insertedCount: Number(assignmentPayload.emptyGridFill?.insertedCount || 0),
        skipped: Boolean(assignmentPayload.emptyGridFill?.skipped),
        reason: assignmentPayload.emptyGridFill?.reason || null,
        candidateSource: assignmentPayload.emptyGridFill?.candidateSource || null,
        populatedReferenceCount: Number(assignmentPayload.emptyGridFill?.populatedReferenceCount || 0),
        catchmentGridCount: Number(assignmentPayload.emptyGridFill?.catchmentGridCount || 0),
        hasMasterGridLevel: Boolean(assignmentPayload.emptyGridFill?.hasMasterGridLevel),
        assignmentLevelMeters: Number(assignmentPayload.emptyGridFill?.assignmentLevelMeters || 0),
        generatedFallbackUsed: Boolean(assignmentPayload.emptyGridFill?.generatedFallbackUsed)
      },
      geometryAlignment: {
        totalPockets: Number(assignmentPayload.geometryAlignment?.totalPocketCount || 0),
        masterGeometryCount: Number(assignmentPayload.geometryAlignment?.masterGeometryCount || 0),
        fallbackGeometryCount: Number(assignmentPayload.geometryAlignment?.fallbackGeometryCount || 0),
        assignmentLevelMeters: Number(assignmentPayload.geometryAlignment?.assignmentLevelMeters || 0),
        strictAlignment: Number(assignmentPayload.geometryAlignment?.fallbackGeometryCount || 0) === 0
      },
      branchCoverage: {
        assignmentLevelMeters: Number(assignmentPayload.branchCoverage?.assignmentLevelMeters || 0),
        generatedCandidateCount: Number(assignmentPayload.branchCoverage?.generatedCandidateCount || 0),
        insertedMasterCount: Number(assignmentPayload.branchCoverage?.insertedMasterCount || 0),
        catchmentGridCount: Number(assignmentPayload.branchCoverage?.catchmentGridCount || 0),
        removedOutsideCount: Number(assignmentPayload.branchCoverage?.removedOutsideCount || 0),
        upsertedBranchCount: Number(assignmentPayload.branchCoverage?.upsertedBranchCount || 0)
      },
      persistentTerritories: {
        assignmentLevelMeters: Number(assignmentPayload.persistentTerritories?.assignmentLevelMeters || 0),
        deletedEmployeeAssignments: Number(assignmentPayload.persistentTerritories?.deletedEmployeeAssignments || 0),
        deletedBranchTerritories: Number(assignmentPayload.persistentTerritories?.deletedBranchTerritories || 0),
        insertedBranchTerritories: Number(assignmentPayload.persistentTerritories?.insertedBranchTerritories || 0),
        insertedEmployeeTerritories: Number(assignmentPayload.persistentTerritories?.insertedEmployeeTerritories || 0)
      },
      // --- ORIGINAL BACKUP ---
      // assignmentDiagnostics,
      twoWaySync: {
        assignmentLevelMeters: Number(assignmentPayload.twoWaySync?.assignmentLevelMeters || 0),
        clearedGridCells: Number(assignmentPayload.twoWaySync?.clearedGridCells || 0),
        allocatedGridCells: Number(assignmentPayload.twoWaySync?.allocatedGridCells || 0),
        syncedEmployeePockets: Number(assignmentPayload.twoWaySync?.syncedEmployeePockets || 0),
        syncedCustomerCounts: Number(assignmentPayload.twoWaySync?.syncedCustomerCounts || 0)
      },
      assignmentDiagnostics,
      summary: {
        totalPockets: Number(persistedPayload.summary?.totalPockets || 0),
        assignedEmployees: Number(persistedPayload.summary?.assignedEmployees || 0),
        totalAccounts: Number(persistedPayload.summary?.totalAccounts || 0),
        mergedTerritories: territoriesFeatureCollection.features.length
      },
      warnings: assignmentPayload.contiguityRelaxed
        ? ['Strict contiguity could not be satisfied for all pockets at this employee count; a relaxed contiguous best-effort assignment was returned.']
        : [],
      territories: territoriesFeatureCollection,
      pockets: pocketsFeatureCollection
    });
  });

/**
 * POST /api/v1/batch/territories/assign/:branchId
 * Run capacitated contiguous employee territory assignment for a branch.
 */
router.post(
  '/territories/assign/:branchId',
  assignEmployeeTerritoriesHandler
);

/**
 * POST /api/v1/batch/territories/run-allocation/:branchId
 * Batch trigger endpoint for persisted Pocket -> Employee allocation.
 */
router.post(
  '/territories/run-allocation/:branchId',
  assignEmployeeTerritoriesHandler
);

/**
 * Shared handler for manual territory reassignment.
 * Supports both:
 * - POST /api/v1/batch/territories/reassign/:branchId
 * - POST /api/v1/batch/territories/assign-manual
 */
const reassignEmployeeTerritoriesHandler = asyncHandler(async (req, res) => {
    const branchId = String(
      req.params?.branchId
      || req.body?.branchId
      || req.query?.branchId
      || ''
    ).trim();
    if (!branchId) {
      throw new AppError('Branch ID is required', 400, 'MISSING_BRANCH_ID');
    }

    const requestedEmployeeId = String(req.body?.employeeId || '').trim();
    if (!requestedEmployeeId) {
      throw new AppError('employeeId is required', 400, 'MISSING_EMPLOYEE_ID');
    }
    let targetEmployeeCode = requestedEmployeeId;
    let targetBranchEmployeeId = null;

    const gridCellIds = Array.isArray(req.body?.gridCellIds)
      ? req.body.gridCellIds
          .map((value) => String(value || '').trim())
          .filter(Boolean)
      : [];

    if (gridCellIds.length === 0) {
      throw new AppError('gridCellIds must contain at least one ID', 400, 'MISSING_GRID_CELL_IDS');
    }

    const branchExistsResult = await query(
      'SELECT id, city FROM branches WHERE id = $1',
      [branchId]
    );
    if (branchExistsResult.rows.length === 0) {
      throw new AppError('Branch not found', 404, 'BRANCH_NOT_FOUND');
    }

    const numericEmployeeId = Number.parseInt(requestedEmployeeId, 10);
    if (Number.isInteger(numericEmployeeId) && numericEmployeeId > 0) {
      const employeeExistsResult = await query(
        `SELECT id::int AS id, employee_id
         FROM branch_employees
         WHERE branch_id = $1
           AND id = $2::int
           AND is_active = TRUE
         LIMIT 1`,
        [branchId, numericEmployeeId]
      );
      if (employeeExistsResult.rows.length === 0) {
        throw new AppError('Employee not found for branch', 404, 'EMPLOYEE_NOT_FOUND');
      }
      targetBranchEmployeeId = Number(employeeExistsResult.rows[0].id);
      targetEmployeeCode = String(employeeExistsResult.rows[0].employee_id || '').trim();
    } else {
      const isGeneratedEmployeeId = GENERATED_EMPLOYEE_ID_REGEX.test(requestedEmployeeId);
      if (!isGeneratedEmployeeId) {
        const employeeExistsResult = await query(
          `SELECT id::int AS id, employee_id
           FROM branch_employees
           WHERE branch_id = $1
             AND employee_id = $2
             AND is_active = TRUE
           LIMIT 1`,
          [branchId, requestedEmployeeId]
        );
        if (employeeExistsResult.rows.length === 0) {
          throw new AppError('Employee not found for branch', 404, 'EMPLOYEE_NOT_FOUND');
        }
        targetBranchEmployeeId = Number(employeeExistsResult.rows[0].id);
        targetEmployeeCode = String(employeeExistsResult.rows[0].employee_id || '').trim();
      }
    }
    if (!targetEmployeeCode) {
      throw new AppError('Employee code is missing for selected employee.', 400, 'EMPLOYEE_CODE_MISSING');
    }
    const requestedLevelMetersRaw =
      req.body?.level_m
      ?? req.body?.levelM
      ?? req.query?.level_m
      ?? req.query?.levelM;
    const requestedLevelMeters = Number.isFinite(Number(requestedLevelMetersRaw))
      ? Math.round(Number(requestedLevelMetersRaw))
      : null;
    const requestedLevelKm = requestedLevelMeters === null
      ? null
      : resolveEmployeeGridLevelKm(requestedLevelMeters, requestedLevelMeters);

    // --- ORIGINAL BACKUP ---
    // const reassignmentPayload = await transaction(async (client) => {
    const latestJobId = await resolveLatestMappingsJobId();

    const reassignmentPayload = await transaction(async (client) => {
      await acquireBranchTerritoryLock(client, branchId);

      const reassignmentResult = await client.query(
        `
          WITH requested_ids AS (
            SELECT DISTINCT unnest($3::text[]) AS requested_id
          ),
          resolved_codes AS (
            SELECT DISTINCT bt.grid_code::text AS grid_code
            FROM requested_ids
            JOIN ${BRANCH_TERRITORY_TABLE} bt
              ON bt.branch_id = $1
             AND bt.grid_code = requested_ids.requested_id
             AND ($5::integer IS NULL OR bt.level_m = $5::integer)
            UNION
            SELECT DISTINCT egc.pocket_id::text AS grid_code
            FROM requested_ids
            JOIN ${EMPLOYEE_GRID_CELL_TABLE} egc
              ON egc.branch_id = $1
             AND ($6::integer IS NULL OR COALESCE(egc.level_km, 1) = $6::integer)
             AND (
               egc.id::text = requested_ids.requested_id
               OR egc.pocket_id::text = requested_ids.requested_id
             )
             AND egc.pocket_id IS NOT NULL
             AND btrim(egc.pocket_id) <> ''
          ),
          upsert_employee_territories AS (
            INSERT INTO ${EMPLOYEE_TERRITORY_TABLE} (
              branch_employee_id,
              employee_id,
              branch_id,
              grid_code
            )
            SELECT
              $2::int AS branch_employee_id,
              $4::varchar AS employee_id,
              $1::varchar AS branch_id,
              resolved_codes.grid_code::varchar AS grid_code
            FROM resolved_codes
            ON CONFLICT (branch_id, grid_code)
            DO UPDATE SET
              branch_employee_id = EXCLUDED.branch_employee_id,
              employee_id = EXCLUDED.employee_id,
              updated_at = CURRENT_TIMESTAMP
            RETURNING grid_code
          ),
          update_legacy_grid_cells AS (
            UPDATE ${EMPLOYEE_GRID_CELL_TABLE} egc
            SET
              assigned_employee_id = $4,
              updated_at = CURRENT_TIMESTAMP
            FROM resolved_codes
            WHERE egc.branch_id = $1
              AND ($6::integer IS NULL OR COALESCE(egc.level_km, 1) = $6::integer)
              AND egc.pocket_id::text = resolved_codes.grid_code
            RETURNING egc.id::text AS grid_cell_id
          )
          SELECT
            (SELECT COUNT(*)::int FROM resolved_codes) AS resolved_pocket_count,
            (SELECT COUNT(*)::int FROM upsert_employee_territories) AS updated_pocket_count,
            (SELECT COUNT(*)::int FROM update_legacy_grid_cells) AS updated_legacy_grid_rows
        `,
        [
          branchId,
          Number(targetBranchEmployeeId),
          gridCellIds,
          targetEmployeeCode,
          requestedLevelMeters,
          requestedLevelKm
        ]
      );

      const resolvedPocketCount = Number(reassignmentResult.rows[0]?.resolved_pocket_count || 0);
      const updatedPocketCount = Number(reassignmentResult.rows[0]?.updated_pocket_count || 0);
      const updatedLegacyGridRows = Number(reassignmentResult.rows[0]?.updated_legacy_grid_rows || 0);

      if (resolvedPocketCount === 0 || updatedPocketCount === 0) {
        throw new AppError(
          'No matching pockets were found in persistent branch territories for this reassignment.',
          404,
          'GRID_CELLS_NOT_FOUND'
        );
      }

      const levelResolutionResult = await client.query(
        `
          SELECT
            COALESCE(MAX(level_m), COALESCE($3::integer, $2::integer))::int AS level_m
          FROM ${BRANCH_TERRITORY_TABLE}
          WHERE branch_id = $1
            AND ($3::integer IS NULL OR level_m = $3::integer)
        `,
        [branchId, DEFAULT_PERSISTENT_TERRITORY_LEVEL_METERS, requestedLevelMeters]
      );
      const assignmentLevelMeters = Number(
        levelResolutionResult.rows[0]?.level_m || DEFAULT_PERSISTENT_TERRITORY_LEVEL_METERS
      );
      const twoWaySync = await runTwoWayAllocationSync(
        client,
        branchId,
        assignmentLevelMeters,
        latestJobId
      );

      return {
        updatedPockets: updatedPocketCount,
        persistentTerritories: {
          assignmentLevelMeters,
          deletedEmployeeAssignments: 0,
          deletedBranchTerritories: 0,
          insertedBranchTerritories: 0,
          insertedEmployeeTerritories: updatedPocketCount
        },
        twoWaySync,
        updatedLegacyGridRows
      };
    });

    const persistedPayload = await transaction(async (client) =>
      fetchPersistentBranchTerritoryPayload(
        client,
        branchId,
        reassignmentPayload.persistentTerritories?.assignmentLevelMeters || null
      )
    );
    const pocketsFeatureCollection = persistedPayload.pockets || buildEmptyFeatureCollection();
    const territoriesFeatureCollection = persistedPayload.territories || buildEmptyFeatureCollection();

    res.json({
      branchId,
      branchCity: branchExistsResult.rows[0].city || '',
      targetBranchEmployeeId: Number(targetBranchEmployeeId || 0) || null,
      updatedPockets: reassignmentPayload.updatedPockets,
      updatedLegacyGridRows: Number(reassignmentPayload.updatedLegacyGridRows || 0),
      summary: {
        totalPockets: Number(persistedPayload.summary?.totalPockets || 0),
        assignedEmployees: Number(persistedPayload.summary?.assignedEmployees || 0),
        totalAccounts: Number(persistedPayload.summary?.totalAccounts || 0),
        mergedTerritories: territoriesFeatureCollection.features.length
      },
      persistentTerritories: {
        assignmentLevelMeters: Number(reassignmentPayload.persistentTerritories?.assignmentLevelMeters || 0),
        deletedEmployeeAssignments: Number(reassignmentPayload.persistentTerritories?.deletedEmployeeAssignments || 0),
        deletedBranchTerritories: Number(reassignmentPayload.persistentTerritories?.deletedBranchTerritories || 0),
        insertedBranchTerritories: Number(reassignmentPayload.persistentTerritories?.insertedBranchTerritories || 0),
        insertedEmployeeTerritories: Number(reassignmentPayload.persistentTerritories?.insertedEmployeeTerritories || 0)
      },
      twoWaySync: {
        assignmentLevelMeters: Number(reassignmentPayload.twoWaySync?.assignmentLevelMeters || 0),
        clearedGridCells: Number(reassignmentPayload.twoWaySync?.clearedGridCells || 0),
        allocatedGridCells: Number(reassignmentPayload.twoWaySync?.allocatedGridCells || 0),
        syncedEmployeePockets: Number(reassignmentPayload.twoWaySync?.syncedEmployeePockets || 0),
        syncedCustomerCounts: Number(reassignmentPayload.twoWaySync?.syncedCustomerCounts || 0)
      },
      territories: territoriesFeatureCollection,
      pockets: pocketsFeatureCollection
    });
  });

/**
 * POST /api/v1/batch/territories/reassign/:branchId
 * Manager override for reassigning selected 1km pockets to another employee.
 */
router.post(
  '/territories/reassign/:branchId',
  reassignEmployeeTerritoriesHandler
);

/**
 * POST /api/v1/batch/territories/assign-manual
 * Alias endpoint for manager override reassignment.
 * Expects branchId in request body (or query fallback).
 */
router.post(
  '/territories/assign-manual',
  reassignEmployeeTerritoriesHandler
);

/**
 * GET /api/v1/batch/territories/visualization
 * Build clipped Voronoi territories for dashboard visualization.
 */
router.get(
  '/territories/visualization',
  asyncHandler(async (req, res) => {
    const mode = parseTerritoryVisualizationMode(req.query.mode);
    if (!mode) {
      throw new AppError(
        'Invalid mode. Use existing_customers, nearest_pockets, or customer_availability.',
        400,
        'INVALID_TERRITORY_MODE'
      );
    }

    const customerView = parseCustomerVisualizationView(req.query.customerView);
    if (!customerView) {
      throw new AppError(
        'Invalid customerView. Use selected_pockets or original_customers.',
        400,
        'INVALID_CUSTOMER_VIEW'
      );
    }

    const requestedBranchIds = parseBranchIds(req.query.branchIds);
    if (requestedBranchIds.length === 0) {
      throw new AppError(
        'Branch selection is required for selected-branch visualization mode.',
        400,
        'NO_BRANCH_SELECTION'
      );
    }
    if (requestedBranchIds.length > MAX_VISUALIZATION_BRANCHES) {
      throw new AppError(
        `A maximum of ${MAX_VISUALIZATION_BRANCHES} branches can be selected.`,
        400,
        'MAX_BRANCH_SELECTION_EXCEEDED'
      );
    }

    const requestedJobId = typeof req.query.jobId === 'string' && req.query.jobId.trim()
      ? req.query.jobId.trim()
      : null;

    let effectiveJobId = requestedJobId;
    if (effectiveJobId) {
      const jobExistsResult = await query(
        'SELECT job_id FROM jobs WHERE job_id = $1',
        [effectiveJobId]
      );
      if (jobExistsResult.rows.length === 0) {
        throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
      }
    } else {
      effectiveJobId = await resolveLatestMappingsJobId();
      if (!effectiveJobId) {
        throw new AppError('No customer mappings available for visualization', 404, 'NO_MAPPINGS');
      }
    }
    const branchesResult = await query(
      'SELECT id, city, lat, lon FROM branches ORDER BY id'
    );
    if (branchesResult.rows.length === 0) {
      throw new AppError('No branches available to generate territories', 400, 'NO_BRANCHES');
    }

    const branchRows = branchesResult.rows
      .map((row) => ({
        id: String(row.id),
        city: String(row.city || ''),
        lat: Number(row.lat),
        lon: Number(row.lon)
      }))
      .filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lon));

    if (branchRows.length === 0) {
      throw new AppError('No branches with valid coordinates available', 400, 'INVALID_BRANCH_COORDINATES');
    }

    const branchById = new Map(branchRows.map((branch) => [branch.id, branch]));
    const mappingsResult = await query(
      `
        SELECT
          customer_id,
          customer_lat,
          customer_lon,
          pocket_id,
          nearest_branch_id,
          existing_branch_id,
          uploaded_branch_code
        FROM customer_pocket_mappings
        WHERE job_id = $1
          AND (
            nearest_branch_id = ANY($2::text[])
            OR existing_branch_id = ANY($2::text[])
          )
        ORDER BY id
      `,
      [effectiveJobId, requestedBranchIds]
    );

    if (mappingsResult.rows.length === 0) {
      throw new AppError('No customer mappings found for the selected job', 404, 'NO_MAPPINGS_FOR_JOB');
    }
    const mappingRows = mappingsResult.rows.map((row) => ({
      customerId: String(row.customer_id || ''),
      customerLat: Number(row.customer_lat),
      customerLon: Number(row.customer_lon),
      pocketId: String(row.pocket_id || ''),
      assignedBranchId: String(row.nearest_branch_id || '').trim(),
      existingBranchId: String(row.existing_branch_id || '').trim(),
      uploadedBranchCode: row.uploaded_branch_code === null || row.uploaded_branch_code === undefined
        ? null
        : String(row.uploaded_branch_code).trim() || null
    }));

    const pocketDataById = new Map();
    mappingRows.forEach((mapping) => {
      if (!mapping.pocketId) {
        return;
      }

      if (!pocketDataById.has(mapping.pocketId)) {
        pocketDataById.set(mapping.pocketId, {
          pocketId: mapping.pocketId,
          customers: [],
          center: null
        });
      }

      pocketDataById.get(mapping.pocketId).customers.push(mapping);
    });
    if (mode !== TERRITORY_VISUALIZATION_MODE.EXISTING_CUSTOMERS) {
      const configResult = await query('SELECT * FROM config WHERE id = 1');
      if (configResult.rows.length === 0) {
        throw new AppError('System configuration not found', 500, 'CONFIG_NOT_FOUND');
      }

      const config = {
        originLat: configResult.rows[0].origin_lat,
        originLon: configResult.rows[0].origin_lon,
        alphabet: configResult.rows[0].alphabet
      };

      pocketDataById.forEach((pocketData) => {
        pocketData.center = getPocketCenterSafely(pocketData.pocketId, config);
      });
    }

    const requestedBranchIdSet = requestedBranchIds.length > 0
      ? new Set(requestedBranchIds)
      : null;
    const nearestBranchSearchRows = requestedBranchIdSet
      ? branchRows.filter((branch) => requestedBranchIdSet.has(branch.id))
      : branchRows;
    const scopedNearestBranchRows = nearestBranchSearchRows.length > 0
      ? nearestBranchSearchRows
      : branchRows;
    const shouldCollectDetailedArtifacts = (branchId) =>
      !requestedBranchIdSet || requestedBranchIdSet.has(branchId);

    const customerCountByBranchId = new Map();
    const pointFeatures = [];
    const customerFeatures = [];
    const customerAssignments = [];
    const sourceType = mode === TERRITORY_VISUALIZATION_MODE.EXISTING_CUSTOMERS ? 'customers' : 'pockets';

    const addCustomerAssignment = (mapping, branchId, assignmentSource) => {
      if (!branchId || !branchById.has(branchId)) {
        return;
      }

      incrementCount(customerCountByBranchId, branchId, 1);
      if (!shouldCollectDetailedArtifacts(branchId)) {
        return;
      }

      customerAssignments.push({
        branchId,
        customerId: mapping.customerId,
        pocketId: mapping.pocketId,
        customerLat: mapping.customerLat,
        customerLon: mapping.customerLon,
        assignmentSource
      });

      if (!Number.isFinite(mapping.customerLat) || !Number.isFinite(mapping.customerLon)) {
        return;
      }

      customerFeatures.push({
        type: 'Feature',
        properties: {
          // --- ORIGINAL BACKUP ---
          // branchId,
          // customerId: mapping.customerId,
          // pocketId: mapping.pocketId,
          // pointType: 'customer',
          // assignmentSource
          branchId,
          customerId: mapping.customerId,
          pocketId: mapping.pocketId,
          pointType: 'customer',
          assignmentSource,
          existingBranchId: mapping.existingBranchId || null,
          nearestBranchId: mapping.assignedBranchId || null
        },
        geometry: {
          type: 'Point',
          coordinates: [mapping.customerLon, mapping.customerLat]
        }
      });
    };

    if (mode === TERRITORY_VISUALIZATION_MODE.EXISTING_CUSTOMERS) {
      mappingRows.forEach((mapping) => {
        addCustomerAssignment(mapping, mapping.existingBranchId, 'existing_mapping');
      });

      // Existing-customer mode uses customer points directly as primary mode points.
      pointFeatures.push(...customerFeatures);
    } else if (mode === TERRITORY_VISUALIZATION_MODE.NEAREST_POCKETS) {
      pocketDataById.forEach((pocketData) => {
        if (!pocketData.center || pocketData.customers.length === 0) {
          return;
        }

        // --- ORIGINAL BACKUP ---
        // const nearestBranch = findNearestBranchForCoordinates(
        //   pocketData.center.lat,
        //   pocketData.center.lon,
        //   branchRows
        // );
        const nearestBranch = findNearestBranchForCoordinates(
          pocketData.center.lat,
          pocketData.center.lon,
          scopedNearestBranchRows
        );
        if (!nearestBranch) {
          return;
        }

        pocketData.customers.forEach((mapping) => {
          addCustomerAssignment(mapping, nearestBranch.id, 'nearest_pocket');
        });

        if (shouldCollectDetailedArtifacts(nearestBranch.id)) {
          pointFeatures.push({
            type: 'Feature',
            properties: {
              branchId: nearestBranch.id,
              pocketId: pocketData.pocketId,
              customerCount: pocketData.customers.length,
              pointType: 'pocket_center',
              mappingMode: TERRITORY_VISUALIZATION_MODE.NEAREST_POCKETS
            },
            geometry: {
              type: 'Point',
              coordinates: [pocketData.center.lon, pocketData.center.lat]
            }
          });
        }
      });
    } else {
      pocketDataById.forEach((pocketData) => {
        if (pocketData.customers.length === 0) {
          return;
        }

        const voteCounter = new Map();
        pocketData.customers.forEach((mapping) => {
          if (mapping.existingBranchId && branchById.has(mapping.existingBranchId)) {
            incrementCount(voteCounter, mapping.existingBranchId, 1);
          }
        });

        let selectedBranchId = findPreferredBranchByVotes(voteCounter);
        let assignmentSource = voteCounter.size > 0 ? 'customer_availability' : 'nearest_fallback';

        if (!selectedBranchId) {
          if (!pocketData.center) {
            return;
          }

          // --- ORIGINAL BACKUP ---
          // const nearestBranch = findNearestBranchForCoordinates(
          //   pocketData.center.lat,
          //   pocketData.center.lon,
          //   branchRows
          // );
          const nearestBranch = findNearestBranchForCoordinates(
            pocketData.center.lat,
            pocketData.center.lon,
            scopedNearestBranchRows
          );
          if (!nearestBranch) {
            return;
          }

          selectedBranchId = nearestBranch.id;
          assignmentSource = 'nearest_fallback';
        }

        pocketData.customers.forEach((mapping) => {
          addCustomerAssignment(mapping, selectedBranchId, assignmentSource);
        });

        if (pocketData.center && shouldCollectDetailedArtifacts(selectedBranchId)) {
          pointFeatures.push({
            type: 'Feature',
            properties: {
              branchId: selectedBranchId,
              pocketId: pocketData.pocketId,
              customerCount: pocketData.customers.length,
              pointType: 'pocket_center',
              mappingMode: TERRITORY_VISUALIZATION_MODE.CUSTOMER_AVAILABILITY,
              assignmentSource
            },
            geometry: {
              type: 'Point',
              coordinates: [pocketData.center.lon, pocketData.center.lat]
            }
          });
        }
      });
    }
    const invalidRequestedBranchIds = requestedBranchIds.filter((branchId) => !branchById.has(branchId));
    if (invalidRequestedBranchIds.length > 0) {
      throw new AppError(
        `Unknown branch ID(s): ${invalidRequestedBranchIds.join(', ')}`,
        400,
        'INVALID_BRANCH_SELECTION'
      );
    }

    const selectedBranchIds = requestedBranchIds.slice(0, MAX_VISUALIZATION_BRANCHES);
    const selectedBranches = selectedBranchIds
      .map((branchId) => branchById.get(branchId))
      .filter(Boolean);

    if (selectedBranches.length === 0) {
      throw new AppError('No valid branches selected for visualization', 400, 'INVALID_BRANCH_SELECTION');
    }
    const availableBranches = selectedBranches
      .map((branch) => ({
        id: branch.id,
        city: branch.city,
        lat: branch.lat,
        lon: branch.lon,
        customerCount: Number(customerCountByBranchId.get(branch.id) || 0)
      }))
      .sort((a, b) => (b.customerCount - a.customerCount) || a.id.localeCompare(b.id));
    const selectedBranchIdSet = new Set(selectedBranchIds);
    const filteredPointFeatures = pointFeatures.filter((feature) =>
      selectedBranchIdSet.has(String(feature.properties.branchId))
    );
    const filteredCustomerFeatures = customerFeatures.filter((feature) =>
      selectedBranchIdSet.has(String(feature.properties.branchId))
    );
    const originalCustomerFeatures = mappingRows
      .filter((mapping) => selectedBranchIdSet.has(mapping.existingBranchId))
      .filter((mapping) => Number.isFinite(mapping.customerLat) && Number.isFinite(mapping.customerLon))
      .map((mapping) => ({
        type: 'Feature',
        properties: {
          // --- ORIGINAL BACKUP ---
          // branchId: mapping.existingBranchId,
          // customerId: mapping.customerId,
          // pocketId: mapping.pocketId,
          // pointType: 'customer_original',
          // assignmentSource: 'uploaded_branch'
          branchId: mapping.existingBranchId,
          customerId: mapping.customerId,
          pocketId: mapping.pocketId,
          pointType: 'customer_original',
          assignmentSource: 'uploaded_branch',
          existingBranchId: mapping.existingBranchId || null,
          nearestBranchId: mapping.assignedBranchId || null
        },
        geometry: {
          type: 'Point',
          coordinates: [mapping.customerLon, mapping.customerLat]
        }
      }));

    const activeCustomerFeatures = customerView === CUSTOMER_VISUALIZATION_VIEW.ORIGINAL_CUSTOMERS
      ? originalCustomerFeatures
      : filteredCustomerFeatures;

    const coverageByBranch = await buildCustomerCoverageByBranch(
      customerAssignments.filter((assignment) =>
        selectedBranchIdSet.has(assignment.branchId)
      )
    );
    const singleBranchCoverageAvailable = selectedBranches.length === 1
      && coverageByBranch.some((coverageEntry) =>
        coverageEntry
        && coverageEntry.branchId === selectedBranches[0].id
        && coverageEntry.geometry
      );

    let indiaStateBoundsGeoJson = null;
    if (!singleBranchCoverageAvailable) {
      try {
        indiaStateBoundsGeoJson = loadIndiaStateBoundsGeoJson();
      } catch (error) {
        logger.error('Failed to load state boundary GeoJSON for visualization', {
          error: error.message
        });
        throw new AppError('Failed to load state boundary data', 500, 'STATE_BOUNDARY_LOAD_FAILED');
      }
    }

    const territoryRows = await buildVoronoiTerritoriesForSelectedBranches(
      selectedBranches,
      indiaStateBoundsGeoJson,
      coverageByBranch
    );
    const territories = buildTerritoryFeatureCollection(territoryRows, customerCountByBranchId);
    const branches = {
      type: 'FeatureCollection',
      features: selectedBranches.map((branch) => ({
        type: 'Feature',
        properties: {
          branchId: branch.id,
          city: branch.city,
          customerCount: Number(customerCountByBranchId.get(branch.id) || 0)
        },
        geometry: {
          type: 'Point',
          coordinates: [branch.lon, branch.lat]
        }
      }))
    };
    const points = {
      type: 'FeatureCollection',
      features: filteredPointFeatures
    };
    const customers = {
      type: 'FeatureCollection',
      features: activeCustomerFeatures
    };
    const customerViews = {
      selected_pockets: {
        type: 'FeatureCollection',
        features: filteredCustomerFeatures
      },
      original_customers: {
        type: 'FeatureCollection',
        features: originalCustomerFeatures
      }
    };
    res.json({
      jobId: effectiveJobId,
      mode,
      modeLabel: getTerritoryModeLabel(mode),
      customerView,
      maxSelectableBranches: MAX_VISUALIZATION_BRANCHES,
      selectedBranchIds,
      availableBranches: availableBranches.map((branch) => ({
        id: branch.id,
        city: branch.city,
        customerCount: branch.customerCount
      })),
      summary: {
        territories: territories.features.length,
        branches: branches.features.length,
        points: points.features.length,
        customers: mappingRows.length,
        customersVisible: customers.features.length,
        selectedPocketCustomersVisible: filteredCustomerFeatures.length,
        originalCustomersVisible: originalCustomerFeatures.length,
        pockets: pocketDataById.size,
        sourceType
      },
      territories,
      branches,
      points,
      customers,
      customerViews
    });
  })
);

/**
 * GET /api/v1/batch/territories/:branchId
 * Read pre-computed branch territories directly from persistent territory tables.
 */
// --- ORIGINAL BACKUP ---
// router.get(
//   '/territories/:branchId',
//   asyncHandler(async (req, res) => {
//     const branchId = String(req.params.branchId || '').trim();
//     if (!branchId) {
//       throw new AppError('Branch ID is required', 400, 'MISSING_BRANCH_ID');
//     }
//
//     const requestedLevelMeters = req.query?.level_m ?? req.query?.levelM;
//     const useExistingTerritoriesOnly = parseBooleanFlag(
//       req.query?.useExistingTerritoriesOnly,
//       false
//     );
//
//     const branchResult = await query(
//       'SELECT id, city FROM branches WHERE id = $1',
//       [branchId]
//     );
//     if (branchResult.rows.length === 0) {
//       throw new AppError('Branch not found', 404, 'BRANCH_NOT_FOUND');
//     }
//
//     let payload;
//     let branchCoverageStats = null;
//     let resolvedLevelMeters = DEFAULT_PERSISTENT_TERRITORY_LEVEL_METERS;
//     try {
//       const persistentReadResult = await transaction(async (client) => {
//         if (!useExistingTerritoriesOnly) {
//           await acquireBranchTerritoryLock(client, branchId);
//         }
//
//         const levelMeters = await resolvePersistentTerritoryLevelMeters(
//           client,
//           requestedLevelMeters
//         );
//         const coverageStats = await (useExistingTerritoriesOnly
//           ? (() => {
//             return client.query(
//               `
//                 SELECT COUNT(*)::int AS catchment_grid_count
//                 FROM ${BRANCH_TERRITORY_TABLE}
//                 WHERE branch_id = $1
//                   AND level_m = $2::integer
//               `,
//               [branchId, levelMeters]
//             ).then((countResult) => ({
//               assignmentLevelMeters: Number(levelMeters || 0),
//               generatedCandidateCount: 0,
//               insertedMasterCount: 0,
//               catchmentGridCount: Number(countResult.rows[0]?.catchment_grid_count || 0),
//               removedOutsideCount: 0,
//               upsertedBranchCount: 0,
//               skipped: true,
//               reason: 'EXISTING_BRANCH_TERRITORIES_ONLY'
//             }));
//           })()
//           : ensureBranchCatchmentCoverage(
//             client,
//             branchId,
//             levelMeters
//           ));
//         const persistentPayload = await fetchPersistentBranchTerritoryPayload(
//           client,
//           branchId,
//           levelMeters
//         );
//         return {
//           levelMeters,
//           coverageStats,
//           payload: persistentPayload
//         };
//       });
//
//       payload = persistentReadResult.payload;
//       branchCoverageStats = persistentReadResult.coverageStats;
//       resolvedLevelMeters = Number(
//         persistentReadResult.levelMeters || DEFAULT_PERSISTENT_TERRITORY_LEVEL_METERS
//       );
//     } catch (error) {
//       if (error && (error.code === '42P01' || error.code === '42703')) {
//         const message = String(error.message || '').toLowerCase();
//         if (
//           message.includes(BRANCH_TERRITORY_TABLE)
//           || message.includes(EMPLOYEE_TERRITORY_TABLE)
//           || message.includes('branch_employee_id')
//           || message.includes('branch_employees')
//         ) {
//           throw new AppError(
//             'Persistent territory tables are not initialized. Apply the persistent territory migration before requesting branch territories.',
//             503,
//             'PERSISTENT_TERRITORY_TABLES_NOT_INITIALIZED'
//           );
//         }
//       }
//       throw error;
//     }
//
//     res.json({
//       branchId,
//       branchCity: branchResult.rows[0].city || '',
//       source: 'persistent',
//       tolerance: DEFAULT_EMPLOYEE_TERRITORY_TOLERANCE,
//       geometryAlignment: {
//         assignmentLevelMeters: Number(payload.assignmentLevelMeters || resolvedLevelMeters || 0),
//         strictAlignment: true
//       },
//       branchCoverage: {
//         assignmentLevelMeters: Number(branchCoverageStats?.assignmentLevelMeters || resolvedLevelMeters || 0),
//         generatedCandidateCount: Number(branchCoverageStats?.generatedCandidateCount || 0),
//         insertedMasterCount: Number(branchCoverageStats?.insertedMasterCount || 0),
//         catchmentGridCount: Number(branchCoverageStats?.catchmentGridCount || 0),
//         removedOutsideCount: Number(branchCoverageStats?.removedOutsideCount || 0),
//         upsertedBranchCount: Number(branchCoverageStats?.upsertedBranchCount || 0)
//       },
//       summary: payload.summary,
//       warnings: payload.summary.totalPockets === 0
//         ? ['No persisted branch territories found at the selected level for this branch.']
//         : [],
//       territories: payload.territories || buildEmptyFeatureCollection(),
//       pockets: payload.pockets || buildEmptyFeatureCollection()
//     });
//   })
// );

// --- ORIGINAL BACKUP ---
// router.get(
//   '/territories/:branchId',
//   asyncHandler(async (req, res) => {
//     const branchId = String(req.params.branchId || '').trim();
//     if (!branchId) {
//       throw new AppError('Branch ID is required', 400, 'MISSING_BRANCH_ID');
//     }
//
//     // Default to 5km (5000m) if not specified, or use query param.
//     const requestedLevelMeters = Number(req.query.level_m ?? req.query.levelM ?? 5000);
//     if (!Number.isFinite(requestedLevelMeters) || requestedLevelMeters <= 0) {
//       throw new AppError('Invalid level_m. Provide a positive numeric grid level in meters.', 400, 'INVALID_LEVEL_M');
//     }
//     const levelMeters = Math.round(requestedLevelMeters);
//
//     const branchResult = await query(
//       'SELECT id, city FROM branches WHERE id = $1',
//       [branchId]
//     );
//     if (branchResult.rows.length === 0) {
//       throw new AppError('Branch not found', 404, 'BRANCH_NOT_FOUND');
//     }
//
//     // Fetch branch catchment grid.
//     // We return ALL grid cells in the radius, joining with assignment data if it exists.
//     const gridResult = await query(
//       `
//         WITH branch_info AS (
//           SELECT
//             COALESCE(
//               geom::geometry,
//               ST_SetSRID(ST_MakePoint(lon, lat), 4326)
//             ) AS geom
//           FROM branches
//           WHERE id = $1
//         ),
//         catchment AS (
//           -- Create branch catchment buffer around branch.
//           SELECT ST_Buffer(geom::geography, $3::double precision)::geometry AS geom
//           FROM branch_info
//         )
//         SELECT
//           gc.code AS pocket_id,
//           gc.level_m,
//           et.employee_id,
//           be.color_code,
//           ST_AsGeoJSON(gc.geom)::json AS geometry
//         FROM grid_cells gc
//         -- Optimization: Explicitly use bounding box operator (&&) to force spatial index usage
//         JOIN catchment ON gc.geom && catchment.geom AND ST_Intersects(gc.geom, catchment.geom)
//         LEFT JOIN employee_territories et
//           ON et.grid_code = gc.code
//           AND et.branch_id = $1
//         LEFT JOIN branch_employees be
//           ON be.employee_id = et.employee_id
//           AND be.branch_id = $1
//         WHERE gc.level_m = $2
//       `,
//       [branchId, levelMeters, BRANCH_CATCHMENT_RADIUS_METERS]
//     );
//
//     // Construct GeoJSON
//     const features = gridResult.rows.map(row => ({
//       type: 'Feature',
//       properties: {
//         pocket_id: row.pocket_id,
//         employee_id: row.employee_id || null,
//         color_code: row.color_code || null,
//         level_m: row.level_m
//       },
//       geometry: row.geometry
//     }));
//
//     const featureCollection = {
//       type: 'FeatureCollection',
//       features: features
//     };
//
//     res.json({
//       branchId,
//       branchCity: branchResult.rows[0].city || '',
//       source: `operational_catchment_${Math.round(BRANCH_CATCHMENT_RADIUS_METERS / 1000)}km`,
//       levelMeters,
//       pockets: featureCollection,
//       territories: { type: 'FeatureCollection', features: [] }, // Empty, we rely on grid
//       summary: {
//         totalPockets: features.length,
//         assignedEmployees: new Set(features.map(f => f.properties.employee_id).filter(Boolean)).size,
//         totalAccounts: 0 // Not calculating accounts in this view for speed
//       }
//     });
//   })
// );
router.get(
  '/territories/:branchId',
  asyncHandler(async (req, res) => {
    const branchId = String(req.params.branchId || '').trim();
    if (!branchId) {
      throw new AppError('Branch ID is required', 400, 'MISSING_BRANCH_ID');
    }

    const requestedLevelMeters = Number(req.query.level_m ?? req.query.levelM ?? 5000);
    if (!Number.isFinite(requestedLevelMeters) || requestedLevelMeters <= 0) {
      throw new AppError('Invalid level_m. Provide a positive numeric grid level in meters.', 400, 'INVALID_LEVEL_M');
    }
    const levelMeters = Math.round(requestedLevelMeters);

    const branchResult = await query(
      'SELECT id, city FROM branches WHERE id = $1',
      [branchId]
    );
    if (branchResult.rows.length === 0) {
      throw new AppError('Branch not found', 404, 'BRANCH_NOT_FOUND');
    }
    const useExistingTerritoriesOnly = parseBooleanFlag(
      req.query.useExistingTerritoriesOnly,
      false
    );
    const isOperationalLevel = levelMeters === 5000 || levelMeters === 1000;
    const strictCatchmentRadiusMeters = BRANCH_CATCHMENT_RADIUS_METERS;
    const paddedCatchmentRadiusMeters = resolvePaddedCatchmentRadiusMeters(levelMeters);
    // --- ORIGINAL BACKUP ---
    // const catchmentRadiusMeters = isOperationalLevel ? 50000 : BRANCH_CATCHMENT_RADIUS_METERS;
    const catchmentRadiusMeters = isOperationalLevel
      ? paddedCatchmentRadiusMeters
      : strictCatchmentRadiusMeters;
    const operationalSource = `operational_catchment_${Math.round(strictCatchmentRadiusMeters / 1000)}km`;

    let requestedSource = useExistingTerritoriesOnly
      ? 'persistent_branch_territories'
      : operationalSource;
    let resolvedSource = requestedSource;
    let fallbackApplied = false;
    let fallbackReason = null;
    let repairRecommended = false;

    if (useExistingTerritoriesOnly) {
      let persistentPayload;
      let persistedHealth;
      try {
        // --- ORIGINAL BACKUP ---
        // const persistentPayload = await fetchPersistentBranchTerritoryPayload(
        //   query,
        //   branchId,
        //   levelMeters
        // );
        persistentPayload = await fetchPersistentBranchTerritoryPayload(
          query,
          branchId,
          levelMeters
        );
        persistedHealth = await assessPersistedBranchTerritoryHealth(
          query,
          branchId,
          levelMeters
        );
      } catch (error) {
        if (error && (error.code === '42P01' || error.code === '42703')) {
          const message = String(error.message || '').toLowerCase();
          if (
            message.includes(BRANCH_TERRITORY_TABLE)
            || message.includes(EMPLOYEE_TERRITORY_TABLE)
            || message.includes('branch_employee_id')
            || message.includes('branch_employees')
          ) {
            throw new AppError(
              'Persistent territory tables are not initialized. Apply the persistent territory migration before requesting branch territories.',
              503,
              'PERSISTENT_TERRITORY_TABLES_NOT_INITIALIZED'
            );
          }
        }
        throw error;
      }

      const hasPersistedPockets = Number(persistentPayload?.summary?.totalPockets || 0) > 0;
      const hasPersistedPocketWithinValidationRadius = Number(
        persistedHealth?.pocketsWithinRadius || 0
      ) > 0;
      const persistedLayoutInvalid = !hasPersistedPockets || !hasPersistedPocketWithinValidationRadius;

      if (!persistedLayoutInvalid) {
        res.json({
          branchId,
          branchCity: branchResult.rows[0].city || '',
          source: 'persistent_branch_territories',
          requestedSource,
          resolvedSource: 'persistent_branch_territories',
          fallbackApplied: false,
          fallbackReason: null,
          repairRecommended: false,
          levelMeters: Number(persistentPayload.assignmentLevelMeters || levelMeters || 0),
          pockets: persistentPayload.pockets,
          territories: persistentPayload.territories,
          summary: persistentPayload.summary
        });
        return;
      }

      fallbackApplied = true;
      repairRecommended = true;
      resolvedSource = operationalSource;
      fallbackReason = `Persisted territories at ${levelMeters}m are missing or outside ${Math.round(PERSISTENT_TERRITORY_VALIDATION_RADIUS_METERS / 1000)}km validation radius for branch ${branchId}. Serving operational catchment preview.`;
    }

    if (fallbackApplied && isOperationalLevel && TIER2_GRID_LEVELS_METERS.includes(levelMeters)) {
      try {
        await transaction(async (client) => {
          const configResult = await client.query(
            `
              SELECT
                version,
                origin_lat,
                origin_lon,
                alphabet,
                grid_levels
              FROM config
              WHERE id = 1
              LIMIT 1
            `
          );
          if (configResult.rows.length === 0) {
            return;
          }

          const activePocketConfig = {
            configVersion: Number(configResult.rows[0].version || 1),
            originLat: Number(configResult.rows[0].origin_lat),
            originLon: Number(configResult.rows[0].origin_lon),
            alphabet: String(configResult.rows[0].alphabet || ''),
            gridLevels: configResult.rows[0].grid_levels
          };
          await ensureTier2MasterTilesAroundBranches(client, activePocketConfig, {
            branchIds: [branchId],
            levels: [levelMeters]
          });
        });
      } catch (error) {
        logger.warn('Failed to generate Tier-2 master tiles during fallback read', {
          branchId,
          levelMeters,
          error: error?.message || String(error)
        });
      }
    }

    // --- ORIGINAL BACKUP ---
    // const configResult = await query(
    //   `
    //     SELECT
    //       origin_lat,
    //       origin_lon,
    //       alphabet
    //     FROM config
    //     WHERE id = 1
    //     LIMIT 1
    //   `
    // );
    // const territoryPocketConfig = sanitizePocketConfig(
    //   configResult.rows.length > 0
    //     ? {
    //       originLat: configResult.rows[0].origin_lat,
    //       originLon: configResult.rows[0].origin_lon,
    //       alphabet: configResult.rows[0].alphabet
    //     }
    //     : {}
    // );

    // --- ORIGINAL BACKUP ---
    // const gridResult = await query(
    //   `
    //     WITH branch_info AS (
    //       SELECT
    //         COALESCE(
    //           b.geom::geometry,
    //           ST_SetSRID(ST_MakePoint(b.lon, b.lat), 4326)
    //         ) AS branch_geom
    //       FROM branches b
    //       WHERE b.id = $1
    //     )
    //     SELECT
    //       gc.code AS pocket_id,
    //       gc.level_m,
    //       COALESCE(be.id::text, et.branch_employee_id::text, et.employee_id::text) AS employee_id,
    //       be.color_code,
    //       ST_AsGeoJSON(gc.geom)::json AS geometry
    //     FROM grid_cells gc
    //     CROSS JOIN branch_info bi
    //     LEFT JOIN employee_territories et
    //       ON et.grid_code = gc.code
    //       AND et.branch_id = $1
    //     LEFT JOIN branch_employees be
    //       ON be.branch_id = $1
    //       AND (
    //         (et.branch_employee_id IS NOT NULL AND be.id = et.branch_employee_id)
    //         OR (et.employee_id IS NOT NULL AND be.id::text = et.employee_id::text)
    //         OR (et.employee_id IS NOT NULL AND be.employee_id::text = et.employee_id::text)
    //       )
    //     WHERE gc.level_m = $2
    //       AND ST_DWithin(
    //         gc.geom::geography,
    //         bi.branch_geom::geography,
    //         $3::double precision
    //       )
    //     ORDER BY gc.code ASC
    //   `,
    //   [branchId, levelMeters, catchmentRadiusMeters]
    // );
    //
    // const features = gridResult.rows.map((row) => ({
    //   type: 'Feature',
    //   properties: {
    //     pocket_id: row.pocket_id,
    //     level_m: Number(row.level_m || 0),
    //     employee_id: row.employee_id ? String(row.employee_id) : null,
    //     color_code: row.color_code || null
    //   },
    //   geometry: row.geometry
    // }));
    // --- ORIGINAL BACKUP ---
    // const gridResult = await query(
    //   `
    //     WITH branch_info AS (
    //       SELECT
    //         COALESCE(
    //           b.geom::geometry,
    //           ST_SetSRID(ST_MakePoint(b.lon, b.lat), 4326)
    //         ) AS branch_geom
    //       FROM branches b
    //       WHERE b.id = $1
    //     )
    //     SELECT
    //       gc.code AS master_grid_code,
    //       gc.level_m,
    //       COALESCE(be.id::text, et.branch_employee_id::text, et.employee_id::text) AS employee_id,
    //       be.color_code,
    //       ST_Y(ST_PointOnSurface(gc.geom)) AS pocket_center_lat,
    //       ST_X(ST_PointOnSurface(gc.geom)) AS pocket_center_lon,
    //       ST_AsGeoJSON(gc.geom)::json AS geometry
    //     FROM grid_cells gc
    //     CROSS JOIN branch_info bi
    //     LEFT JOIN employee_territories et
    //       ON et.grid_code = gc.code
    //       AND et.branch_id = $1
    //     LEFT JOIN branch_employees be
    //       ON be.branch_id = $1
    //       AND (
    //         (et.branch_employee_id IS NOT NULL AND be.id = et.branch_employee_id)
    //         OR (et.employee_id IS NOT NULL AND be.id::text = et.employee_id::text)
    //         OR (et.employee_id IS NOT NULL AND be.employee_id::text = et.employee_id::text)
    //       )
    //     WHERE gc.level_m = $2
    //       AND ST_DWithin(
    //         gc.geom::geography,
    //         bi.branch_geom::geography,
    //         $3::double precision
    //       )
    //     ORDER BY gc.code ASC
    //   `,
    //   [branchId, levelMeters, catchmentRadiusMeters]
    // );
    const operationalGridSql = `
      WITH branch_info AS (
        SELECT
          COALESCE(
            b.geom::geometry,
            ST_SetSRID(ST_MakePoint(b.lon, b.lat), 4326)
          ) AS branch_geom
        FROM branches b
        WHERE b.id = $1
      )
      SELECT
        gc.code AS pocket_id,
        gc.level_m,
        COALESCE(be.id::text, et.branch_employee_id::text, et.employee_id::text) AS employee_id,
        be.color_code,
        ST_AsGeoJSON(gc.geom)::json AS geometry
      FROM grid_cells gc
      CROSS JOIN branch_info bi
      LEFT JOIN employee_territories et
        ON et.grid_code = gc.code
        AND et.branch_id = $1
      LEFT JOIN branch_employees be
        ON be.branch_id = $1
        AND (
          (et.branch_employee_id IS NOT NULL AND be.id = et.branch_employee_id)
          OR (et.employee_id IS NOT NULL AND be.id::text = et.employee_id::text)
          OR (et.employee_id IS NOT NULL AND be.employee_id::text = et.employee_id::text)
        )
      -- --- ORIGINAL BACKUP ---
      -- WHERE gc.level_m = $2
      WHERE gc.level_m = $2::integer
        AND ST_DWithin(
          -- --- ORIGINAL BACKUP ---
          -- gc.geom::geography,
          ST_PointOnSurface(gc.geom)::geography,
          bi.branch_geom::geography,
          $3::double precision
        )
      ORDER BY gc.code ASC
    `;

    const fetchOperationalGridRows = async () =>
      query(operationalGridSql, [branchId, levelMeters, catchmentRadiusMeters]);

    // --- ORIGINAL BACKUP ---
    // const gridResult = await query(
    //   `
    //     WITH branch_info AS (
    //       SELECT
    //         COALESCE(
    //           b.geom::geometry,
    //           ST_SetSRID(ST_MakePoint(b.lon, b.lat), 4326)
    //         ) AS branch_geom
    //       FROM branches b
    //       WHERE b.id = $1
    //     )
    //     SELECT
    //       gc.code AS pocket_id,
    //       gc.level_m,
    //       COALESCE(be.id::text, et.branch_employee_id::text, et.employee_id::text) AS employee_id,
    //       be.color_code,
    //       ST_AsGeoJSON(gc.geom)::json AS geometry
    //     FROM grid_cells gc
    //     CROSS JOIN branch_info bi
    //     LEFT JOIN employee_territories et
    //       ON et.grid_code = gc.code
    //       AND et.branch_id = $1
    //     LEFT JOIN branch_employees be
    //       ON be.branch_id = $1
    //       AND (
    //         (et.branch_employee_id IS NOT NULL AND be.id = et.branch_employee_id)
    //         OR (et.employee_id IS NOT NULL AND be.id::text = et.employee_id::text)
    //         OR (et.employee_id IS NOT NULL AND be.employee_id::text = et.employee_id::text)
    //       )
    //     WHERE gc.level_m = $2
    //       AND ST_DWithin(
    //         gc.geom::geography,
    //         bi.branch_geom::geography,
    //         $3::double precision
    //       )
    //     ORDER BY gc.code ASC
    //   `,
    //   [branchId, levelMeters, catchmentRadiusMeters]
    // );
    let gridResult = await fetchOperationalGridRows();

    if (
      Number(gridResult.rows?.length || 0) === 0
      && TIER2_GRID_LEVELS_METERS.includes(levelMeters)
    ) {
      try {
        await transaction(async (client) => {
          const configResult = await client.query(
            `
              SELECT
                version,
                origin_lat,
                origin_lon,
                alphabet,
                grid_levels
              FROM config
              WHERE id = 1
              LIMIT 1
            `
          );
          if (configResult.rows.length === 0) {
            return;
          }

          const activePocketConfig = {
            configVersion: Number(configResult.rows[0].version || 1),
            originLat: Number(configResult.rows[0].origin_lat),
            originLon: Number(configResult.rows[0].origin_lon),
            alphabet: String(configResult.rows[0].alphabet || ''),
            gridLevels: configResult.rows[0].grid_levels
          };
          // --- ORIGINAL BACKUP ---
          // await ensureTier2MasterTilesAroundBranches(client, activePocketConfig);
          await ensureTier2MasterTilesAroundBranches(client, activePocketConfig, {
            branchIds: [branchId],
            levels: [levelMeters]
          });
        });

        gridResult = await fetchOperationalGridRows();
      } catch (error) {
        logger.warn('Failed to self-heal Tier-2 master tiles before operational territory read', {
          branchId,
          levelMeters,
          error: error?.message || String(error)
        });
      }
    }

    // --- ORIGINAL BACKUP ---
    // const features = gridResult.rows.map((row) => {
    //   const masterGridCode = String(row.master_grid_code || '').trim();
    //   let canonicalPocketId = masterGridCode;
    //   const centerLat = Number(row.pocket_center_lat);
    //   const centerLon = Number(row.pocket_center_lon);
    //
    //   if (Number.isFinite(centerLat) && Number.isFinite(centerLon)) {
    //     try {
    //       const nearestPocket = findNearestPocket(centerLat, centerLon, territoryPocketConfig, {
    //         pocketLevelMeters: levelMeters
    //       });
    //       if (nearestPocket?.pocketId) {
    //         canonicalPocketId = String(nearestPocket.pocketId).trim() || masterGridCode;
    //       }
    //     } catch {
    //       canonicalPocketId = masterGridCode;
    //     }
    //   }
    //
    //   return {
    //     type: 'Feature',
    //     properties: {
    //       pocket_id: canonicalPocketId,
    //       grid_code: masterGridCode,
    //       level_m: Number(row.level_m || 0),
    //       employee_id: row.employee_id ? String(row.employee_id) : null,
    //       color_code: row.color_code || null
    //     },
    //     geometry: row.geometry
    //   };
    // });
    const features = gridResult.rows.map((row) => ({
      type: 'Feature',
      properties: {
        pocket_id: String(row.pocket_id || '').trim(),
        level_m: Number(row.level_m || 0),
        employee_id: row.employee_id ? String(row.employee_id) : null,
        color_code: row.color_code || null
      },
      geometry: row.geometry
    }));

    const featureCollection = {
      type: 'FeatureCollection',
      features
    };

    res.json({
      branchId,
      branchCity: branchResult.rows[0].city || '',
      source: resolvedSource,
      requestedSource,
      resolvedSource,
      fallbackApplied,
      fallbackReason,
      repairRecommended,
      levelMeters,
      pockets: featureCollection,
      territories: { type: 'FeatureCollection', features: [] },
      summary: {
        totalPockets: features.length,
        assignedEmployees: new Set(
          features.map((feature) => feature.properties.employee_id).filter(Boolean)
        ).size,
        totalAccounts: 0
      }
    });
  })
);

/**
 * GET /api/v1/batch/territories/job/:jobId
 * Generate Voronoi territories by branch and return with customer/branch points.
 */
router.get(
  '/territories/job/:jobId',
  asyncHandler(async (req, res) => {
    const { jobId } = req.params;

    const jobResult = await query(
      'SELECT job_id, status FROM jobs WHERE job_id = $1',
      [jobId]
    );

    if (jobResult.rows.length === 0) {
      throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
    }

    const branchesResult = await query(
      'SELECT id, city, lat, lon FROM branches ORDER BY id'
    );

    if (branchesResult.rows.length === 0) {
      throw new AppError('No branches available to generate territories', 400, 'NO_BRANCHES');
    }

    const customersResult = await query(
      `SELECT customer_id, customer_lat, customer_lon, pocket_id, nearest_branch_id
       FROM customer_pocket_mappings
       WHERE job_id = $1
       ORDER BY id`,
      [jobId]
    );

    const territoryResult = await query(
      `
      WITH branch_points AS (
        SELECT
          id,
          city,
          ST_SetSRID(ST_MakePoint(lon, lat), 4326) AS geom
        FROM branches
      ),
      bounds AS (
        SELECT ST_Expand(ST_Extent(geom)::geometry, 1) AS env
        FROM branch_points
      ),
      voronoi_cells AS (
        SELECT (ST_Dump(ST_VoronoiPolygons(
          (SELECT ST_Collect(geom) FROM branch_points),
          0,
          (SELECT env FROM bounds)
        ))).geom AS geom
      ),
      territories AS (
        SELECT
          nearest_branch.id AS branch_id,
          nearest_branch.city AS city,
          voronoi_cells.geom AS geom
        FROM voronoi_cells
        JOIN LATERAL (
          SELECT id, city, geom
          FROM branch_points
          ORDER BY voronoi_cells.geom <-> geom
          LIMIT 1
        ) AS nearest_branch ON TRUE
      ),
      customer_counts AS (
        SELECT
          nearest_branch_id AS branch_id,
          COUNT(*)::int AS customer_count
        FROM customer_pocket_mappings
        WHERE job_id = $1
        GROUP BY nearest_branch_id
      )
      SELECT
        territories.branch_id,
        territories.city,
        COALESCE(customer_counts.customer_count, 0)::int AS customer_count,
        ST_AsGeoJSON(territories.geom)::json AS geometry
      FROM territories
      LEFT JOIN customer_counts
        ON customer_counts.branch_id = territories.branch_id
      ORDER BY territories.branch_id
      `,
      [jobId]
    );

    const territories = {
      type: 'FeatureCollection',
      features: territoryResult.rows.map((row) => ({
        type: 'Feature',
        properties: {
          branchId: row.branch_id,
          city: row.city,
          customerCount: Number(row.customer_count || 0)
        },
        geometry: row.geometry
      }))
    };

    const branches = {
      type: 'FeatureCollection',
      features: branchesResult.rows.map((row) => ({
        type: 'Feature',
        properties: {
          branchId: row.id,
          city: row.city
        },
        geometry: {
          type: 'Point',
          coordinates: [Number(row.lon), Number(row.lat)]
        }
      }))
    };

    const customers = {
      type: 'FeatureCollection',
      features: customersResult.rows.map((row) => ({
        type: 'Feature',
        properties: {
          customerId: row.customer_id,
          pocketId: row.pocket_id,
          nearestBranchId: row.nearest_branch_id
        },
        geometry: {
          type: 'Point',
          coordinates: [Number(row.customer_lon), Number(row.customer_lat)]
        }
      }))
    };

    res.json({
      jobId,
      status: jobResult.rows[0].status,
      summary: {
        territories: territories.features.length,
        branches: branches.features.length,
        customers: customers.features.length
      },
      territories,
      branches,
      customers
    });
  })
);

/**
 * GET /api/v1/pockets
 * Fetch Master Pockets for the selected area.
 * Returns a GeoJSON FeatureCollection where each feature is a pocket from the Master table (grid_cells).
 * Includes assignment data if branch_id is provided.
 */
router.get(
  '/pockets',
  asyncHandler(async (req, res) => {
    const minLon = Number(req.query.minLon);
    const minLat = Number(req.query.minLat);
    const maxLon = Number(req.query.maxLon);
    const maxLat = Number(req.query.maxLat);
    const requestedLevelMeters = Number(req.query.level_m ?? req.query.levelM);
    const levelMeters = Math.round(requestedLevelMeters);
    const parsedLimit = Number.parseInt(String(req.query.limit ?? '5000'), 10);
    const parsedOffset = Number.parseInt(String(req.query.offset ?? '0'), 10);
    const limit = Number.isInteger(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 20000)
      : 5000;
    const offset = Number.isInteger(parsedOffset)
      ? Math.max(parsedOffset, 0)
      : 0;
    const branchId = req.query.branch_id ? String(req.query.branch_id).trim() : null;

    if (![minLon, minLat, maxLon, maxLat].every((value) => Number.isFinite(value))) {
      throw new AppError(
        'minLon, minLat, maxLon, and maxLat query parameters must be valid numbers.',
        400,
        'INVALID_BOUNDS'
      );
    }

    if (
      minLon < -180
      || maxLon > 180
      || minLat < -90
      || maxLat > 90
      || minLon >= maxLon
      || minLat >= maxLat
    ) {
      throw new AppError(
        'Invalid bounds. Ensure longitude is within [-180, 180], latitude within [-90, 90], and min < max.',
        400,
        'INVALID_BOUNDS'
      );
    }

    if (!Number.isFinite(requestedLevelMeters) || levelMeters <= 0) {
      throw new AppError(
        'level_m (or levelM) is required and must be a positive number.',
        400,
        'INVALID_LEVEL_M'
      );
    }

    const levelKm = resolveEmployeeGridLevelKm(levelMeters, levelMeters);

    const result = await query(
      `
        SELECT 
          gc.code AS pocket_id,
          gc.level_m,
          egc.assigned_employee_id AS employee_id,
          be.color_code AS color,
          ST_AsGeoJSON(gc.geom)::json AS geometry
        FROM grid_cells gc
        LEFT JOIN employee_grid_cells egc 
          ON gc.code = egc.pocket_id 
          AND egc.branch_id = $6::varchar
          AND COALESCE(egc.level_km, 1) = $9::integer
        LEFT JOIN branch_employees be 
          ON egc.assigned_employee_id = be.employee_id 
          AND be.branch_id = $6::varchar
        WHERE gc.level_m = $5::int
          AND gc.geom && ST_MakeEnvelope($1::float, $2::float, $3::float, $4::float, 4326)
        ORDER BY gc.code ASC
        LIMIT $7::int
        OFFSET $8::int
      `,
      [minLon, minLat, maxLon, maxLat, levelMeters, branchId, limit + 1, offset, levelKm]
    );

    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
    const features = rows.map((row) => ({
      type: 'Feature',
      properties: {
        pocket_id: row.pocket_id,
        employee_id: row.employee_id,
        color: row.color,
        level_m: row.level_m
      },
      geometry: row.geometry
    }));

    res.json({
      type: 'FeatureCollection',
      features,
      pagination: {
        limit,
        offset,
        returned: features.length,
        hasMore,
        nextOffset: hasMore ? offset + limit : null
      },
      truncated: hasMore
    });
  })
);

// --- ORIGINAL BACKUP ---
// module.exports = router;
module.exports = router;
module.exports.allocationInternals = Object.freeze({
  acquireBranchTerritoryLock,
  buildCustomerPocketMappingRecord,
  ensureTier2MasterTilesAroundBranches,
  ensureBranchCatchmentCoverage,
  clearBranchPersistentTerritoryState,
  pruneBranchEmployeeGridCellsToCatchment,
  runCoreAndDonutAllocation,
  materializeClockwiseContiguousAllocation,
  persistBranchEmployeeTerritories,
  runTwoWayAllocationSync,
  resolveLatestMappingsJobId
});
