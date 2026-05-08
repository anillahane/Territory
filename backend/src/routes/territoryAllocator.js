const { haversineDistance } = require('../utils/geometry');
const { AppError } = require('../middleware/errorHandler');

const DEFAULT_LEVEL_METERS = 5000;
const DEFAULT_CATCHMENT_RADIUS_METERS = 40000;
const DEFAULT_POCKET_CODE_PATTERN = '^[0-9A-Z]{2}(?:-[0-9A-Z]{2}){0,4}$';

const normalizeCompassAngle = (angleDegrees) => {
  const normalized = Number(angleDegrees) % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

const calculateClockwiseAngleDegrees = (originLat, originLng, targetLat, targetLng) => {
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
  pockets.forEach((pocket) => adjacencyMap.set(pocket.pocketId, new Set()));

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
        const candidateIndices = bucketMap.get(
          `${bucketCoordinates.bucketX + deltaX}|${bucketCoordinates.bucketY + deltaY}`
        );
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

    const distanceFromOriginMeters = haversineDistance(
      Number(employeeState.originLat),
      Number(employeeState.originLng),
      Number(candidatePocket.centerLat),
      Number(candidatePocket.centerLng)
    );
    if (!Number.isFinite(distanceFromOriginMeters)) {
      return;
    }

    if (distanceFromOriginMeters < selectedDistance) {
      selectedDistance = distanceFromOriginMeters;
      selectedPocketId = pocketId;
      return;
    }

    if (
      distanceFromOriginMeters === selectedDistance
      && selectedPocketId
      && String(pocketId).localeCompare(String(selectedPocketId)) < 0
    ) {
      selectedPocketId = pocketId;
    }
  });

  stalePocketIds.forEach((pocketId) => employeeState.frontier.delete(pocketId));
  return selectedPocketId;
};

const normalizeWeight = (areaWeight, accountWeight) => {
  const sum = Number(areaWeight) + Number(accountWeight);
  if (!Number.isFinite(sum) || sum <= 0) {
    return { normalizedAreaWeight: 0.5, normalizedAccountWeight: 0.5 };
  }

  return {
    normalizedAreaWeight: Number(areaWeight) / sum,
    normalizedAccountWeight: Number(accountWeight) / sum
  };
};

const normalizeBucketValue = (value) => {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized.toUpperCase() : null;
};

const calculateBucketCentroid = (bucketPockets) => {
  const totals = bucketPockets.reduce((accumulator, pocket) => ({
    lat: accumulator.lat + Number(pocket.centerLat),
    lng: accumulator.lng + Number(pocket.centerLng)
  }), { lat: 0, lng: 0 });

  return {
    lat: totals.lat / Math.max(bucketPockets.length, 1),
    lng: totals.lng / Math.max(bucketPockets.length, 1)
  };
};

const rankEmployeesForBucket = (
  employees,
  centroidLat,
  centroidLng,
  excludedEmployeeIds = new Set()
) =>
  [...employees]
    .filter((employee) => !excludedEmployeeIds.has(employee.employeeId))
    .map((employee) => ({
      ...employee,
      distanceToBucket: haversineDistance(
        Number(employee.originLat),
        Number(employee.originLng),
        centroidLat,
        centroidLng
      )
    }))
    .sort((left, right) => {
      if (left.distanceToBucket !== right.distanceToBucket) {
        return left.distanceToBucket - right.distanceToBucket;
      }

      return String(left.employeeId).localeCompare(String(right.employeeId));
    });

const assignNearestUnassignedEmployeeToBucketPlan = (
  bucketPlan,
  employees,
  globallyAssignedEmployeeIds
) => {
  const rankedCandidates = rankEmployeesForBucket(
    employees,
    bucketPlan.centroidLat,
    bucketPlan.centroidLng,
    globallyAssignedEmployeeIds
  );
  const selectedEmployee = rankedCandidates[0];

  if (!selectedEmployee) {
    return false;
  }

  bucketPlan.assignedEmployeeIds.push(selectedEmployee.employeeId);
  globallyAssignedEmployeeIds.add(selectedEmployee.employeeId);
  return true;
};

