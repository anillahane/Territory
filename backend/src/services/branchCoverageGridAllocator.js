const DEFAULT_GRID_SIZE_KM = 5;
const DEFAULT_BUFFER_KM = 5;
const EPSILON_KM = 0.5;
const BRANCH_COLOR_PALETTE = [
  '#EF4444',
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#8B5CF6',
  '#EC4899',
  '#14B8A6',
  '#F97316',
  '#DC2626',
  '#0EA5E9'
];

const toRadians = (degrees) => degrees * (Math.PI / 180);

const haversineDistanceKm = (lat1, lon1, lat2, lon2) => {
  if (
    !Number.isFinite(lat1)
    || !Number.isFinite(lon1)
    || !Number.isFinite(lat2)
    || !Number.isFinite(lon2)
  ) {
    return Number.POSITIVE_INFINITY;
  }

  const earthRadiusKm = 6371;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLon = toRadians(lon2 - lon1);
  const a = (
    Math.sin(deltaLat / 2) ** 2
    + Math.cos(toRadians(lat1))
      * Math.cos(toRadians(lat2))
      * Math.sin(deltaLon / 2) ** 2
  );
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
};

const kmToLatDegrees = (distanceKm) => distanceKm / 110.574;

const kmToLonDegrees = (distanceKm, latitude) => {
  const cosine = Math.cos(toRadians(latitude));
  const safeCosine = Math.max(Math.abs(cosine), 0.01);
  return distanceKm / (111.320 * safeCosine);
};

const roundCoordinate = (value) => Number(Number(value).toFixed(12));

const makePointKey = (lng, lat) => `${roundCoordinate(lng)},${roundCoordinate(lat)}`;

const computeSignedRingArea = (ring) => {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    area += (x1 * y2) - (x2 * y1);
  }
  return area / 2;
};

const ensureRingOrientation = (ring, clockwise) => {
  const signedArea = computeSignedRingArea(ring);
  const isClockwise = signedArea < 0;
  if ((clockwise && isClockwise) || (!clockwise && !isClockwise)) {
    return ring;
  }
  return [...ring].reverse();
};

const pointInRing = (point, ring) => {
  const [targetX, targetY] = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];

    const intersects = (
      ((yi > targetY) !== (yj > targetY))
      && (
        targetX
        < (((xj - xi) * (targetY - yi)) / ((yj - yi) || Number.EPSILON)) + xi
      )
    );

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
};

const normalizeBranchColorMap = (branches) => {
  const sortedBranches = [...branches].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const branchColorById = new Map();

  sortedBranches.forEach((branch, index) => {
    const explicitColor = typeof branch.color === 'string' && branch.color.trim()
      ? branch.color.trim().toUpperCase()
      : null;
    branchColorById.set(
      String(branch.id),
      explicitColor || BRANCH_COLOR_PALETTE[index % BRANCH_COLOR_PALETTE.length]
    );
  });

  return branchColorById;
};

const buildGridDefinition = ({
  branches,
  customers,
  gridSizeKm = DEFAULT_GRID_SIZE_KM,
  bufferKm = DEFAULT_BUFFER_KM
}) => {
  const points = [
    ...(Array.isArray(branches) ? branches : []),
    ...(Array.isArray(customers) ? customers : [])
  ].filter((entry) => Number.isFinite(entry.lat) && Number.isFinite(entry.lon));

  if (points.length === 0) {
    return null;
  }

  const meanLat = points.reduce((sum, point) => sum + Number(point.lat), 0) / points.length;
  const latStep = kmToLatDegrees(gridSizeKm);
  const lonStep = kmToLonDegrees(gridSizeKm, meanLat);
  const latBuffer = kmToLatDegrees(bufferKm);
  const lonBuffer = kmToLonDegrees(bufferKm, meanLat);

  const minLat = Math.min(...points.map((point) => Number(point.lat))) - latBuffer;
  const maxLat = Math.max(...points.map((point) => Number(point.lat))) + latBuffer;
  const minLon = Math.min(...points.map((point) => Number(point.lon))) - lonBuffer;
  const maxLon = Math.max(...points.map((point) => Number(point.lon))) + lonBuffer;
  const rows = Math.max(1, Math.ceil((maxLat - minLat) / latStep));
  const cols = Math.max(1, Math.ceil((maxLon - minLon) / lonStep));

  return {
    gridSizeKm,
    bufferKm,
    meanLat,
    latStep,
    lonStep,
    minLat,
    minLon,
    maxLat: minLat + (rows * latStep),
    maxLon: minLon + (cols * lonStep),
    rows,
    cols,
    totalBoxes: rows * cols
  };
};

