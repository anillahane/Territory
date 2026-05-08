const {
  allocateBranchCoverage,
  buildBoxGeometry,
  buildGridDefinition,
  compareAllocationCandidates,
  mergeBoxesIntoMultiPolygon
} = require('../../src/services/branchCoverageGridAllocator');

describe('branchCoverageGridAllocator', () => {
  test('buildGridDefinition creates a valid 5km grid with centroids inside bounds', () => {
    const grid = buildGridDefinition({
      branches: [
        { id: 'A', lat: 20.0, lon: 77.0 }
      ],
      customers: [
        { id: 'C1', lat: 20.01, lon: 77.01 }
      ],
      gridSizeKm: 5
    });

    expect(grid).toBeTruthy();
    expect(grid.gridSizeKm).toBe(5);
    expect(grid.rows).toBeGreaterThan(0);
    expect(grid.cols).toBeGreaterThan(0);

    const box = buildBoxGeometry(grid, 0, 0);
    expect(box.centroid.lat).toBeGreaterThan(box.bounds.min_lat);
    expect(box.centroid.lat).toBeLessThan(box.bounds.max_lat);
    expect(box.centroid.lng).toBeGreaterThan(box.bounds.min_lng);
    expect(box.centroid.lng).toBeLessThan(box.bounds.max_lng);
  });

  test('weighted score favors the branch with stronger home-customer concentration in a box', () => {
    const result = allocateBranchCoverage({
      allBranches: [
        { id: 'A', lat: 20.0, lon: 77.0 },
        { id: 'B', lat: 20.0, lon: 77.0 }
      ],
      candidateBranches: [
        { id: 'A', lat: 20.0, lon: 77.0 },
        { id: 'B', lat: 20.0, lon: 77.0 }
      ],
      customers: [
        { id: 'C1', lat: 20.005, lon: 77.005, homeBranchId: 'A' },
        { id: 'C2', lat: 20.0052, lon: 77.0051, homeBranchId: 'A' },
        { id: 'C3', lat: 20.0051, lon: 77.0052, homeBranchId: 'B' }
      ],
      gridSizeKm: 5,
      mergeAdjacent: false
    });

    const populatedBox = result.allocations.find((allocation) => allocation.customer_count_in_box > 0);
    expect(populatedBox).toBeTruthy();
    expect(populatedBox.winner_branch_id).toBe('A');
    expect(populatedBox.raw_customer_count_for_winner).toBe(2);
    expect(populatedBox.score).toBeGreaterThan(0);
  });

  test('tie-breaking falls back to lexicographically smaller branch ID when scores and distance match', () => {
    const candidateA = {
      branchId: 'A',
      rawCustomerCount: 0,
      distanceKm: 1,
      score: 0.25
    };
    const candidateB = {
      branchId: 'B',
      rawCustomerCount: 0,
      distanceKm: 1,
      score: 0.25
    };

    expect(compareAllocationCandidates(candidateA, candidateB)).toBeGreaterThan(0);
  });

  test('zero-customer fallback uses pure proximity', () => {
    const result = allocateBranchCoverage({
      allBranches: [
        { id: 'A', lat: 20.0, lon: 77.0 },
        { id: 'B', lat: 22.0, lon: 79.0 }
      ],
      candidateBranches: [
        { id: 'A', lat: 20.0, lon: 77.0 },
        { id: 'B', lat: 22.0, lon: 79.0 }
      ],
      customers: [],
      gridSizeKm: 5,
      mergeAdjacent: false
    });

    expect(result.stats.boxes_fallback_proximity).toBe(result.stats.total_boxes);
    expect(Object.keys(result.stats.boxes_per_branch).sort()).toEqual(['A', 'B']);
  });

  test('a branch with zero customers globally still owns nearby boxes', () => {
    const result = allocateBranchCoverage({
      allBranches: [
        { id: 'A', lat: 20.0, lon: 77.0 },
        { id: 'B', lat: 20.1, lon: 77.1 },
        { id: 'C', lat: 20.2, lon: 77.2 }
      ],
      candidateBranches: [
        { id: 'A', lat: 20.0, lon: 77.0 },
        { id: 'B', lat: 20.1, lon: 77.1 },
        { id: 'C', lat: 20.2, lon: 77.2 }
      ],
      customers: [
        { id: 'C1', lat: 20.005, lon: 77.005, homeBranchId: 'A' },
        { id: 'C2', lat: 20.105, lon: 77.105, homeBranchId: 'B' }
      ],
      gridSizeKm: 5,
      mergeAdjacent: false
    });

    expect(result.stats.boxes_per_branch.C).toBeGreaterThan(0);
  });

  test('full-network and selected-only candidate sets can produce different winners for the same local area', () => {
    const branches = [
      { id: 'A', lat: 20.0, lon: 77.0 },
      { id: 'B', lat: 20.0, lon: 77.4 },
      { id: 'C', lat: 20.0, lon: 77.1 }
    ];
    const customers = [
      { id: 'C1', lat: 20.0, lon: 77.12, homeBranchId: null }
    ];

    const fullNetwork = allocateBranchCoverage({
      allBranches: branches,
      candidateBranches: branches,
      customers,
      gridSizeKm: 5,
      mergeAdjacent: false
    });
    const selectedOnly = allocateBranchCoverage({
      allBranches: branches,
      candidateBranches: branches.filter((branch) => ['A', 'B'].includes(branch.id)),
      customers,
      gridSizeKm: 5,
      mergeAdjacent: false
    });

    const fullWinner = fullNetwork.allocations.find((allocation) => allocation.customer_count_in_box > 0);
    const selectedWinner = selectedOnly.allocations.find((allocation) => allocation.customer_count_in_box > 0);
    expect(fullWinner).toBeTruthy();
    expect(selectedWinner).toBeTruthy();
    expect(fullWinner.winner_branch_id).toBe('C');
    expect(selectedWinner.winner_branch_id).toBe('A');
  });

  test('exclusive mapping assigns every box exactly once with no overlaps', () => {
    const result = allocateBranchCoverage({
      allBranches: [
        { id: 'A', lat: 20.0, lon: 77.0 },
        { id: 'B', lat: 20.3, lon: 77.3 }
      ],
      candidateBranches: [
        { id: 'A', lat: 20.0, lon: 77.0 },
        { id: 'B', lat: 20.3, lon: 77.3 }
      ],
      customers: [
        { id: 'C1', lat: 20.01, lon: 77.01, homeBranchId: 'A' },
        { id: 'C2', lat: 20.25, lon: 77.25, homeBranchId: 'B' }
      ],
      gridSizeKm: 5,
      mergeAdjacent: false
    });

    const uniqueBoxIds = new Set(result.allocations.map((allocation) => allocation.box_id));
    const allocatedBoxes = Object.values(result.stats.boxes_per_branch)
      .reduce((sum, count) => sum + Number(count || 0), 0);

    expect(uniqueBoxIds.size).toBe(result.stats.total_boxes);
    expect(allocatedBoxes).toBe(result.stats.total_boxes);
  });

  test('adjacent boxes dissolve into a merged polygon', () => {
    const grid = {
      minLat: 0,
      minLon: 0,
      latStep: 1,
      lonStep: 1,
      rows: 1,
      cols: 2
    };
    const merged = mergeBoxesIntoMultiPolygon([
      buildBoxGeometry(grid, 0, 0),
      buildBoxGeometry(grid, 0, 1)
    ]);

    expect(merged).toBeTruthy();
    expect(merged.type).toBe('Polygon');
    expect(merged.coordinates[0]).toContainEqual([0, 0]);
    expect(merged.coordinates[0]).toContainEqual([2, 1]);
  });

  test('selected-only city-scale allocations remain under the target performance budget', () => {
    const branches = Array.from({ length: 20 }, (_, index) => ({
      id: `B${String(index + 1).padStart(2, '0')}`,
      lat: 20 + ((index % 5) * 0.05),
      lon: 77 + (Math.floor(index / 5) * 0.05)
    }));
    const customers = Array.from({ length: 1500 }, (_, index) => ({
      id: `C${index + 1}`,
      lat: 20 + ((index % 40) * 0.004),
      lon: 77 + ((index % 35) * 0.004),
      homeBranchId: branches[index % branches.length].id
    }));

    const result = allocateBranchCoverage({
      allBranches: branches,
      candidateBranches: branches,
      customers,
      gridSizeKm: 5,
      mergeAdjacent: true
    });

    expect(result.stats.compute_time_ms).toBeLessThan(1000);
    expect(result.featureCollection.type).toBe('FeatureCollection');
  });
});