const runContinuousAllocation = ({
  pockets,
  employees,
  levelMeters = DEFAULT_LEVEL_METERS,
  areaWeight = 0.5,
  accountWeight = 0.5,
  areaSafeguard = 1.3
}) => {
  if (!Array.isArray(pockets) || pockets.length === 0) {
    throw new Error('At least one pocket is required');
  }

  if (!Array.isArray(employees) || employees.length === 0) {
    throw new Error('At least one employee is required');
  }

  const pocketById = new Map();
  pockets.forEach((pocket) => {
    pocketById.set(pocket.pocketId, { ...pocket });
  });

  const adjacencyMap = buildPocketAdjacencyMap(pockets, levelMeters, pockets[0].centerLat);
  const unassignedPocketIds = new Set(pockets.map((pocket) => pocket.pocketId));
  const assignmentByPocketId = new Map();
  const employeeCount = employees.length;
  const totalCustomers = pockets.reduce(
    (sum, pocket) => sum + Math.max(Number(pocket.customerCount || 0), 0),
    0
  );
  const targetCustomers = employeeCount > 0 ? totalCustomers / employeeCount : 0;
  const targetArea = employeeCount > 0 ? pockets.length / employeeCount : 0;
  const areaSafeguardLimit = targetArea * Math.max(Number(areaSafeguard) || 1.3, 1);
  const diagnostics = [];
  const { normalizedAreaWeight, normalizedAccountWeight } = normalizeWeight(
    areaWeight,
    accountWeight
  );

  const employeeStates = employees.map((employee) => ({
    ...employee,
    originLat: Number(employee.originLat),
    originLng: Number(employee.originLng),
    seedPocketId: null,
    currentCustomers: 0,
    currentArea: 0,
    frontier: new Set(),
    ownedPocketIds: new Set(),
    done: false
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

  employeeStates.forEach((employeeState) => {
    if (unassignedPocketIds.size === 0) {
      return;
    }

    let bestPocketId = null;
    let bestDistanceMeters = Number.POSITIVE_INFINITY;

    unassignedPocketIds.forEach((candidatePocketId) => {
      const candidatePocket = pocketById.get(candidatePocketId);
      if (!candidatePocket) {
        return;
      }

      const distanceMeters = haversineDistance(
        employeeState.originLat,
        employeeState.originLng,
        Number(candidatePocket.centerLat),
        Number(candidatePocket.centerLng)
      );

      if (!Number.isFinite(distanceMeters)) {
        return;
      }

      if (distanceMeters < bestDistanceMeters) {
        bestDistanceMeters = distanceMeters;
        bestPocketId = candidatePocketId;
        return;
      }

      if (
        distanceMeters === bestDistanceMeters
        && bestPocketId
        && String(candidatePocketId).localeCompare(String(bestPocketId)) < 0
      ) {
        bestPocketId = candidatePocketId;
      }
    });

    if (bestPocketId) {
      employeeState.seedPocketId = bestPocketId;
      claimPocket(employeeState, bestPocketId, 'origin_seed');
    }
  });

  let growthProgress = true;
  while (unassignedPocketIds.size > 0 && growthProgress) {
    growthProgress = false;

    employeeStates.forEach((employeeState) => {
      if (!employeeState.seedPocketId || employeeState.done) {
        return;
      }

      const customerProgress = targetCustomers > 0
        ? Number(employeeState.currentCustomers || 0) / targetCustomers
        : 1;
      const areaProgress = targetArea > 0
        ? Number(employeeState.currentArea || 0) / targetArea
        : 1;
      const blendedScore = (normalizedAccountWeight * customerProgress)
        + (normalizedAreaWeight * areaProgress);

      if (
        blendedScore >= 1
        || Number(employeeState.currentArea || 0) >= areaSafeguardLimit
      ) {
        employeeState.done = true;
        return;
      }

      if (employeeState.frontier.size === 0) {
        refillFrontierFromOwnedPockets(employeeState, adjacencyMap, unassignedPocketIds);
      }

      const nextPocketId = pickNearestFrontierPocket(
        employeeState,
        pocketById,
        unassignedPocketIds
      );

      if (!nextPocketId) {
        employeeState.done = true;
        return;
      }

      if (claimPocket(employeeState, nextPocketId, 'balanced_growth')) {
        growthProgress = true;
      }
    });
  }

  if (unassignedPocketIds.size > 0) {
    employeeStates.forEach((employeeState) => {
      employeeState.done = false;
    });

    let sweepProgress = true;
    while (unassignedPocketIds.size > 0 && sweepProgress) {
      sweepProgress = false;

      employeeStates.forEach((employeeState) => {
        if (employeeState.frontier.size === 0) {
          refillFrontierFromOwnedPockets(employeeState, adjacencyMap, unassignedPocketIds);
        }

        const nextPocketId = pickNearestFrontierPocket(
          employeeState,
          pocketById,
          unassignedPocketIds
        );

        if (nextPocketId && claimPocket(employeeState, nextPocketId, 'sweep')) {
          sweepProgress = true;
        }
      });
    }
  }

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
          Number(orphanPocket.centerLat),
          Number(orphanPocket.centerLng),
          Number(assignedPocket.centerLat),
          Number(assignedPocket.centerLng)
        );
        if (!Number.isFinite(distanceMeters) || distanceMeters >= nearestDistance) {
          return;
        }

        nearestDistance = distanceMeters;
        nearestOwner = ownerState;
      });

      claimPocket(nearestOwner, orphanPocketId, 'orphan_fallback');
    });
  }

  const assignmentRows = pockets.map((pocket) => {
    const owner = assignmentByPocketId.get(pocket.pocketId) || employeeStates[0];
    return {
      pocket_id: pocket.pocketId,
      employee_id: owner?.employeeId || null,
      account_count: Math.max(Number(pocket.customerCount || 0), 0),
      geometry: pocket.geometry,
      bucket: normalizeBucketValue(pocket.bucket)
    };
  });

  const metrics = employeeStates.map((employeeState) => ({
    employeeId: employeeState.employeeId,
    pocketCount: employeeState.ownedPocketIds.size,
    accountTotal: Number(employeeState.currentCustomers || 0),
    targetAccounts: Math.round(targetCustomers),
    targetArea: Math.round(targetArea),
    originLat: Number(employeeState.originLat),
    originLng: Number(employeeState.originLng)
  }));

  return {
    assignmentRows,
    diagnostics,
    metrics,
    summary: {
      totalPockets: pockets.length,
      totalAccounts: totalCustomers,
      assignedEmployees: employees.length,
      targetAccountsPerEmployee: Math.round(targetCustomers),
      targetAreaPerEmployee: Math.round(targetArea)
    }
  };
};

