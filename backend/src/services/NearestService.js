const { query } = require('../config/database');
const { haversineDistance } = require('../utils/geometry');

const buildTargetPointExpression = (lonRef, latRef) =>
  `ST_SetSRID(ST_MakePoint(${lonRef}, ${latRef}), 4326)::geography`;

const sortByDistanceThenId = (left, right) =>
  left.distance - right.distance || String(left.id).localeCompare(String(right.id));

const mapNearestBranchRow = (row) => ({
  id: row.id,
  city: row.city,
  lat: row.lat,
  lon: row.lon,
  pocketId: row.pocket_id || null,
  distance: Number(row.distance),
});

const mapBranchFinderRow = (row) => ({
  branchId: row.branch_id,
  branchName: row.branch_name,
  branchLat: row.branch_lat,
  branchLon: row.branch_lon,
  distance: Number(row.distance),
});

const computeFallbackNearestBranches = ({ branches, lat, lon, limit, maxDistance }) =>
  branches
    .map((branch) => ({
      ...branch,
      distance: haversineDistance(lat, lon, branch.lat, branch.lon),
    }))
    .filter((branch) => maxDistance == null || branch.distance <= maxDistance)
    .sort(sortByDistanceThenId)
    .slice(0, limit)
    .map(mapNearestBranchRow);

const computeFallbackNearestBranchesForPockets = ({ pockets, branches }) => {
  const pocketBranchMap = new Map();

  pockets.forEach((pocket) => {
    const nearestBranch = computeFallbackNearestBranches({
      branches,
      lat: pocket.lat,
      lon: pocket.lon,
      limit: 1,
      maxDistance: null,
    })[0];

    if (nearestBranch) {
      pocketBranchMap.set(pocket.pocketId, {
        branchId: nearestBranch.id,
        branchName: nearestBranch.city,
        branchLat: nearestBranch.lat,
        branchLon: nearestBranch.lon,
        distance: nearestBranch.distance,
      });
    }
  });

  return pocketBranchMap;
};

class NearestService {
  async findNearestBranches({ lat, lon, limit = 5, maxDistance = null }) {
    const targetPointExpression = buildTargetPointExpression('$1', '$2');
    const result = await query(
      `
        WITH target AS (
          SELECT ${targetPointExpression} AS geom
        )
        SELECT
          b.id,
          b.city,
          b.lat,
          b.lon,
          b.pocket_id,
          ST_Distance(b.geom, target.geom) AS distance
        FROM branches b
        CROSS JOIN target
        WHERE ($3::double precision IS NULL OR ST_DWithin(b.geom, target.geom, $3))
        ORDER BY b.geom <-> target.geom, b.id ASC
        LIMIT $4
      `,
      [lon, lat, maxDistance, limit]
    );

    if (result.rows.length === 0) {
      return [];
    }

    if (typeof result.rows[0].distance === 'undefined') {
      return computeFallbackNearestBranches({
        branches: result.rows,
        lat,
        lon,
        limit,
        maxDistance,
      });
    }

    return result.rows.map(mapNearestBranchRow);
  }

  async findNearestBranch({ lat, lon, maxDistance = null }) {
    const branches = await this.findNearestBranches({
      lat,
      lon,
      limit: 1,
      maxDistance,
    });

    if (branches.length === 0) {
      throw new Error('No branches found in database');
    }

    const branch = branches[0];

    return {
      branchId: branch.id,
      branchName: branch.city,
      branchLat: branch.lat,
      branchLon: branch.lon,
      distance: branch.distance,
    };
  }

  async findNearestBranchesForPockets(pockets) {
    if (!Array.isArray(pockets)) {
      throw new Error('Pockets array is required');
    }

    if (pockets.length === 0) {
      return new Map();
    }

    const values = [];
    const valueTuples = pockets.map((pocket, index) => {
      const baseIndex = index * 3;
      values.push(pocket.pocketId, pocket.lat, pocket.lon);
      return `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3})`;
    });

    const targetPointExpression = buildTargetPointExpression(
      'input_pockets.lon',
      'input_pockets.lat'
    );

    const result = await query(
      `
        WITH input_pockets (pocket_id, lat, lon) AS (
          VALUES ${valueTuples.join(', ')}
        )
        SELECT
          input_pockets.pocket_id,
          nearest.id AS branch_id,
          nearest.city AS branch_name,
          nearest.lat AS branch_lat,
          nearest.lon AS branch_lon,
          nearest.distance
        FROM input_pockets
        JOIN LATERAL (
          SELECT
            b.id,
            b.city,
            b.lat,
            b.lon,
            ST_Distance(b.geom, ${targetPointExpression}) AS distance
          FROM branches b
          ORDER BY b.geom <-> ${targetPointExpression}, b.id ASC
          LIMIT 1
        ) nearest ON TRUE
      `,
      values
    );

    if (result.rows.length === 0) {
      throw new Error('No branches found in database');
    }

    if (typeof result.rows[0].pocket_id === 'undefined') {
      return computeFallbackNearestBranchesForPockets({
        pockets,
        branches: result.rows,
      });
    }

    return new Map(
      result.rows.map((row) => [
        row.pocket_id,
        mapBranchFinderRow(row),
      ])
    );
  }
}

module.exports = new NearestService();