const getBoxId = (rowIndex, colIndex) => `box_r${rowIndex}_c${colIndex}`;

const getGridPositionForPoint = (grid, lat, lon) => {
  if (
    !grid
    || !Number.isFinite(lat)
    || !Number.isFinite(lon)
    || lat < grid.minLat
    || lat > grid.maxLat
    || lon < grid.minLon
    || lon > grid.maxLon
  ) {
    return null;
  }

  const normalizedRow = Math.floor((lat - grid.minLat) / grid.latStep);
  const normalizedCol = Math.floor((lon - grid.minLon) / grid.lonStep);

  return {
    rowIndex: Math.min(Math.max(normalizedRow, 0), grid.rows - 1),
    colIndex: Math.min(Math.max(normalizedCol, 0), grid.cols - 1)
  };
};

const buildBoxGeometry = (grid, rowIndex, colIndex) => {
  const minLat = grid.minLat + (rowIndex * grid.latStep);
  const maxLat = minLat + grid.latStep;
  const minLon = grid.minLon + (colIndex * grid.lonStep);
  const maxLon = minLon + grid.lonStep;

  return {
    id: getBoxId(rowIndex, colIndex),
    rowIndex,
    colIndex,
    bounds: {
      min_lat: minLat,
      max_lat: maxLat,
      min_lng: minLon,
      max_lng: maxLon
    },
    centroid: {
      lat: minLat + (grid.latStep / 2),
      lng: minLon + (grid.lonStep / 2)
    },
    polygon: [[
      [roundCoordinate(minLon), roundCoordinate(minLat)],
      [roundCoordinate(maxLon), roundCoordinate(minLat)],
      [roundCoordinate(maxLon), roundCoordinate(maxLat)],
      [roundCoordinate(minLon), roundCoordinate(maxLat)],
      [roundCoordinate(minLon), roundCoordinate(minLat)]
    ]]
  };
};

const compareAllocationCandidates = (left, right) => {
  const scoreDelta = left.score - right.score;
  if (Math.abs(scoreDelta) > 1e-12) {
    return scoreDelta;
  }

  if (left.rawCustomerCount !== right.rawCustomerCount) {
    return left.rawCustomerCount - right.rawCustomerCount;
  }

  const distanceDelta = right.distanceKm - left.distanceKm;
  if (Math.abs(distanceDelta) > 1e-12) {
    return distanceDelta;
  }

  return String(right.branchId).localeCompare(String(left.branchId));
};

