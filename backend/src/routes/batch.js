const express = require('express');
const xlsx = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { query } = require('../config/database');
const { encodePocketId, decodePocketId, findNearestPocket, haversineDistance } = require('../utils/geometry');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { requireRole } = require('../middleware/auth');
const logger = require('../config/logger');
const { batchProcessQueue } = require('../config/queue');
const mappingService = require('../services/MappingService');
const branchFinderService = require('../services/BranchFinderService');
const { createExcelUpload, validateUploadedWorkbook } = require('../utils/fileValidation');

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

const upload = createExcelUpload();

// Threshold for switching to Python worker (rows)
const PYTHON_WORKER_THRESHOLD = parseInt(process.env.PYTHON_WORKER_THRESHOLD || '5000', 10);
const MAX_VISUALIZATION_BRANCHES = 1;
const TARGET_POCKET_LEVEL_METERS = 5000;
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

const getScopedBranchIdsFromMappings = (mappings) =>
  Array.from(
    new Set(
      (Array.isArray(mappings) ? mappings : [])
        .map((mapping) => String(mapping?.existingBranchId || '').trim())
        .filter(Boolean)
    )
  );

const resolveReplaceExistingScope = ({
  replaceExisting = false,
  confirmWipeAll = false,
  mappings = [],
}) => {
  if (!replaceExisting) {
    return { deleteMode: 'none', branchIds: [] };
  }

  if (confirmWipeAll) {
    return { deleteMode: 'global', branchIds: [] };
  }

  const branchIds = getScopedBranchIdsFromMappings(mappings);
  if (branchIds.length === 0) {
    throw new AppError(
      'replaceExisting requires at least one valid branch_code mapped to an existing branch, or confirmWipeAll=true for a global wipe.',
      400,
      'CONFIRM_WIPE_ALL_REQUIRED'
    );
  }

  return { deleteMode: 'scoped', branchIds };
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
      const singleCoverageResult = await query(
        `
          WITH state_polygons AS (
            SELECT ST_SetSRID(ST_MakeValid(ST_GeomFromGeoJSON((feature->'geometry')::text)), 4326) AS geom
            FROM jsonb_array_elements(($1::jsonb)->'features') AS feature
          ),
          state_clip AS (
            SELECT ST_CollectionExtract(ST_Collect(geom), 3) AS geom
            FROM state_polygons
          ),
          branch_coverage AS (
            SELECT ST_SetSRID(ST_MakeValid(ST_GeomFromGeoJSON($2::text)), 4326) AS geom
          ),
          final_clip AS (
            SELECT ST_CollectionExtract(ST_Intersection(state_clip.geom, branch_coverage.geom), 3) AS geom
            FROM state_clip
            CROSS JOIN branch_coverage
          )
          SELECT ST_AsGeoJSON(ST_MakeValid(geom))::json AS geometry
          FROM final_clip
          WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)
        `,
        [stateGeoJsonParam, JSON.stringify(branchCoverage)]
      );

      if (singleCoverageResult.rows.length > 0 && singleCoverageResult.rows[0].geometry) {
        return [
          {
            branch_id: selectedBranch.id,
            city: selectedBranch.city,
            geometry: singleCoverageResult.rows[0].geometry
          }
        ];
      }
    }

    const fullStateResult = await query(
      `
        WITH state_polygons AS (
          SELECT ST_SetSRID(ST_MakeValid(ST_GeomFromGeoJSON((feature->'geometry')::text)), 4326) AS geom
          FROM jsonb_array_elements(($1::jsonb)->'features') AS feature
        ),
        clip_geometry AS (
          SELECT ST_CollectionExtract(ST_Collect(geom), 3) AS geom
          FROM state_polygons
        )
        SELECT ST_AsGeoJSON(geom)::json AS geometry
        FROM clip_geometry
      `,
      [stateGeoJsonParam]
    );

    if (fullStateResult.rows.length === 0 || !fullStateResult.rows[0].geometry) {
      return [];
    }

    return [
      {
        branch_id: selectedBranch.id,
        city: selectedBranch.city,
        geometry: fullStateResult.rows[0].geometry
      }
    ];
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
          CASE
            WHEN branch_coverage.geom IS NULL THEN merged_territories.geom
            ELSE ST_Intersection(merged_territories.geom, branch_coverage.geom)
          END AS geom
        FROM merged_territories
        LEFT JOIN branch_coverage
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
  const {
    jobId,
    data,
    config,
    fileName,
    filePath,
    replaceExisting = false,
    confirmWipeAll = false,
  } = job.data;
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
    });

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

        // Identify containing pocket at 5km level (no new pocket creation).
        const nearestPocket = findNearestPocket(lat, lon, config, {
          pocketLevelMeters: TARGET_POCKET_LEVEL_METERS
        });

        results.push({
          ...row,
          PocketID: nearestPocket.pocketId,
          'Distance to Pocket Center (m)': Math.round(nearestPocket.distance),
          'Pocket Center Lat': nearestPocket.centerLat.toFixed(6),
          'Pocket Center Lon': nearestPocket.centerLon.toFixed(6),
        });

        // Count accounts per pocket
        if (nearestPocket.pocketId !== 'ERROR') {
          pocketStats[nearestPocket.pocketId] = (pocketStats[nearestPocket.pocketId] || 0) + 1;
          
          // Cache pocket center
          if (!pocketCenters.has(nearestPocket.pocketId)) {
            pocketCenters.set(nearestPocket.pocketId, {
              lat: nearestPocket.centerLat,
              lon: nearestPocket.centerLon,
            });
          }
          
          // Extract customer ID from row (try common column names)
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
          
          // Collect mapping data for persistence
          mappings.push({
            customerId,
            customerLat: lat,
            customerLon: lon,
            customerBranchCode: branchCode,
            existingBranchId,
            distanceCustomerToExistingBranch,
            pocketId: nearestPocket.pocketId,
            distanceCustomerToPocket: nearestPocket.distance,
            pocketCenterLat: nearestPocket.centerLat,
            pocketCenterLon: nearestPocket.centerLon,
          });
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
      try {
        logger.info('Starting mapping persistence', { jobId, mappingCount: mappings.length });

        // Get unique pockets and find nearest branches
        const uniquePockets = Array.from(pocketCenters.entries()).map(([pocketId, center]) => ({
          pocketId,
          lat: center.lat,
          lon: center.lon,
        }));
        
        const pocketBranchMap = await branchFinderService.findNearestBranchesForPockets(uniquePockets);
        
        // Enrich mappings with branch information
        const enrichedMappings = mappings.map(mapping => {
          const branchInfo = pocketBranchMap.get(mapping.pocketId);
          
          if (!branchInfo) {
            logger.warn('No branch found for pocket', { pocketId: mapping.pocketId });
            throw new Error(`No branch found for pocket ${mapping.pocketId}`);
          }
          
          const targetBranchId = branchInfo.branchId;
          const distancePocketToBranch = branchInfo.distance;

          const uploadedBranchCode = mapping.customerBranchCode
            ? String(mapping.customerBranchCode).trim()
            : null;
          const existingBranchId = mapping.existingBranchId || null;
          const distanceCustomerToExistingBranch =
            Number.isFinite(mapping.distanceCustomerToExistingBranch)
              ? mapping.distanceCustomerToExistingBranch
              : null;
          const distanceCustomerToBranch = distancePocketToBranch;
          
          return {
            customerId: mapping.customerId,
            customerLat: mapping.customerLat,
            customerLon: mapping.customerLon,
            pocketId: mapping.pocketId,
            distanceCustomerToPocket: mapping.distanceCustomerToPocket,
            nearestBranchId: targetBranchId,
            distancePocketToBranch,
            distanceCustomerToBranch: distanceCustomerToBranch,
            uploadedBranchCode,
            existingBranchId,
            distanceCustomerToExistingBranch,
          };
        });

        const replaceExistingScope = resolveReplaceExistingScope({
          replaceExisting,
          confirmWipeAll,
          mappings: enrichedMappings,
        });

        if (replaceExistingScope.deleteMode === 'global') {
          const deleteMappingsResult = await query('DELETE FROM customer_pocket_mappings');
          replacedMappingsCount = deleteMappingsResult.rowCount || 0;
          logger.info('Cleared all customer mappings before replacement upload', {
            jobId,
            deletedMappings: replacedMappingsCount,
            wipeScope: 'global',
          });
        } else if (replaceExistingScope.deleteMode === 'scoped') {
          const deleteMappingsResult = await query(
            `
              DELETE FROM customer_pocket_mappings
              WHERE COALESCE(existing_branch_id, nearest_branch_id) = ANY($1::text[])
            `,
            [replaceExistingScope.branchIds]
          );
          replacedMappingsCount = deleteMappingsResult.rowCount || 0;
          logger.info('Cleared scoped customer mappings before replacement upload', {
            jobId,
            deletedMappings: replacedMappingsCount,
            wipeScope: 'scoped',
            branchIds: replaceExistingScope.branchIds,
          });
        }
        
        // Save mappings using UUID job_id (matches FK customer_pocket_mappings.job_id -> jobs.job_id)
        const saveResult = await mappingService.saveMappings(jobId, enrichedMappings);
        mappingsPersisted = saveResult.insertedCount;
        
        if (!saveResult.success) {
          logger.error('Mapping persistence had errors', {
            jobId,
            insertedCount: saveResult.insertedCount,
            totalMappings: enrichedMappings.length,
            errors: saveResult.errors,
          });
        } else {
          logger.info('Mapping persistence successful', {
            jobId,
            insertedCount: saveResult.insertedCount,
          });
        }
      } catch (error) {
        logger.error('Failed to persist mappings', {
          jobId,
          error: error.message,
          stack: error.stack,
          mappingCount: mappings.length,
        });

        if (replaceExisting) {
          throw error;
        }

        // Continue with Excel export for best-effort non-replacement uploads.
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
          mappingsPersisted,
          replaceExisting: Boolean(replaceExisting),
          replacedMappingsCount,
          territoryUrl: `/api/v1/batch/territories/${jobId}`,
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
      mappingsPersisted,
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
      mappingsPersisted,
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
  requireRole('admin'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError('No file uploaded', 400, 'NO_FILE');
    }

    const { sanitizedFileName, rowCount } = await validateUploadedWorkbook(req.file);
    const fileName = sanitizedFileName;
    const filePath = path.join(uploadDir, `${uuidv4()}-${sanitizedFileName}`);
    await fs.promises.writeFile(filePath, req.file.buffer);
    const fileSizeMB = req.file.size / (1024 * 1024);
    const replaceExisting = parseBooleanFlag(req.body?.replaceExisting, false);
    const confirmWipeAll = parseBooleanFlag(req.body?.confirmWipeAll, false);

    // Validation already parsed the workbook to enforce the row cap.
    // Keep the existing worker-routing threshold based on file size.
    const usePythonWorker = fileSizeMB > 0.5;

    // Get current configuration
    const configResult = await query('SELECT * FROM config WHERE id = 1');
    const config = configResult.rows.length > 0 ? {
      originLat: configResult.rows[0].origin_lat,
      originLon: configResult.rows[0].origin_lon,
      alphabet: configResult.rows[0].alphabet,
    } : {};

    const jobId = uuidv4();

    // Create job in database (Setting total to 0, the worker will update it with exact count)
    await query(
      `INSERT INTO jobs (job_id, type, status, total, data)
       VALUES ($1, 'batch_encode', 'pending', 0, $2)`,
      [jobId, JSON.stringify({ 
        fileName,
        rowCount,
        replaceExisting,
        confirmWipeAll,
        worker: usePythonWorker ? 'python' : 'nodejs'
      })]
    );

    if (usePythonWorker) {
      logger.info('Routing to Python worker (large file)', { jobId, fileSizeMB, fileName });

      const jobPayload = {
        jobId,
        filePath,
        fileName,
        config,
        replaceExisting,
        confirmWipeAll,
      };
      
      // CRITICAL FIX: Use Bull's existing Redis client instead of separate pythonRedisClient
      // This avoids the "ready" status issue that was causing uploads to hang
      try {
        await withTimeout(
          batchQueue.client.lpush('python_batch_jobs', JSON.stringify(jobPayload)),
          10000,
          'Timed out while queueing Python job'
        );
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
        rowCount,
        replaceExisting,
        confirmWipeAll,
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
            replaceExisting,
            confirmWipeAll,
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
        rowCount,
        replaceExisting,
        confirmWipeAll,
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
        ORDER BY id
      `,
      [effectiveJobId]
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

    const customerCountByBranchId = new Map();
    const pointFeatures = [];
    const customerFeatures = [];
    const customerAssignments = [];
    const sourceType = mode === TERRITORY_VISUALIZATION_MODE.EXISTING_CUSTOMERS ? 'customers' : 'pockets';

    const addCustomerAssignment = (mapping, branchId, assignmentSource) => {
      if (!branchId || !branchById.has(branchId)) {
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
      incrementCount(customerCountByBranchId, branchId, 1);

      if (!Number.isFinite(mapping.customerLat) || !Number.isFinite(mapping.customerLon)) {
        return;
      }

      customerFeatures.push({
        type: 'Feature',
        properties: {
          branchId,
          customerId: mapping.customerId,
          pocketId: mapping.pocketId,
          pointType: 'customer',
          assignmentSource
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

        const nearestBranch = findNearestBranchForCoordinates(
          pocketData.center.lat,
          pocketData.center.lon,
          branchRows
        );
        if (!nearestBranch) {
          return;
        }

        pocketData.customers.forEach((mapping) => {
          addCustomerAssignment(mapping, nearestBranch.id, 'nearest_pocket');
        });

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

          const nearestBranch = findNearestBranchForCoordinates(
            pocketData.center.lat,
            pocketData.center.lon,
            branchRows
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

        if (pocketData.center) {
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

    const availableBranches = Array.from(customerCountByBranchId.entries())
      .map(([branchId, customerCount]) => {
        const branch = branchById.get(branchId);
        return branch
          ? {
              id: branch.id,
              city: branch.city,
              lat: branch.lat,
              lon: branch.lon,
              customerCount: Number(customerCount)
            }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => (b.customerCount - a.customerCount) || a.id.localeCompare(b.id));

    if (availableBranches.length === 0) {
      throw new AppError(
        'No branches with customer coverage available for the selected mode',
        404,
        'NO_BRANCHES_WITH_DATA'
      );
    }

    const invalidRequestedBranchIds = requestedBranchIds.filter((branchId) => !branchById.has(branchId));
    if (invalidRequestedBranchIds.length > 0) {
      throw new AppError(
        `Unknown branch ID(s): ${invalidRequestedBranchIds.join(', ')}`,
        400,
        'INVALID_BRANCH_SELECTION'
      );
    }

    const missingDataBranchIds = requestedBranchIds.filter(
      (branchId) => !customerCountByBranchId.has(branchId)
    );
    if (missingDataBranchIds.length > 0) {
      throw new AppError(
        `Selected branch(es) have no data for ${getTerritoryModeLabel(mode)}: ${missingDataBranchIds.join(', ')}`,
        400,
        'BRANCHES_WITHOUT_DATA'
      );
    }

    const selectedBranchIds = requestedBranchIds.length > 0
      ? requestedBranchIds
      : availableBranches
          .slice(0, MAX_VISUALIZATION_BRANCHES)
          .map((branch) => branch.id);

    if (selectedBranchIds.length === 0) {
      throw new AppError('No branch selected for visualization', 400, 'NO_BRANCH_SELECTION');
    }

    if (selectedBranchIds.length > MAX_VISUALIZATION_BRANCHES) {
      throw new AppError(
        `A maximum of ${MAX_VISUALIZATION_BRANCHES} branches can be selected.`,
        400,
        'MAX_BRANCH_SELECTION_EXCEEDED'
      );
    }

    const selectedBranches = selectedBranchIds
      .map((branchId) => branchById.get(branchId))
      .filter(Boolean);

    if (selectedBranches.length === 0) {
      throw new AppError('No valid branches selected for visualization', 400, 'INVALID_BRANCH_SELECTION');
    }

    let indiaStateBoundsGeoJson;
    try {
      indiaStateBoundsGeoJson = loadIndiaStateBoundsGeoJson();
    } catch (error) {
      logger.error('Failed to load state boundary GeoJSON for visualization', {
        error: error.message
      });
      throw new AppError('Failed to load state boundary data', 500, 'STATE_BOUNDARY_LOAD_FAILED');
    }

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
          branchId: mapping.existingBranchId,
          customerId: mapping.customerId,
          pocketId: mapping.pocketId,
          pointType: 'customer_original',
          assignmentSource: 'uploaded_branch'
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
      customers
    });
  })
);

/**
 * GET /api/v1/batch/territories/:jobId
 * Generate Voronoi territories by branch and return with customer/branch points.
 */
router.get(
  '/territories/:jobId',
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

router.__testables = {
  getScopedBranchIdsFromMappings,
  resolveReplaceExistingScope,
};

module.exports = router;