const computeBucketEmployeeCost = (bucketPockets, employee) =>
  bucketPockets.reduce(
    (totalDistance, pocket) => totalDistance + haversineDistance(
      Number(employee.originLat),
      Number(employee.originLng),
      Number(pocket.centerLat),
      Number(pocket.centerLng)
    ),
    0
  );

const computeBucketLoad = (bucketPockets) =>
  bucketPockets.reduce(
    (totalCustomers, pocket) => totalCustomers + Math.max(Number(pocket.customerCount || 0), 0),
    0
  );

const permutations = (values) => {
  if (values.length <= 1) {
    return [values];
  }

  const result = [];
  for (let index = 0; index < values.length; index += 1) {
    const nextValues = [...values.slice(0, index), ...values.slice(index + 1)];
    permutations(nextValues).forEach((permutation) => {
      result.push([values[index], ...permutation]);
    });
  }

  return result;
};

const greedyBucketAssignment = (costMatrix, bucketKeys, employeeIds) => {
  const assignment = {};
  const assignedEmployees = new Set();
  const assignedBuckets = new Set();
  const rankedPairs = [];

  bucketKeys.forEach((bucketKey, bucketIndex) => {
    employeeIds.forEach((employeeId, employeeIndex) => {
      rankedPairs.push({
        bucketKey,
        employeeId,
        cost: costMatrix[bucketIndex][employeeIndex]
      });
    });
  });

  rankedPairs.sort((left, right) => left.cost - right.cost);
  rankedPairs.forEach(({ bucketKey, employeeId, cost }) => {
    if (assignedBuckets.has(bucketKey) || assignedEmployees.has(employeeId)) {
      return;
    }

    assignment[bucketKey] = { employeeId, cost };
    assignedBuckets.add(bucketKey);
    assignedEmployees.add(employeeId);
  });

  bucketKeys.forEach((bucketKey) => {
    if (assignment[bucketKey]) {
      return;
    }

    let selectedEmployeeId = employeeIds[0];
    let selectedLoad = Number.POSITIVE_INFINITY;

    employeeIds.forEach((employeeId) => {
      const currentLoad = Object.values(assignment)
        .filter((candidateAssignment) => candidateAssignment.employeeId === employeeId)
        .length;

      if (currentLoad < selectedLoad) {
        selectedLoad = currentLoad;
        selectedEmployeeId = employeeId;
      }
    });

    const bucketIndex = bucketKeys.indexOf(bucketKey);
    const employeeIndex = employeeIds.indexOf(selectedEmployeeId);
    assignment[bucketKey] = {
      employeeId: selectedEmployeeId,
      cost: costMatrix[bucketIndex][employeeIndex]
    };
  });

  return assignment;
};