const ensureMinimumBoxOwnership = ({
  allocations,
  candidateBranches,
  boxesPerBranch,
  assignedCustomersByBranchId
}) => {
  const candidateIds = candidateBranches.map((branch) => String(branch.id));
  const boxesByBranchId = candidateIds.reduce((accumulator, branchId) => {
    accumulator.set(
      branchId,
      allocations.filter((allocation) => allocation.winner_branch_id === branchId)
    );
    return accumulator;
  }, new Map());

  candidateIds.forEach((branchId) => {
    if (!Object.prototype.hasOwnProperty.call(boxesPerBranch, branchId)) {
      boxesPerBranch[branchId] = 0;
    }
  });

  const zeroOwnershipBranches = candidateBranches.filter(
    (branch) => Number(boxesPerBranch[branch.id] || 0) === 0
  );

  zeroOwnershipBranches.forEach((branch) => {
    const orderedCandidateBoxes = [...allocations]
      .map((allocation) => ({
        allocation,
        distanceKm: haversineDistanceKm(
          branch.lat,
          branch.lon,
          allocation.centroid.lat,
          allocation.centroid.lng
        )
      }))
      .sort((left, right) => {
        if (Math.abs(left.distanceKm - right.distanceKm) > 1e-12) {
          return left.distanceKm - right.distanceKm;
        }
        return String(left.allocation.box_id).localeCompare(String(right.allocation.box_id));
      });

    const preferredCandidate = orderedCandidateBoxes.find(({ allocation }) =>
      Number(allocation.customer_count_in_box || 0) === 0
      && Number(boxesPerBranch[allocation.winner_branch_id] || 0) > 1
    ) || orderedCandidateBoxes.find(({ allocation }) =>
      Number(boxesPerBranch[allocation.winner_branch_id] || 0) > 1
    ) || orderedCandidateBoxes[0];

    if (!preferredCandidate) {
      return;
    }

    const donorBranchId = preferredCandidate.allocation.winner_branch_id;
    preferredCandidate.allocation.winner_branch_id = branch.id;
    preferredCandidate.allocation.color = branch.color || preferredCandidate.allocation.color;
    boxesPerBranch[donorBranchId] = Math.max(Number(boxesPerBranch[donorBranchId] || 0) - 1, 0);
    boxesPerBranch[branch.id] = Number(boxesPerBranch[branch.id] || 0) + 1;
    if (assignedCustomersByBranchId) {
      const movedCustomers = Array.isArray(preferredCandidate.allocation.customers)
        ? preferredCandidate.allocation.customers
        : [];
      if (movedCustomers.length > 0) {
        assignedCustomersByBranchId.set(
          donorBranchId,
          (assignedCustomersByBranchId.get(donorBranchId) || []).filter(
            (customer) => !movedCustomers.some((movedCustomer) => movedCustomer.id === customer.id)
          )
        );
        assignedCustomersByBranchId.set(
          branch.id,
          [...(assignedCustomersByBranchId.get(branch.id) || []), ...movedCustomers]
        );
      }
    }

    boxesByBranchId.set(
      donorBranchId,
      (boxesByBranchId.get(donorBranchId) || []).filter((item) => item.box_id !== preferredCandidate.allocation.box_id)
    );
    boxesByBranchId.set(
      branch.id,
      [...(boxesByBranchId.get(branch.id) || []), preferredCandidate.allocation]
    );
  });
};

const buildCustomerFeature = (customer, winnerBranchId, branchColorById) => ({
  type: 'Feature',
  properties: {
    branchId: winnerBranchId,
    customerId: String(customer.id),
    existingBranchId: customer.homeBranchId || null,
    nearestBranchId: winnerBranchId,
    branchColor: branchColorById.get(String(winnerBranchId)) || BRANCH_COLOR_PALETTE[0]
  },
  geometry: {
    type: 'Point',
    coordinates: [Number(customer.lon), Number(customer.lat)]
  }
});

const buildOriginalCustomerFeature = (customer, branchColorById) => ({
  type: 'Feature',
  properties: {
    branchId: customer.homeBranchId || null,
    customerId: String(customer.id),
    existingBranchId: customer.homeBranchId || null,
    nearestBranchId: null,
    branchColor: branchColorById.get(String(customer.homeBranchId || '')) || BRANCH_COLOR_PALETTE[0]
  },
  geometry: {
    type: 'Point',
    coordinates: [Number(customer.lon), Number(customer.lat)]
  }
});

