const path = require('path');
const fs = require('fs');
const { query } = require('../config/database');
const { decodePocketId, haversineDistance } = require('../utils/geometry');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../config/logger');
const territoryCache = require('./TerritoryCache');

const MAX_VISUALIZATION_BRANCHES = 1;
const TERRITORY_VISUALIZATION_MODE = Object.freeze({
  EXISTING_CUSTOMERS: 'existing_customers',
  NEAREST_POCKETS: 'nearest_pockets',
  CUSTOMER_AVAILABILITY: 'customer_availability',
});
const CUSTOMER_VISUALIZATION_VIEW = Object.freeze({
  SELECTED_POCKETS: 'selected_pockets',
  ORIGINAL_CUSTOMERS: 'original_customers',
});
const INDIA_STATE_BOUNDS_GEOJSON_CANDIDATE_PATHS = [
  path.resolve(__dirname, '../../data/indiaStateBounds_official.geojson'),
  path.resolve(__dirname, '../../public/data/indiaStateBounds_official.geojson'),
  path.resolve(__dirname, '../../../frontend/public/data/indiaStateBounds_official.geojson'),
];

let cachedIndiaStateBoundsGeoJson = null;

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
    branch_code_availability: TERRITORY_VISUALIZATION_MODE.CUSTOMER_AVAILABILITY,
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
    existing_customers: CUSTOMER_VISUALIZATION_VIEW.ORIGINAL_CUSTOMERS,
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
      lon: decoded.centerLon,
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
      customerCount: Number(customerCountByBranchId.get(row.branch_id) || 0),
    },
    geometry: row.geometry,
  })),
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
      lon: entry.customerLon,
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
      geometry: row.geometry,
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
            geometry: singleCoverageResult.rows[0].geometry,
          },
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
        geometry: fullStateResult.rows[0].geometry,
      },
    ];
  }

  const coverageParam = JSON.stringify(
    coverageGeometriesByBranch
      .filter((coverageEntry) => coverageEntry && coverageEntry.branchId && coverageEntry.geometry)
      .map((coverageEntry) => ({
        branch_id: coverageEntry.branchId,
        geometry: coverageEntry.geometry,
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

const getTerritoryVisualization = async ({ mode: rawMode, customerView: rawCustomerView, branchIds: rawBranchIds, jobId: rawJobId }) => {
  const mode = parseTerritoryVisualizationMode(rawMode);
  if (!mode) {
    throw new AppError(
      'Invalid mode. Use existing_customers, nearest_pockets, or customer_availability.',
      400,
      'INVALID_TERRITORY_MODE'
    );
  }

  const customerView = parseCustomerVisualizationView(rawCustomerView);
  if (!customerView) {
    throw new AppError(
      'Invalid customerView. Use selected_pockets or original_customers.',
      400,
      'INVALID_CUSTOMER_VIEW'
    );
  }

  const requestedBranchIds = parseBranchIds(rawBranchIds);
  if (requestedBranchIds.length > MAX_VISUALIZATION_BRANCHES) {
    throw new AppError(
      `A maximum of ${MAX_VISUALIZATION_BRANCHES} branches can be selected.`,
      400,
      'MAX_BRANCH_SELECTION_EXCEEDED'
    );
  }

  const requestedJobId = typeof rawJobId === 'string' && rawJobId.trim()
    ? rawJobId.trim()
    : null;

  let effectiveJobId = requestedJobId;
  if (effectiveJobId) {
    const jobExistsResult = await query('SELECT job_id FROM jobs WHERE job_id = $1', [effectiveJobId]);
    if (jobExistsResult.rows.length === 0) {
      throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
    }
  } else {
    effectiveJobId = await resolveLatestMappingsJobId();
    if (!effectiveJobId) {
      throw new AppError('No customer mappings available for visualization', 404, 'NO_MAPPINGS');
    }
  }

  const configResult = await query('SELECT version, origin_lat, origin_lon, alphabet FROM config WHERE id = 1');
  if (configResult.rows.length === 0) {
    throw new AppError('System configuration not found', 500, 'CONFIG_NOT_FOUND');
  }

  const configRow = configResult.rows[0];
  const configVersion = Number(configRow.version);

  await territoryCache.invalidateVisualizationCacheIfNeeded({
    latestJobId: requestedJobId ? null : effectiveJobId,
    configVersion,
  });

  const cacheKey = territoryCache.buildVisualizationCacheKey({
    jobId: effectiveJobId,
    mode,
    branchIds: requestedBranchIds,
    customerView,
    configVersion,
  });

  const cachedVisualization = await territoryCache.getCachedVisualization(cacheKey);
  if (cachedVisualization) {
    return cachedVisualization;
  }

  const branchesResult = await query('SELECT id, city, lat, lon FROM branches ORDER BY id');
  if (branchesResult.rows.length === 0) {
    throw new AppError('No branches available to generate territories', 400, 'NO_BRANCHES');
  }

  const branchRows = branchesResult.rows
    .map((row) => ({
      id: String(row.id),
      city: String(row.city || ''),
      lat: Number(row.lat),
      lon: Number(row.lon),
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
    uploadedBranchCode:
      row.uploaded_branch_code === null || row.uploaded_branch_code === undefined
        ? null
        : String(row.uploaded_branch_code).trim() || null,
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
        center: null,
      });
    }

    pocketDataById.get(mapping.pocketId).customers.push(mapping);
  });

  if (mode !== TERRITORY_VISUALIZATION_MODE.EXISTING_CUSTOMERS) {
    const config = {
      originLat: configRow.origin_lat,
      originLon: configRow.origin_lon,
      alphabet: configRow.alphabet,
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
      assignmentSource,
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
        assignmentSource,
      },
      geometry: {
        type: 'Point',
        coordinates: [mapping.customerLon, mapping.customerLat],
      },
    });
  };

  if (mode === TERRITORY_VISUALIZATION_MODE.EXISTING_CUSTOMERS) {
    mappingRows.forEach((mapping) => {
      addCustomerAssignment(mapping, mapping.existingBranchId, 'existing_mapping');
    });
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
          mappingMode: TERRITORY_VISUALIZATION_MODE.NEAREST_POCKETS,
        },
        geometry: {
          type: 'Point',
          coordinates: [pocketData.center.lon, pocketData.center.lat],
        },
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
            assignmentSource,
          },
          geometry: {
            type: 'Point',
            coordinates: [pocketData.center.lon, pocketData.center.lat],
          },
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
            customerCount: Number(customerCount),
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

  const missingDataBranchIds = requestedBranchIds.filter((branchId) => !customerCountByBranchId.has(branchId));
  if (missingDataBranchIds.length > 0) {
    throw new AppError(
      `Selected branch(es) have no data for ${getTerritoryModeLabel(mode)}: ${missingDataBranchIds.join(', ')}`,
      400,
      'BRANCHES_WITHOUT_DATA'
    );
  }

  const selectedBranchIds = requestedBranchIds.length > 0
    ? requestedBranchIds
    : availableBranches.slice(0, MAX_VISUALIZATION_BRANCHES).map((branch) => branch.id);

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
      error: error.message,
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
        assignmentSource: 'uploaded_branch',
      },
      geometry: {
        type: 'Point',
        coordinates: [mapping.customerLon, mapping.customerLat],
      },
    }));

  const activeCustomerFeatures = customerView === CUSTOMER_VISUALIZATION_VIEW.ORIGINAL_CUSTOMERS
    ? originalCustomerFeatures
    : filteredCustomerFeatures;

  const coverageByBranch = await buildCustomerCoverageByBranch(
    customerAssignments.filter((assignment) => selectedBranchIdSet.has(assignment.branchId))
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
        customerCount: Number(customerCountByBranchId.get(branch.id) || 0),
      },
      geometry: {
        type: 'Point',
        coordinates: [branch.lon, branch.lat],
      },
    })),
  };
  const points = {
    type: 'FeatureCollection',
    features: filteredPointFeatures,
  };
  const customers = {
    type: 'FeatureCollection',
    features: activeCustomerFeatures,
  };

  const responsePayload = {
    jobId: effectiveJobId,
    mode,
    modeLabel: getTerritoryModeLabel(mode),
    customerView,
    maxSelectableBranches: MAX_VISUALIZATION_BRANCHES,
    selectedBranchIds,
    availableBranches: availableBranches.map((branch) => ({
      id: branch.id,
      city: branch.city,
      customerCount: branch.customerCount,
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
      sourceType,
    },
    territories,
    branches,
    points,
    customers,
  };

  await territoryCache.cacheVisualizationResponse(cacheKey, responsePayload);
  return responsePayload;
};

const getJobTerritories = async (jobId) => {
  const jobResult = await query('SELECT job_id, status FROM jobs WHERE job_id = $1', [jobId]);
  if (jobResult.rows.length === 0) {
    throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
  }

  const branchesResult = await query('SELECT id, city, lat, lon FROM branches ORDER BY id');
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
        customerCount: Number(row.customer_count || 0),
      },
      geometry: row.geometry,
    })),
  };

  const branches = {
    type: 'FeatureCollection',
    features: branchesResult.rows.map((row) => ({
      type: 'Feature',
      properties: {
        branchId: row.id,
        city: row.city,
      },
      geometry: {
        type: 'Point',
        coordinates: [Number(row.lon), Number(row.lat)],
      },
    })),
  };

  const customers = {
    type: 'FeatureCollection',
    features: customersResult.rows.map((row) => ({
      type: 'Feature',
      properties: {
        customerId: row.customer_id,
        pocketId: row.pocket_id,
        nearestBranchId: row.nearest_branch_id,
      },
      geometry: {
        type: 'Point',
        coordinates: [Number(row.customer_lon), Number(row.customer_lat)],
      },
    })),
  };

  return {
    jobId,
    status: jobResult.rows[0].status,
    summary: {
      territories: territories.features.length,
      branches: branches.features.length,
      customers: customers.features.length,
    },
    territories,
    branches,
    customers,
  };
};

module.exports = {
  getTerritoryVisualization,
  getJobTerritories,
};