const runBucketAllocation = ({
  pockets,
  employees,
  levelMeters = DEFAULT_LEVEL_METERS,
  multiEmpThreshold = 2,
  areaWeight = 0.5,
  accountWeight = 0.5
}) => {
  if (!Array.isArray(pockets) || pockets.length === 0) {
    throw new Error('At least one pocket is required');
  }

  if (!Array.isArray(employees) || employees.length === 0) {
    throw new Error('At least one employee is required');
  }

  const normalizedThreshold = Math.max(1, Math.floor(Number(multiEmpThreshold) || 2));
  const bucketMap = new Map();

  pockets.forEach((pocket) => {
    const bucketKey = normalizeBucketValue(pocket.bucket) || 'UNTAGGED';
    if (!bucketMap.has(bucketKey)) {
      bucketMap.set(bucketKey, []);
    }
    bucketMap.get(bucketKey).push({ ...pocket, bucket: bucketKey });
  });

  const bucketKeys = Array.from(bucketMap.keys());
  const employeeIds = employees.map((employee) => employee.employeeId);
  const totalCustomers = pockets.reduce(
    (sum, pocket) => sum + Math.max(Number(pocket.customerCount || 0), 0),
    0
  );
  const targetPerEmployee = employees.length > 0 ? totalCustomers / employees.length : 0;
  const costMatrix = bucketKeys.map((bucketKey) =>
    employees.map((employee) => computeBucketEmployeeCost(bucketMap.get(bucketKey), employee))
  );

  let bucketAssignments;
  if (bucketKeys.length <= 8 && employees.length <= 8) {
    const employeePermutations = permutations(employeeIds);
    let bestPermutation = employeePermutations[0] || employeeIds;
    let bestCost = Number.POSITIVE_INFINITY;

    employeePermutations.forEach((permutation) => {
      let permutationCost = 0;
      bucketKeys.forEach((bucketKey, bucketIndex) => {
        const employeeId = permutation[bucketIndex % permutation.length];
        const employeeIndex = employeeIds.indexOf(employeeId);
        permutationCost += costMatrix[bucketIndex][employeeIndex];
      });

      if (permutationCost < bestCost) {
        bestCost = permutationCost;
        bestPermutation = permutation;
      }
    });

    bucketAssignments = {};
    bucketKeys.forEach((bucketKey, bucketIndex) => {
      const employeeId = bestPermutation[bucketIndex % bestPermutation.length];
      const employeeIndex = employeeIds.indexOf(employeeId);
      bucketAssignments[bucketKey] = {
        employeeId,
        cost: costMatrix[bucketIndex][employeeIndex]
      };
    });
  } else {
    bucketAssignments = greedyBucketAssignment(costMatrix, bucketKeys, employeeIds);
  }

  const assignmentRows = [];
  const diagnostics = [];
  const metrics = [];
  const employeeById = new Map(
    employees.map((employee) => [employee.employeeId, { ...employee }])
  );
  let directBucketCount = 0;

  const bucketPlans = bucketKeys.map((bucketKey) => {
    const bucketPockets = bucketMap.get(bucketKey) || [];
    const bucketLoad = computeBucketLoad(bucketPockets);
    const bucketCentroid = calculateBucketCentroid(bucketPockets);
    const primaryEmployeeId = bucketAssignments[bucketKey]?.employeeId || employeeIds[0];
    const neededEmployees = Math.max(
      1,
      Math.ceil(bucketLoad / Math.max(targetPerEmployee, 1))
    );

    return {
      bucketKey,
      bucketPockets,
      bucketLoad,
      centroidLat: bucketCentroid.lat,
      centroidLng: bucketCentroid.lng,
      primaryEmployeeId,
      slotCount: neededEmployees <= normalizedThreshold
        ? 1
        : Math.min(neededEmployees, bucketPockets.length, employees.length),
      assignedEmployeeIds: primaryEmployeeId ? [primaryEmployeeId] : []
    };
  });

  const targetAssignedEmployeeCount = Math.min(employees.length, pockets.length);
  const globallyAssignedEmployeeIds = new Set(
    bucketPlans.flatMap((bucketPlan) => bucketPlan.assignedEmployeeIds)
  );

  bucketPlans
    .filter((bucketPlan) => bucketPlan.slotCount > bucketPlan.assignedEmployeeIds.length)
    .sort((left, right) => {
      if (right.slotCount !== left.slotCount) {
        return right.slotCount - left.slotCount;
      }

      if (right.bucketLoad !== left.bucketLoad) {
        return right.bucketLoad - left.bucketLoad;
      }

      return String(left.bucketKey).localeCompare(String(right.bucketKey));
    })
    .forEach((bucketPlan) => {
      while (
        bucketPlan.assignedEmployeeIds.length < bucketPlan.slotCount
        && globallyAssignedEmployeeIds.size < targetAssignedEmployeeCount
      ) {
        if (!assignNearestUnassignedEmployeeToBucketPlan(
          bucketPlan,
          employees,
          globallyAssignedEmployeeIds
        )) {
          break;
        }
      }
    });

  while (globallyAssignedEmployeeIds.size < targetAssignedEmployeeCount) {
    const candidatePlans = bucketPlans
      .filter((bucketPlan) =>
        bucketPlan.assignedEmployeeIds.length
          < Math.min(bucketPlan.bucketPockets.length, targetAssignedEmployeeCount)
      )
      .sort((left, right) => {
        const leftLoadPerEmployee = left.bucketLoad / Math.max(left.assignedEmployeeIds.length, 1);
        const rightLoadPerEmployee = right.bucketLoad / Math.max(right.assignedEmployeeIds.length, 1);

        if (rightLoadPerEmployee !== leftLoadPerEmployee) {
          return rightLoadPerEmployee - leftLoadPerEmployee;
        }

        if (right.bucketLoad !== left.bucketLoad) {
          return right.bucketLoad - left.bucketLoad;
        }

        return String(left.bucketKey).localeCompare(String(right.bucketKey));
      });

    if (candidatePlans.length === 0) {
      break;
    }

    if (!assignNearestUnassignedEmployeeToBucketPlan(
      candidatePlans[0],
      employees,
      globallyAssignedEmployeeIds
    )) {
      break;
    }
  }

  bucketPlans.forEach((bucketPlan) => {
    bucketAssignments[bucketPlan.bucketKey] = {
      ...bucketAssignments[bucketPlan.bucketKey],
      employeeId: bucketPlan.primaryEmployeeId,
      employeeIds: [...bucketPlan.assignedEmployeeIds]
    };
  });

  bucketPlans.forEach((bucketPlan) => {
    const bucketPockets = bucketPlan.bucketPockets;
    const bucketEmployees = bucketPlan.assignedEmployeeIds
      .map((employeeId) => employeeById.get(employeeId))
      .filter(Boolean);

    if (bucketEmployees.length <= 1) {
      directBucketCount += 1;

      const primaryEmployeeId = bucketEmployees[0]?.employeeId || bucketPlan.primaryEmployeeId;
      bucketPockets.forEach((bucketPocket) => {
        assignmentRows.push({
          pocket_id: bucketPocket.pocketId,
          employee_id: primaryEmployeeId,
          account_count: Math.max(Number(bucketPocket.customerCount || 0), 0),
          geometry: bucketPocket.geometry,
          bucket: bucketPlan.bucketKey
        });
      });

      metrics.push({
        employeeId: primaryEmployeeId,
        bucket: bucketPlan.bucketKey,
        mode: 'direct',
        pocketCount: bucketPockets.length,
        accountTotal: bucketPlan.bucketLoad
      });
      return;
    }

    const subAllocation = runContinuousAllocation({
      pockets: bucketPockets,
      employees: bucketEmployees,
      levelMeters,
      areaWeight,
      accountWeight
    });

    subAllocation.assignmentRows.forEach((assignmentRow) => {
      assignmentRows.push({
        ...assignmentRow,
        bucket: bucketPlan.bucketKey
      });
    });

    subAllocation.metrics.forEach((metric) => {
      metrics.push({
        ...metric,
        bucket: bucketPlan.bucketKey,
        mode: 'scenario1_within_bucket'
      });
    });

    subAllocation.diagnostics.forEach((diagnostic) => {
      diagnostics.push({
        ...diagnostic,
        bucket: bucketPlan.bucketKey
      });
    });
  });

  const assignedEmployeeCount = new Set(
    assignmentRows
      .map((assignmentRow) => assignmentRow.employee_id)
      .filter((employeeId) => employeeId !== undefined && employeeId !== null && employeeId !== '')
  ).size;

  return {
    assignmentRows,
    bucketAssignments,
    diagnostics,
    metrics,
    summary: {
      totalPockets: pockets.length,
      totalAccounts: totalCustomers,
      totalBuckets: bucketKeys.length,
      assignedEmployees: assignedEmployeeCount,
      bucketsDirectAssigned: directBucketCount,
      bucketsSplitToScenario1: metrics.some((metric) => metric.mode === 'scenario1_within_bucket')
    }
  };
};