const mergeBoxesIntoMultiPolygon = (boxes) => {
  if (!Array.isArray(boxes) || boxes.length === 0) {
    return null;
  }

  const edgeMap = new Map();

  boxes.forEach((box) => {
    const ring = box.polygon[0];
    for (let index = 0; index < ring.length - 1; index += 1) {
      const start = ring[index];
      const end = ring[index + 1];
      const startKey = makePointKey(start[0], start[1]);
      const endKey = makePointKey(end[0], end[1]);
      const canonicalKey = [startKey, endKey].sort().join('|');

      if (edgeMap.has(canonicalKey)) {
        edgeMap.delete(canonicalKey);
      } else {
        edgeMap.set(canonicalKey, {
          start,
          end,
          startKey,
          endKey
        });
      }
    }
  });

  const edgesByStartKey = new Map();
  edgeMap.forEach((edge, edgeKey) => {
    if (!edgesByStartKey.has(edge.startKey)) {
      edgesByStartKey.set(edge.startKey, []);
    }
    edgesByStartKey.get(edge.startKey).push({
      edgeKey,
      start: edge.start,
      end: edge.end,
      startKey: edge.startKey,
      endKey: edge.endKey
    });
  });

  const consumedEdges = new Set();
  const rings = [];

  edgeMap.forEach((edge, edgeKey) => {
    if (consumedEdges.has(edgeKey)) {
      return;
    }

    const ring = [[...edge.start]];
    let currentEdge = edge;
    consumedEdges.add(edgeKey);
    ring.push([...currentEdge.end]);

    while (currentEdge.endKey !== edge.startKey) {
      const nextCandidates = (edgesByStartKey.get(currentEdge.endKey) || [])
        .filter((candidate) => !consumedEdges.has(candidate.edgeKey));

      if (nextCandidates.length === 0) {
        break;
      }

      const nextEdge = nextCandidates[0];
      consumedEdges.add(nextEdge.edgeKey);
      ring.push([...nextEdge.end]);
      currentEdge = nextEdge;
    }

    if (ring.length >= 4) {
      if (
        ring[0][0] !== ring[ring.length - 1][0]
        || ring[0][1] !== ring[ring.length - 1][1]
      ) {
        ring.push([...ring[0]]);
      }
      rings.push(ring);
    }
  });

  if (rings.length === 0) {
    return null;
  }

  const sortedRings = rings
    .map((ring) => ({
      ring,
      areaAbs: Math.abs(computeSignedRingArea(ring))
    }))
    .sort((left, right) => right.areaAbs - left.areaAbs);

  const polygonGroups = [];

  sortedRings.forEach((entry) => {
    const samplePoint = entry.ring[0];
    const containingGroups = polygonGroups.filter((group) => pointInRing(samplePoint, group.outer));

    if (containingGroups.length === 0) {
      polygonGroups.push({
        outer: ensureRingOrientation(entry.ring, false),
        holes: []
      });
      return;
    }

    const targetGroup = containingGroups
      .sort((left, right) => Math.abs(computeSignedRingArea(left.outer)) - Math.abs(computeSignedRingArea(right.outer)))[0];
    targetGroup.holes.push(ensureRingOrientation(entry.ring, true));
  });

  if (polygonGroups.length === 1) {
    return {
      type: 'Polygon',
      coordinates: [
        polygonGroups[0].outer,
        ...polygonGroups[0].holes
      ]
    };
  }

  return {
    type: 'MultiPolygon',
    coordinates: polygonGroups.map((group) => [
      group.outer,
      ...group.holes
    ])
  };
};

