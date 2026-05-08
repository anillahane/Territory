const {
  runContinuousAllocation,
  runBucketAllocation
} = require('../../src/routes/territoryAllocator');

const generateGrid = (rows, cols, originLat, originLng, spacingKm, bucketResolver = null) => {
  const pockets = [];
  let idCounter = 0;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const lat = originLat + ((row * spacingKm) / 111);
      const lng = originLng + ((col * spacingKm) / (111 * Math.cos(originLat * Math.PI / 180)));
      pockets.push({
        pocketId: `P${String(idCounter).padStart(3, '0')}`,
        centerLat: lat,
        centerLng: lng,
        customerCount: 20,
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [lng, lat],
            [lng + 0.001, lat],
            [lng + 0.001, lat + 0.001],
            [lng, lat + 0.001],
            [lng, lat]
          ]]
        },
        bucket: bucketResolver ? bucketResolver(row, col) : null
      });
      idCounter += 1;
    }
  }

  return pockets;
};

describe('territoryAllocator', () => {
  test('continuous allocation assigns every pocket and keeps west/east bias', () => {
    const pockets = generateGrid(4, 6, 19.0, 72.8, 5);
    const employees = [
      { employeeId: 'EMP_WEST', originLat: 19.0, originLng: 72.8 },
      { employeeId: 'EMP_EAST', originLat: 19.0, originLng: 73.05 }
    ];

    const result = runContinuousAllocation({
      pockets,
      employees,
      levelMeters: 5000
    });

    expect(result.assignmentRows).toHaveLength(24);

    const westAssignments = result.assignmentRows.filter((row) => row.employee_id === 'EMP_WEST');
    const eastAssignments = result.assignmentRows.filter((row) => row.employee_id === 'EMP_EAST');
    expect(westAssignments.length + eastAssignments.length).toBe(24);

    const averageLng = (assignments) => assignments.reduce((sum, assignment) => {
      const pocket = pockets.find((candidate) => candidate.pocketId === assignment.pocket_id);
      return sum + Number(pocket.centerLng);
    }, 0) / assignments.length;

    expect(averageLng(westAssignments)).toBeLessThan(averageLng(eastAssignments));
  });

  test('bucket allocation assigns tagged buckets to the geographically closer employee', () => {
    const pockets = generateGrid(3, 6, 19.0, 72.8, 5, (row, col) => (col < 3 ? 'PREMIUM' : 'SME'));
    const employees = [
      { employeeId: 'EMP_WEST', originLat: 19.02, originLng: 72.84 },
      { employeeId: 'EMP_EAST', originLat: 19.02, originLng: 73.02 }
    ];

    const result = runBucketAllocation({
      pockets,
      employees,
      levelMeters: 5000
    });

    expect(result.assignmentRows).toHaveLength(18);
    expect(result.summary.totalBuckets).toBe(2);
    expect(result.bucketAssignments.PREMIUM.employeeId).toBe('EMP_WEST');
    expect(result.bucketAssignments.SME.employeeId).toBe('EMP_EAST');
  });

  test('large bucket falls back to continuous allocation within the bucket', () => {
    const pockets = generateGrid(4, 4, 19.0, 72.8, 5, () => 'MEGA')
      .map((pocket) => ({ ...pocket, customerCount: 100 }));
    const employees = [
      { employeeId: 'EMP_A', originLat: 19.0, originLng: 72.8 },
      { employeeId: 'EMP_B', originLat: 19.08, originLng: 72.9 },
      { employeeId: 'EMP_C', originLat: 19.16, originLng: 73.0 }
    ];

    const result = runBucketAllocation({
      pockets,
      employees,
      levelMeters: 5000,
      multiEmpThreshold: 2
    });

    expect(result.assignmentRows).toHaveLength(16);
    expect(result.metrics.some((metric) => metric.mode === 'scenario1_within_bucket')).toBe(true);
    expect(new Set(result.assignmentRows.map((row) => row.employee_id)).size).toBeGreaterThan(1);
  });
});