const resolvePositiveInteger = (value, fallbackValue) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackValue;
  }

  return Math.round(parsed);
};

const resolvePositiveNumber = (value, fallbackValue) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackValue;
  }

  return parsed;
};

const acquireBranchAllocationLock = async (client, branchId) => {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1::text))',
    [`territory:${String(branchId || '').trim()}`]
  );
};

const resolveLatestMappingsJobId = async (client, branchId) => {
  const result = await client.query(
    `
      SELECT cpm.job_id
      FROM customer_pocket_mappings cpm
      JOIN jobs j ON j.job_id = cpm.job_id
      WHERE cpm.nearest_branch_id = $1
      ORDER BY j.completed_at DESC NULLS LAST, cpm.created_at DESC
      LIMIT 1
    `,
    [branchId]
  );

  return result.rows.length > 0 ? result.rows[0].job_id : null;
};

const resolveMappingsJobIdForBranch = async (client, branchId, requestedJobId) => {
  const normalizedRequestedJobId = String(requestedJobId || '').trim();

  if (normalizedRequestedJobId) {
    const scopedJobResult = await client.query(
      `
        SELECT 1
        FROM customer_pocket_mappings cpm
        WHERE cpm.job_id = $1
          AND cpm.nearest_branch_id = $2
        LIMIT 1
      `,
      [normalizedRequestedJobId, branchId]
    );

    if (scopedJobResult.rows.length === 0) {
      throw new AppError(
        `No customer mappings found for branch ${branchId} in job ${normalizedRequestedJobId}.`,
        404,
        'NO_BRANCH_MAPPINGS_FOR_JOB'
      );
    }

    return normalizedRequestedJobId;
  }

  return resolveLatestMappingsJobId(client, branchId);
};