const allocateBranchCoverage = ({
  allBranches,
  candidateBranches,
  customers,
  gridSizeKm = DEFAULT_GRID_SIZE_KM,
  mergeAdjacent = true,
  bufferKm = DEFAULT_BUFFER_KM
}) => {
  const startedAt = Date.now();
  const normalizedAllBranches = (Array.isArray(allBranches) ? allBranches : [])
    .map((branch) => ({
      id: String(branch.id || '').trim(),
      name: String(branch.name || branch.city || branch.id || '').trim(),
      city: String(branch.city || '').trim(),
      lat: Number(branch.lat),
      lon: Number(branch.lon),
      color: typeof branch.color === 'string' ? branch.color.trim() : ''
    }))
    .filter((branch) => branch.id && Number.isFinite(branch.lat) && Number.isFinite(branch.lon));
  const normalizedCandidateBranches = (Array.isArray(candidateBranches) ? candidateBranches : [])
    .map((branch) => ({
      id: String(branch.id || '').trim(),
      name: String(branch.name || branch.city || branch.id || '').trim(),
      city: String(branch.city || '').trim(),
      lat: Number(branch.lat),
      lon: Number(branch.lon),
      color: typeof branch.color === 'string' ? branch.color.trim() : ''
    }))
    .filter((branch) => branch.id && Number.isFinite(branch.lat) && Number.isFinite(branch.lon));
  const normalizedCustomers = (Array.isArray(customers) ? customers : [])
    .map((customer) => ({
      id: String(customer.id || customer.customerId || '').trim(),
      lat: Number(customer.lat ?? customer.customerLat),
      lon: Number(customer.lon ?? customer.customerLon),
      homeBranchId: String(customer.homeBranchId ?? customer.existingBranchId ?? '').trim() || null
    }))
    .filter((customer) => customer.id && Number.isFinite(customer.lat) && Number.isFinite(customer.lon));

  const warnings = [];

  if (normalizedCandidateBranches.length === 0) {
    return {
      featureCollection: {
        type: 'FeatureCollection',
        features: []
      },
      branches: {
        type: 'FeatureCollection',
        features: []
      },
      selectedCustomers: {
        type: 'FeatureCollection',
        features: []
      },
      originalCustomers: {
        type: 'FeatureCollection',
        features: []
      },
      allocations: [],
      availableBranches: [],
      stats: {
        total_boxes: 0,
        boxes_per_branch: {},
        boxes_with_customers: 0,
        boxes_fallback_proximity: 0,
        compute_time_ms: 0
      },
      warnings: ['No branches selected.']
    };
  }

  const branchColorById = normalizeBranchColorMap(normalizedAllBranches.length > 0
    ? normalizedAllBranches
    : normalizedCandidateBranches);
  const grid = buildGridDefinition({
    branches: normalizedCandidateBranches,
    customers: normalizedCustomers,
    gridSizeKm,
    bufferKm
  });

  if (!grid) {
    return {
      featureCollection: {
        type: 'FeatureCollection',
        features: []
      },
      branches: {
        type: 'FeatureCollection',
        features: normalizedCandidateBranches.map((branch) => ({
          type: 'Feature',
          properties: {
            branchId: branch.id,
            city: branch.city,
            customerCount: 0,
            branchColor: branchColorById.get(branch.id)
          },
          geometry: {
            type: 'Point',
            coordinates: [branch.lon, branch.lat]
          }
        }))
      },
      selectedCustomers: {
        type: 'FeatureCollection',
        features: []
      },
      originalCustomers: {
        type: 'FeatureCollection',
        features: []
      },
      allocations: [],
      availableBranches: normalizedCandidateBranches.map((branch) => ({
        id: branch.id,
        city: branch.city,
        customerCount: 0
      })),
      stats: {
        total_boxes: 0,
        boxes_per_branch: {},
        boxes_with_customers: 0,
        boxes_fallback_proximity: 0,
        compute_time_ms: Date.now() - startedAt
      },
      warnings
    };
  }

  const customersByBoxId = new Map();
  let excludedCustomers = 0;

  normalizedCustomers.forEach((customer) => {
    const position = getGridPositionForPoint(grid, customer.lat, customer.lon);
    if (!position) {
      excludedCustomers += 1;
      return;
    }

    const boxId = getBoxId(position.rowIndex, position.colIndex);
    if (!customersByBoxId.has(boxId)) {
      customersByBoxId.set(boxId, []);
    }
    customersByBoxId.get(boxId).push(customer);
  });

  if (excludedCustomers > 0) {
    warnings.push(`${excludedCustomers} customers fell outside the computed grid bounds and were excluded.`);
  }

  const allocations = [];
  const boxesByBranchId = new Map();
  const assignedCustomersByBranchId = new Map();
  const originalCustomersByBranchId = new Map();
  const boxesPerBranch = {};
  let boxesWithCustomers = 0;
  let boxesFallbackProximity = 0;

  normalizedCustomers.forEach((customer) => {
    if (!customer.homeBranchId || !normalizedCandidateBranches.some((branch) => branch.id === customer.homeBranchId)) {
      return;
    }
    if (!originalCustomersByBranchId.has(customer.homeBranchId)) {
      originalCustomersByBranchId.set(customer.homeBranchId, []);
    }
    originalCustomersByBranchId.get(customer.homeBranchId).push(customer);
  });

  for (let rowIndex = 0; rowIndex < grid.rows; rowIndex += 1) {
    for (let colIndex = 0; colIndex < grid.cols; colIndex += 1) {
      const box = buildBoxGeometry(grid, rowIndex, colIndex);
      const boxCustomers = customersByBoxId.get(box.id) || [];
      const totalCustomers = boxCustomers.length;
      const customerCountsByBranchId = new Map();

      boxCustomers.forEach((customer) => {
        if (!customer.homeBranchId) {
          return;
        }
        customerCountsByBranchId.set(
          customer.homeBranchId,
          (customerCountsByBranchId.get(customer.homeBranchId) || 0) + 1
        );
      });

      if (totalCustomers > 0) {
        boxesWithCustomers += 1;
      }

      let winningCandidate = null;
      normalizedCandidateBranches.forEach((branch) => {
        const rawCustomerCount = Number(customerCountsByBranchId.get(branch.id) || 0);
        const distanceKm = haversineDistanceKm(
          branch.lat,
          branch.lon,
          box.centroid.lat,
          box.centroid.lng
        );
        const proximityWeight = 1 / (distanceKm + EPSILON_KM);
        const score = totalCustomers > 0
          ? (rawCustomerCount / totalCustomers) * proximityWeight
          : proximityWeight;
        const candidate = {
          branchId: branch.id,
          branch,
          rawCustomerCount,
          distanceKm,
          score
        };

        if (!winningCandidate || compareAllocationCandidates(candidate, winningCandidate) > 0) {
          winningCandidate = candidate;
        }
      });

      if (totalCustomers === 0) {
        boxesFallbackProximity += 1;
      }

      const winningBranchId = winningCandidate?.branchId || normalizedCandidateBranches[0].id;
      const winningBranchColor = branchColorById.get(winningBranchId) || BRANCH_COLOR_PALETTE[0];
      const allocation = {
        box_id: box.id,
        winner_branch_id: winningBranchId,
        color: winningBranchColor,
        score: Number((winningCandidate?.score || 0).toFixed(8)),
        had_customers: totalCustomers > 0,
        customer_count_in_box: totalCustomers,
        raw_customer_count_for_winner: Number(winningCandidate?.rawCustomerCount || 0),
        rowIndex,
        colIndex,
        centroid: box.centroid,
        bounds: box.bounds,
        polygon: box.polygon,
        customers: boxCustomers
      };

      allocations.push(allocation);
      boxesPerBranch[winningBranchId] = Number(boxesPerBranch[winningBranchId] || 0) + 1;

      if (!boxesByBranchId.has(winningBranchId)) {
        boxesByBranchId.set(winningBranchId, []);
      }
      boxesByBranchId.get(winningBranchId).push(allocation);

      if (!assignedCustomersByBranchId.has(winningBranchId)) {
        assignedCustomersByBranchId.set(winningBranchId, []);
      }
      assignedCustomersByBranchId.get(winningBranchId).push(...boxCustomers);
    }
  }

  ensureMinimumBoxOwnership({
    allocations,
    candidateBranches: normalizedCandidateBranches,
    boxesPerBranch,
    assignedCustomersByBranchId
  });

  normalizedCandidateBranches.forEach((branch) => {
    if (!Object.prototype.hasOwnProperty.call(boxesPerBranch, branch.id)) {
      boxesPerBranch[branch.id] = 0;
    }
  });

  const featureCollection = {
    type: 'FeatureCollection',
    features: []
  };

  normalizedCandidateBranches.forEach((branch) => {
    const branchBoxes = boxesByBranchId.get(branch.id) || [];
    if (branchBoxes.length === 0) {
      return;
    }

    const totalCustomerCount = (assignedCustomersByBranchId.get(branch.id) || []).length;
    const hadCustomers = branchBoxes.some((box) => box.had_customers);
    const averageScore = branchBoxes.reduce((sum, box) => sum + Number(box.score || 0), 0)
      / Math.max(branchBoxes.length, 1);

    if (mergeAdjacent) {
      const mergedGeometry = mergeBoxesIntoMultiPolygon(branchBoxes);
      if (mergedGeometry) {
        featureCollection.features.push({
          type: 'Feature',
          properties: {
            branchId: branch.id,
            winner_branch_id: branch.id,
            color: branchColorById.get(branch.id) || BRANCH_COLOR_PALETTE[0],
            branchColor: branchColorById.get(branch.id) || BRANCH_COLOR_PALETTE[0],
            score: Number(averageScore.toFixed(8)),
            had_customers: hadCustomers,
            customer_count_in_box: totalCustomerCount,
            box_count: branchBoxes.length
          },
          geometry: mergedGeometry
        });
      }
      return;
    }

    branchBoxes.forEach((box) => {
      featureCollection.features.push({
        type: 'Feature',
        properties: {
          branchId: branch.id,
          winner_branch_id: branch.id,
          color: branchColorById.get(branch.id) || BRANCH_COLOR_PALETTE[0],
          branchColor: branchColorById.get(branch.id) || BRANCH_COLOR_PALETTE[0],
          score: box.score,
          had_customers: box.had_customers,
          customer_count_in_box: box.customer_count_in_box
        },
        geometry: {
          type: 'Polygon',
          coordinates: box.polygon
        }
      });
    });
  });

  const selectedCustomers = {
    type: 'FeatureCollection',
    features: Array.from(assignedCustomersByBranchId.entries()).flatMap(([branchId, branchCustomers]) =>
      branchCustomers.map((customer) => buildCustomerFeature(customer, branchId, branchColorById))
    )
  };

  const originalCustomers = {
    type: 'FeatureCollection',
    features: Array.from(originalCustomersByBranchId.entries()).flatMap(([, branchCustomers]) =>
      branchCustomers.map((customer) => buildOriginalCustomerFeature(customer, branchColorById))
    )
  };

  const branches = {
    type: 'FeatureCollection',
    features: normalizedCandidateBranches.map((branch) => ({
      type: 'Feature',
      properties: {
        branchId: branch.id,
        city: branch.city,
        customerCount: (assignedCustomersByBranchId.get(branch.id) || []).length,
        branchColor: branchColorById.get(branch.id) || BRANCH_COLOR_PALETTE[0]
      },
      geometry: {
        type: 'Point',
        coordinates: [branch.lon, branch.lat]
      }
    }))
  };

  return {
    featureCollection,
    branches,
    selectedCustomers,
    originalCustomers,
    allocations,
    availableBranches: normalizedCandidateBranches.map((branch) => ({
      id: branch.id,
      city: branch.city,
      customerCount: (assignedCustomersByBranchId.get(branch.id) || []).length
    })),
    stats: {
      candidate_branch_ids: normalizedCandidateBranches.map((branch) => branch.id),
      total_boxes: grid.totalBoxes,
      boxes_per_branch: boxesPerBranch,
      boxes_with_customers: boxesWithCustomers,
      boxes_fallback_proximity: boxesFallbackProximity,
      compute_time_ms: Date.now() - startedAt,
      unassigned_boxes: Math.max(grid.totalBoxes - allocations.length, 0)
    },
    grid,
    warnings
  };
};

module.exports = {
  BRANCH_COLOR_PALETTE,
  DEFAULT_BUFFER_KM,
  DEFAULT_GRID_SIZE_KM,
  EPSILON_KM,
  allocateBranchCoverage,
  buildGridDefinition,
  buildBoxGeometry,
  compareAllocationCandidates,
  getGridPositionForPoint,
  haversineDistanceKm,
  mergeBoxesIntoMultiPolygon
};
