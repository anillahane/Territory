const {
  runContinuousAllocation,
  runBucketAllocation,
  fetchPocketsWithBuckets,
  handleTerritoryAllocate
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

const buildGeometry = (lng, lat) => ({
  type: 'Polygon',
  coordinates: [[
    [lng, lat],
    [lng + 0.001, lat],
    [lng + 0.001, lat + 0.001],
    [lng, lat + 0.001],
    [lng, lat]
  ]]
});

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

  test('bucket allocation reuses idle employee capacity when there are enough pockets', () => {
    const pockets = generateGrid(2, 4, 19.0, 72.8, 5, (row, col) => (col < 2 ? 'ALPHA' : 'BETA'))
      .map((pocket) => ({ ...pocket, customerCount: 20 }));
    const employees = [
      { employeeId: 'EMP_ALPHA_1', originLat: 19.0, originLng: 72.8 },
      { employeeId: 'EMP_ALPHA_2', originLat: 19.01, originLng: 72.83 },
      { employeeId: 'EMP_BETA_1', originLat: 19.0, originLng: 72.91 },
      { employeeId: 'EMP_BETA_2', originLat: 19.01, originLng: 72.94 }
    ];

    const result = runBucketAllocation({
      pockets,
      employees,
      levelMeters: 5000,
      multiEmpThreshold: 2
    });

    expect(new Set(result.assignmentRows.map((row) => row.employee_id)).size).toBe(4);
    expect(result.summary.assignedEmployees).toBe(4);
    expect(result.summary.bucketsSplitToScenario1).toBe(true);
  });

  test('fetchPocketsWithBuckets joins mappings by pocket id instead of coordinate bounds', async () => {
    const client = {
      query: jest.fn().mockResolvedValue({ rows: [] })
    };

    await fetchPocketsWithBuckets(client, {
      branchId: 'BR001',
      levelMeters: 5000,
      catchmentRadius: 40000,
      latestJobId: 'JOB_BRANCH',
      pocketCodePattern: '^[0-9A-Z]{2}(?:-[0-9A-Z]{2}){0,4}$'
    });

    const queryText = client.query.mock.calls[0][0];
    expect(queryText).toContain('cpm.pocket_id = catchment_pockets.pocket_id');
    expect(queryText).not.toContain('cpm.customer_lat >=');
    expect(queryText).not.toContain('cpm.customer_lon >=');
  });

  test('handleTerritoryAllocate scopes automatic job selection to the requested branch', async () => {
    const client = {
      query: jest.fn(async (queryText, params) => {
        if (queryText.includes('ORDER BY j.completed_at DESC NULLS LAST, cpm.created_at DESC')) {
          return { rows: [{ job_id: 'JOB_BRANCH' }] };
        }

        if (queryText.includes('pg_advisory_xact_lock')) {
          return { rows: [] };
        }

        if (queryText.includes('FROM branch_employees be')) {
          return {
            rows: [
              {
                branch_employee_id: 1,
                employee_id: 'EMP_WEST',
                origin_lat: 19.0,
                origin_lng: 72.8
              },
              {
                branch_employee_id: 2,
                employee_id: 'EMP_EAST',
                origin_lat: 19.0,
                origin_lng: 72.9
              }
            ]
          };
        }

        if (queryText.includes('WITH branch_geom AS')) {
          return {
            rows: [
              {
                pocket_id: 'P001',
                center_lat: 19.0,
                center_lng: 72.8,
                geometry: buildGeometry(72.8, 19.0),
                customer_count: 12,
                bucket: 'ALPHA'
              },
              {
                pocket_id: 'P002',
                center_lat: 19.0,
                center_lng: 72.9,
                geometry: buildGeometry(72.9, 19.0),
                customer_count: 15,
                bucket: 'BETA'
              }
            ]
          };
        }

        if (queryText.includes('DELETE FROM employee_grid_cells')) {
          return { rowCount: 0, rows: [] };
        }

        if (queryText.includes('INSERT INTO employee_grid_cells')) {
          return { rowCount: 2, rows: [] };
        }

        if (queryText.includes('INSERT INTO territory_allocation_runs')) {
          return { rowCount: 1, rows: [] };
        }

        throw new Error(`Unexpected query: ${queryText.slice(0, 120)}`);
      })
    };

    const payload = await handleTerritoryAllocate({
      body: {
        branchId: 'BR001'
      },
      params: {},
      query: {}
    }, client);

    expect(payload.latestJobId).toBe('JOB_BRANCH');
    const latestJobLookup = client.query.mock.calls.find(([queryText]) =>
      queryText.includes('ORDER BY j.completed_at DESC NULLS LAST, cpm.created_at DESC')
    );
    expect(latestJobLookup[1]).toEqual(['BR001']);
  });

  test('handleTerritoryAllocate rejects explicit jobs without branch-scoped mappings', async () => {
    const client = {
      query: jest.fn(async (queryText) => {
        if (queryText.includes('WHERE cpm.job_id = $1')) {
          return { rows: [] };
        }

        throw new Error(`Unexpected query: ${queryText.slice(0, 120)}`);
      })
    };

    await expect(handleTerritoryAllocate({
      body: {
        branchId: 'BR001',
        jobId: 'JOB_OTHER_BRANCH'
      },
      params: {},
      query: {}
    }, client)).rejects.toMatchObject({
      statusCode: 404,
      code: 'NO_BRANCH_MAPPINGS_FOR_JOB'
    });
  });
});