const fetchEmployeesWithOrigins = async (client, branchId) => {
  const result = await client.query(
    `
      SELECT
        be.id::int AS branch_employee_id,
        be.employee_id::text AS employee_id,
        COALESCE(be.residence_lat, ST_Y(b.geom::geometry), b.lat)::double precision AS origin_lat,
        COALESCE(be.residence_lon, ST_X(b.geom::geometry), b.lon)::double precision AS origin_lng
      FROM branch_employees be
      JOIN branches b
        ON b.id = be.branch_id
      WHERE be.branch_id = $1
        AND be.is_active = TRUE
      ORDER BY be.employee_id
    `,
    [branchId]
  );

  return result.rows
    .map((row) => ({
      branchEmployeeId: Number(row.branch_employee_id),
      employeeId: String(row.employee_id || '').trim(),
      originLat: Number(row.origin_lat),
      originLng: Number(row.origin_lng)
    }))
    .filter((employee) =>
      employee.employeeId
      && Number.isFinite(employee.originLat)
      && Number.isFinite(employee.originLng)
    );
};

const fetchPocketsWithBuckets = async (
  client,
  {
    branchId,
    levelMeters,
    catchmentRadius,
    latestJobId,
    pocketCodePattern
  }
) => {
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
      catchment_pockets AS (
        SELECT
          gc.code::text AS pocket_id,
          COALESCE(gc.label_lat, ST_Y(ST_PointOnSurface(gc.geom)))::double precision AS center_lat,
          COALESCE(gc.label_lon, ST_X(ST_PointOnSurface(gc.geom)))::double precision AS center_lng,
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
            ST_PointOnSurface(gc.geom)::geography,
            bg.geom::geography,
            $3::double precision
          )
      ),
      pocket_customers AS (
        SELECT
          catchment_pockets.pocket_id,
          COUNT(cpm.job_id)::int AS customer_count,
          MODE() WITHIN GROUP (
            ORDER BY cpm.customer_bucket
          ) FILTER (
            WHERE cpm.customer_bucket IS NOT NULL
              AND btrim(cpm.customer_bucket) <> ''
          ) AS dominant_bucket
        FROM catchment_pockets
        LEFT JOIN customer_pocket_mappings cpm
          ON cpm.job_id = $4
         AND cpm.nearest_branch_id = $1
         AND cpm.pocket_id = catchment_pockets.pocket_id
        GROUP BY catchment_pockets.pocket_id
      )
      SELECT
        catchment_pockets.pocket_id,
        catchment_pockets.center_lat,
        catchment_pockets.center_lng,
        catchment_pockets.geometry,
        COALESCE(pocket_customers.customer_count, 0)::int AS customer_count,
        pocket_customers.dominant_bucket AS bucket
      FROM catchment_pockets
      LEFT JOIN pocket_customers
        ON pocket_customers.pocket_id = catchment_pockets.pocket_id
      ORDER BY catchment_pockets.pocket_id
    `,
    [branchId, levelMeters, catchmentRadius, latestJobId, pocketCodePattern]
  );

  return result.rows
    .map((row) => ({
      pocketId: String(row.pocket_id || '').trim(),
      centerLat: Number(row.center_lat),
      centerLng: Number(row.center_lng),
      customerCount: Math.max(Number(row.customer_count || 0), 0),
      geometry: row.geometry,
      bucket: normalizeBucketValue(row.bucket)
    }))
    .filter((pocket) =>
      pocket.pocketId
      && Number.isFinite(pocket.centerLat)
      && Number.isFinite(pocket.centerLng)
      && pocket.geometry
    );
};

const persistAllocation = async (client, branchId, assignmentRows) => {
  await client.query(
    `
      DELETE FROM employee_grid_cells
      WHERE branch_id = $1
        AND COALESCE(level_km, 1) = 1
    `,
    [branchId]
  );

  if (!Array.isArray(assignmentRows) || assignmentRows.length === 0) {
    return 0;
  }

  const result = await client.query(
    `
      INSERT INTO employee_grid_cells (
        branch_id,
        pocket_id,
        level_km,
        account_count,
        assigned_employee_id,
        geom,
        bucket
      )
      SELECT
        $1::varchar AS branch_id,
        assignments.pocket_id::varchar AS pocket_id,
        1::integer AS level_km,
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
        )::geometry(POLYGON, 4326) AS geom,
        NULLIF(btrim(assignments.bucket), '')::varchar AS bucket
      FROM jsonb_to_recordset($2::jsonb) AS assignments(
        pocket_id text,
        employee_id text,
        account_count integer,
        geometry jsonb,
        bucket text
      )
    `,
    [branchId, JSON.stringify(assignmentRows)]
  );

  return Number(result.rowCount || 0);
};

const persistAllocationAudit = async (
  client,
  {
    branchId,
    scenario,
    levelMeters,
    employees,
    result,
    areaWeight,
    accountWeight,
    areaSafeguard
  }
) => {
  await client.query(
    `
      INSERT INTO territory_allocation_runs (
        branch_id,
        scenario,
        level_meters,
        employee_count,
        pocket_count,
        total_accounts,
        bucket_count,
        area_weight,
        account_weight,
        area_safeguard,
        metrics
      )
      VALUES (
        $1::varchar,
        $2::varchar,
        $3::integer,
        $4::integer,
        $5::integer,
        $6::integer,
        $7::integer,
        $8::double precision,
        $9::double precision,
        $10::double precision,
        $11::jsonb
      )
    `,
    [
      branchId,
      scenario,
      levelMeters,
      employees.length,
      Number(result?.summary?.totalPockets || 0),
      Number(result?.summary?.totalAccounts || 0),
      Number(result?.summary?.totalBuckets || 0) || null,
      Number(areaWeight),
      Number(accountWeight),
      Number(areaSafeguard),
      JSON.stringify({
        summary: result?.summary || {},
        metrics: Array.isArray(result?.metrics) ? result.metrics : []
      })
    ]
  );
};

const mapTerritoryAllocationError = (error) => {
  if (!error) {
    return error;
  }

  const errorCode = String(error.code || '');
  const errorMessage = String(error.message || '').toLowerCase();
  const missingMigrationMarkers = [
    'residence_lat',
    'residence_lon',
    'customer_bucket',
    'territory_allocation_runs',
    'employee_grid_cells',
    'bucket'
  ];

  if (
    (errorCode === '42703' || errorCode === '42P01')
    && missingMigrationMarkers.some((marker) => errorMessage.includes(marker))
  ) {
    return new AppError(
      'Territory allocation support tables are not initialized. Apply migration 015_territory_allocation_support.sql before using this endpoint.',
      503,
      'TERRITORY_ALLOCATION_NOT_INITIALIZED'
    );
  }

  return error;
};

const handleTerritoryAllocate = async (req, client) => {
  try {
    const branchId = String(
      req.body?.branchId
      || req.params?.branchId
      || req.query?.branchId
      || ''
    ).trim();

    if (!branchId) {
      throw new AppError('branchId is required', 400, 'MISSING_BRANCH_ID');
    }

    const requestedScenario = req.body?.scenario === undefined || req.body?.scenario === null
      ? ''
      : String(req.body.scenario).trim().toLowerCase();

    if (requestedScenario && !['continuous', 'bucket'].includes(requestedScenario)) {
      throw new AppError(
        'scenario must be either continuous or bucket',
        400,
        'INVALID_SCENARIO'
      );
    }

    const levelMeters = resolvePositiveInteger(
      req.body?.levelMeters ?? req.body?.level_m ?? req.body?.levelM,
      DEFAULT_LEVEL_METERS
    );
    const catchmentRadius = resolvePositiveNumber(
      req.body?.catchmentRadius,
      DEFAULT_CATCHMENT_RADIUS_METERS
    ) + (levelMeters / 2);
    const parsedAreaWeight = Number(req.body?.areaWeight);
    const parsedAccountWeight = Number(req.body?.accountWeight);
    const areaWeight = Number.isFinite(parsedAreaWeight) && parsedAreaWeight >= 0
      ? parsedAreaWeight
      : 0.5;
    const accountWeight = Number.isFinite(parsedAccountWeight) && parsedAccountWeight >= 0
      ? parsedAccountWeight
      : 0.5;
    const areaSafeguard = resolvePositiveNumber(req.body?.areaSafeguard, 1.3);
    const multiEmpThreshold = resolvePositiveInteger(req.body?.multiEmpThreshold, 2);
    const requestedJobId = String(
      req.body?.latestJobId
      || req.body?.jobId
      || req.query?.latestJobId
      || req.query?.jobId
      || ''
    ).trim();
    const latestJobId = await resolveMappingsJobIdForBranch(
      client,
      branchId,
      requestedJobId
    );
    const pocketCodePattern = String(
      req.body?.pocketCodePattern || DEFAULT_POCKET_CODE_PATTERN
    ).trim() || DEFAULT_POCKET_CODE_PATTERN;

    if (!latestJobId) {
      throw new AppError(
        `No customer mappings are available for branch ${branchId}. Upload and process a mapping file before territory allocation.`,
        404,
        'NO_MAPPINGS'
      );
    }

    await acquireBranchAllocationLock(client, branchId);

    const employees = await fetchEmployeesWithOrigins(client, branchId);
    if (employees.length === 0) {
      throw new AppError(
        `No active employees found for branch ${branchId}.`,
        422,
        'NO_ACTIVE_EMPLOYEES'
      );
    }

    const pockets = await fetchPocketsWithBuckets(client, {
      branchId,
      levelMeters,
      catchmentRadius,
      latestJobId,
      pocketCodePattern
    });

    if (pockets.length === 0) {
      throw new AppError(
        `No eligible ${levelMeters}m pockets were found in the branch catchment for ${branchId}.`,
        422,
        'NO_ELIGIBLE_POCKETS'
      );
    }

    if (pockets.length < employees.length) {
      throw new AppError(
        `Branch ${branchId} has ${employees.length} active employees but only ${pockets.length} eligible pockets.`,
        422,
        'INSUFFICIENT_POCKETS_FOR_EMPLOYEES'
      );
    }

    const hasBucketData = pockets.some((pocket) => normalizeBucketValue(pocket.bucket));
    const scenario = requestedScenario || (hasBucketData ? 'bucket' : 'continuous');

    const result = scenario === 'bucket'
      ? runBucketAllocation({
        pockets,
        employees,
        levelMeters,
        multiEmpThreshold,
        areaWeight,
        accountWeight
      })
      : runContinuousAllocation({
        pockets,
        employees,
        levelMeters,
        areaWeight,
        accountWeight,
        areaSafeguard
      });

    const persisted = await persistAllocation(client, branchId, result.assignmentRows);
    await persistAllocationAudit(client, {
      branchId,
      scenario,
      levelMeters,
      employees,
      result,
      areaWeight,
      accountWeight,
      areaSafeguard
    });

    return {
      branchId,
      latestJobId,
      scenario,
      levelMeters,
      catchmentRadius,
      persisted,
      summary: result.summary,
      metrics: result.metrics,
      diagnostics: result.diagnostics,
      bucketAssignments: result.bucketAssignments || null,
      assignmentRows: result.assignmentRows
    };
  } catch (error) {
    throw mapTerritoryAllocationError(error);
  }
};

module.exports = {
  runContinuousAllocation,
  runBucketAllocation,
  fetchEmployeesWithOrigins,
  fetchPocketsWithBuckets,
  persistAllocation,
  handleTerritoryAllocate,
  resolveMappingsJobIdForBranch,
  buildPocketAdjacencyMap,
  calculateClockwiseAngleDegrees,
  calculateAngularDifferenceDegrees,
  computeBucketEmployeeCost,
  computeBucketLoad
};
