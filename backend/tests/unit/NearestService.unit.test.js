const nearestService = require('../../src/services/NearestService');

jest.mock('../../src/config/database', () => ({
  query: jest.fn(),
}));

const { query } = require('../../src/config/database');

describe('NearestService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('findNearestBranches uses indexed PostGIS ordering with optional distance filters', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 'BR001',
          city: 'Mumbai',
          lat: 19.076,
          lon: 72.8777,
          pocket_id: 'PKT001',
          distance: 1250.4,
        },
      ],
    });

    const result = await nearestService.findNearestBranches({
      lat: 19.08,
      lon: 72.88,
      limit: 3,
      maxDistance: 5000,
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY b.geom <-> target.geom, b.id ASC'),
      [72.88, 19.08, 5000, 3]
    );
    expect(query.mock.calls[0][0]).toContain('ST_DWithin');
    expect(result).toEqual([
      {
        id: 'BR001',
        city: 'Mumbai',
        lat: 19.076,
        lon: 72.8777,
        pocketId: 'PKT001',
        distance: 1250.4,
      },
    ]);
  });

  test('findNearestBranchesForPockets resolves multiple pockets with a single lateral KNN query', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          pocket_id: 'P1',
          branch_id: 'BR001',
          branch_name: 'Mumbai',
          branch_lat: 19.076,
          branch_lon: 72.8777,
          distance: 1000.2,
        },
        {
          pocket_id: 'P2',
          branch_id: 'BR002',
          branch_name: 'Delhi',
          branch_lat: 28.7041,
          branch_lon: 77.1025,
          distance: 850.1,
        },
      ],
    });

    const result = await nearestService.findNearestBranchesForPockets([
      { pocketId: 'P1', lat: 19.08, lon: 72.88 },
      { pocketId: 'P2', lat: 28.71, lon: 77.1 },
    ]);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('JOIN LATERAL');
    expect(query.mock.calls[0][0]).toContain('ORDER BY b.geom <->');
    expect(query.mock.calls[0][1]).toEqual([
      'P1',
      19.08,
      72.88,
      'P2',
      28.71,
      77.1,
    ]);
    expect(result).toBeInstanceOf(Map);
    expect(result.get('P1')).toEqual({
      branchId: 'BR001',
      branchName: 'Mumbai',
      branchLat: 19.076,
      branchLon: 72.8777,
      distance: 1000.2,
    });
    expect(result.get('P2')).toEqual({
      branchId: 'BR002',
      branchName: 'Delhi',
      branchLat: 28.7041,
      branchLon: 77.1025,
      distance: 850.1,
    });
  });
});
