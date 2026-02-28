/**
 * Property-Based Tests for BranchFinderService
 * Feature: customer-pocket-mapping-view
 * Property 3: Nearest Branch Correctness
 * 
 * Tests that findNearestBranch always returns the branch with minimum distance
 * to the pocket center, calculated using the Haversine formula.
 * 
 * **Validates: Requirements 1.4, 5.1**
 */

const fc = require('fast-check');
const { haversineDistance } = require('../../src/utils/geometry');
const BranchFinderService = require('../../src/services/BranchFinderService');

// Mock the database query function
jest.mock('../../src/config/database', () => ({
  query: jest.fn(),
}));

const { query } = require('../../src/config/database');

describe('BranchFinderService - Property-Based Tests', () => {
  describe('Property 3: Nearest Branch Correctness', () => {
    /**
     * Property: For any pocket location and set of branches, the assigned nearest branch
     * should be the branch with the minimum distance to the pocket center.
     * 
     * **Validates: Requirements 1.4, 5.1**
     */
    test('findNearestBranch returns the branch with minimum distance', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate random pocket coordinates (valid lat/lon ranges, excluding NaN/Infinity)
          fc.double({ min: -90, max: 90, noNaN: true }),  // pocketLat
          fc.double({ min: -180, max: 180, noNaN: true }), // pocketLon
          // Generate a random set of branches (1-10 branches)
          fc.array(
            fc.record({
              id: fc.string({ minLength: 1, maxLength: 10 }).filter(s => s.trim().length > 0),
              city: fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
              lat: fc.double({ min: -90, max: 90, noNaN: true }),
              lon: fc.double({ min: -180, max: 180, noNaN: true }),
            }),
            { minLength: 1, maxLength: 10 }
          ),
          async (pocketLat, pocketLon, branches) => {
            // Mock the database to return our generated branches
            query.mockResolvedValueOnce({ rows: branches });

            // Call the service
            const result = await BranchFinderService.findNearestBranch(pocketLat, pocketLon);

            // Verify result exists
            expect(result).toBeDefined();
            expect(result.branchId).toBeDefined();
            expect(result.distance).toBeDefined();

            // Calculate distances to all branches manually
            const distances = branches.map(branch => ({
              branchId: branch.id,
              distance: haversineDistance(pocketLat, pocketLon, branch.lat, branch.lon),
            }));

            // Find the minimum distance
            const minDistance = Math.min(...distances.map(d => d.distance));

            // The returned branch should have the minimum distance (within floating point tolerance)
            expect(result.distance).toBeCloseTo(minDistance, 2);

            // Verify the returned branch is one of the branches with minimum distance
            const branchesWithMinDistance = distances.filter(
              d => Math.abs(d.distance - minDistance) < 0.01 // Within 1cm tolerance
            );
            const returnedBranchIds = branchesWithMinDistance.map(b => b.branchId);
            expect(returnedBranchIds).toContain(result.branchId);
          }
        ),
        { numRuns: 100 } // Minimum 100 iterations as specified
      );
    });

    /**
     * Property: For equidistant branches, the service should select deterministically
     * (by ID in alphabetical order).
     * 
     * **Validates: Requirements 5.5**
     */
    test('findNearestBranch selects deterministically for equidistant branches', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.double({ min: -90, max: 90, noNaN: true }),  // pocketLat
          fc.double({ min: -180, max: 180, noNaN: true }), // pocketLon
          fc.double({ min: -90, max: 90, noNaN: true }),  // branchLat (same for all)
          fc.double({ min: -180, max: 180, noNaN: true }), // branchLon (same for all)
          fc.array(fc.string({ minLength: 1, maxLength: 10 }).filter(s => s.trim().length > 0), { minLength: 2, maxLength: 5 }),
          async (pocketLat, pocketLon, branchLat, branchLon, branchIds) => {
            // Create branches at the same location (equidistant)
            const uniqueIds = [...new Set(branchIds)]; // Ensure unique IDs
            if (uniqueIds.length < 2) return; // Skip if not enough unique IDs

            const branches = uniqueIds.map(id => ({
              id,
              city: `City-${id}`,
              lat: branchLat,
              lon: branchLon,
            }));

            // Mock the database
            query.mockResolvedValueOnce({ rows: branches });

            // Call the service
            const result = await BranchFinderService.findNearestBranch(pocketLat, pocketLon);

            // The selected branch should be the first one alphabetically by ID
            const sortedIds = uniqueIds.sort((a, b) => a.localeCompare(b));
            expect(result.branchId).toBe(sortedIds[0]);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: The distance returned should match the Haversine formula calculation.
     * 
     * **Validates: Requirements 5.2, 5.3, 5.4**
     */
    test('findNearestBranch returns correct Haversine distance', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.double({ min: -90, max: 90, noNaN: true }),
          fc.double({ min: -180, max: 180, noNaN: true }),
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 10 }).filter(s => s.trim().length > 0),
            city: fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
            lat: fc.double({ min: -90, max: 90, noNaN: true }),
            lon: fc.double({ min: -180, max: 180, noNaN: true }),
          }),
          async (pocketLat, pocketLon, branch) => {
            // Mock database with single branch
            query.mockResolvedValueOnce({ rows: [branch] });

            // Call the service
            const result = await BranchFinderService.findNearestBranch(pocketLat, pocketLon);

            // Calculate expected distance using Haversine formula
            const expectedDistance = haversineDistance(
              pocketLat,
              pocketLon,
              branch.lat,
              branch.lon
            );

            // The returned distance should match the Haversine calculation
            expect(result.distance).toBeCloseTo(expectedDistance, 2);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
