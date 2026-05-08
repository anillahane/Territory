const { haversineDistance } = require('../../src/utils/geometry');
const batchRoutes = require('../../src/routes/batch');

const {
  buildCustomerPocketMappingRecord,
  persistBranchEmployeeTerritories,
} = batchRoutes.allocationInternals;

describe('batch allocation internals', () => {
  test('buildCustomerPocketMappingRecord stores true customer-to-branch distance separately from pocket-center distance', () => {
    const mapping = buildCustomerPocketMappingRecord({
      customerId: 'CUST001',
      customerLat: 19.1000,
      customerLon: 72.8000,
      uploadedBranchCode: 'BR001',
      existingBranchId: 'BR001',
      distanceCustomerToExistingBranch: 1200,
      nearestPocket: {
        pocketId: '00-00-00-00-00',
        distance: 87,
        centerLat: 19.1200,
        centerLon: 72.8200,
      },
      selectedBranch: {
        id: 'BR009',
        lat: 19.1500,
        lon: 72.8600,
      },
      customerBucket: 'PREMIUM',
    });

    expect(mapping.distanceCustomerToBranch).toBeCloseTo(
      haversineDistance(19.1000, 72.8000, 19.1500, 72.8600),
      6
    );
    expect(mapping.distancePocketToBranch).toBeCloseTo(
      haversineDistance(19.1200, 72.8200, 19.1500, 72.8600),
      6
    );
    expect(mapping.distanceCustomerToBranch).not.toBeCloseTo(mapping.distancePocketToBranch, 3);
  });

  test('persistBranchEmployeeTerritories scopes 5km and 1km persistence independently', async () => {
    const client = {
      query: jest.fn().mockResolvedValue({ rowCount: 1, rows: [] }),
    };

    await persistBranchEmployeeTerritories(client, 'BR001', 5000);
    await persistBranchEmployeeTerritories(client, 'BR001', 1000);

    const branchTerritoryInserts = client.query.mock.calls.filter(([queryText]) =>
      String(queryText).includes('INSERT INTO branch_territories')
    );
    const employeeTerritoryInserts = client.query.mock.calls.filter(([queryText]) =>
      String(queryText).includes('INSERT INTO employee_territories')
    );

    expect(branchTerritoryInserts).toHaveLength(2);
    expect(employeeTerritoryInserts).toHaveLength(2);
    expect(branchTerritoryInserts[0][1]).toEqual(['BR001', 5000, expect.any(String), 5]);
    expect(branchTerritoryInserts[1][1]).toEqual(['BR001', 1000, expect.any(String), 1]);
    expect(employeeTerritoryInserts[0][1]).toEqual(['BR001', 5]);
    expect(employeeTerritoryInserts[1][1]).toEqual(['BR001', 1]);
  });
});
