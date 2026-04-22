/**
 * Unit Tests for BranchFinderService
 * Feature: customer-pocket-mapping-view
 * 
 * Tests specific examples and edge cases for branch finding functionality.
 * 
 * **Validates: Requirements 1.4, 5.1, 5.5**
 */

const BranchFinderService = require('../../src/services/BranchFinderService');
const { haversineDistance } = require('../../src/utils/geometry');

// Mock the database query function
jest.mock('../../src/config/database', () => ({
  query: jest.fn(),
}));

const { query } = require('../../src/config/database');

describe('BranchFinderService - Unit Tests', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('findNearestBranch with known branch locations', () => {
    /**
     * Test with known branch locations to verify correct nearest branch selection
     * **Validates: Requirements 1.4, 5.1**
     */
    test('should find nearest branch from multiple known locations', async () => {
      // Known locations: NYC, LA, Chicago
      const branches = [
        { id: 'NYC', city: 'New York', lat: 40.7128, lon: -74.0060 },
        { id: 'LA', city: 'Los Angeles', lat: 34.0522, lon: -118.2437 },
        { id: 'CHI', city: 'Chicago', lat: 41.8781, lon: -87.6298 },
      ];

      query.mockResolvedValueOnce({ rows: branches });

      // Pocket location near Chicago (41.9, -87.7)
      const result = await BranchFinderService.findNearestBranch(41.9, -87.7);

      expect(result).toBeDefined();
      expect(result.branchId).toBe('CHI');
      expect(result.branchName).toBe('Chicago');
      expect(result.distance).toBeLessThan(20000); // Should be less than 20km
    });

    test('should find nearest branch when pocket is very close to one branch', async () => {
      const branches = [
        { id: 'B1', city: 'Branch 1', lat: 40.0, lon: -75.0 },
        { id: 'B2', city: 'Branch 2', lat: 50.0, lon: -85.0 },
      ];

      query.mockResolvedValueOnce({ rows: branches });

      // Pocket very close to B1 (within 1km)
      const result = await BranchFinderService.findNearestBranch(40.005, -75.005);

      expect(result.branchId).toBe('B1');
      expect(result.distance).toBeLessThan(1000); // Less than 1km
    });
  });

  describe('findNearestBranch with no branches (error case)', () => {
    /**
     * Test error handling when no branches exist in database
     * **Validates: Requirements 5.1**
     */
    test('should throw error when no branches exist', async () => {
      query.mockResolvedValueOnce({ rows: [] });

      await expect(
        BranchFinderService.findNearestBranch(40.0, -75.0)
      ).rejects.toThrow('No branches found in database');
    });

    test('should throw error with descriptive message when database returns empty', async () => {
      query.mockResolvedValueOnce({ rows: [] });

      try {
        await BranchFinderService.findNearestBranch(35.0, -80.0);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).toBe('No branches found in database');
      }
    });
  });

  describe('findNearestBranch with equidistant branches (deterministic selection)', () => {
    /**
     * Test deterministic selection when multiple branches are equidistant
     * Should select branch with first ID alphabetically
     * **Validates: Requirements 5.5**
     */
    test('should select first branch alphabetically when branches are equidistant', async () => {
      // All branches at the same location (equidistant from any pocket)
      const branches = [
        { id: 'ZEBRA', city: 'Zebra City', lat: 40.0, lon: -75.0 },
        { id: 'ALPHA', city: 'Alpha City', lat: 40.0, lon: -75.0 },
        { id: 'BETA', city: 'Beta City', lat: 40.0, lon: -75.0 },
      ];

      query.mockResolvedValueOnce({ rows: branches });

      const result = await BranchFinderService.findNearestBranch(41.0, -76.0);

      // Should select ALPHA (first alphabetically)
      expect(result.branchId).toBe('ALPHA');
      expect(result.branchName).toBe('Alpha City');
    });

    test('should consistently select same branch for equidistant branches', async () => {
      const branches = [
        { id: 'C', city: 'City C', lat: 40.0, lon: -75.0 },
        { id: 'A', city: 'City A', lat: 40.0, lon: -75.0 },
        { id: 'B', city: 'City B', lat: 40.0, lon: -75.0 },
      ];

      query.mockResolvedValueOnce({ rows: branches });
      const result1 = await BranchFinderService.findNearestBranch(41.0, -76.0);

      query.mockResolvedValueOnce({ rows: branches });
      const result2 = await BranchFinderService.findNearestBranch(41.0, -76.0);

      // Both calls should return the same branch
      expect(result1.branchId).toBe('A');
      expect(result2.branchId).toBe('A');
    });

    test('should handle numeric string IDs in alphabetical order', async () => {
      const branches = [
        { id: '10', city: 'Branch 10', lat: 40.0, lon: -75.0 },
        { id: '2', city: 'Branch 2', lat: 40.0, lon: -75.0 },
        { id: '1', city: 'Branch 1', lat: 40.0, lon: -75.0 },
      ];

      query.mockResolvedValueOnce({ rows: branches });

      const result = await BranchFinderService.findNearestBranch(41.0, -76.0);

      // Alphabetically: '1' < '10' < '2'
      expect(result.branchId).toBe('1');
    });

    test('should handle nearly equidistant branches within tolerance', async () => {
      // Branches very close together (within 1cm tolerance)
      const branches = [
        { id: 'Z-BRANCH', city: 'Z Branch', lat: 40.0000, lon: -75.0000 },
        { id: 'A-BRANCH', city: 'A Branch', lat: 40.0000, lon: -75.0001 }, // ~11m away
      ];

      query.mockResolvedValueOnce({ rows: branches });

      // Pocket equidistant from both (within tolerance)
      const result = await BranchFinderService.findNearestBranch(40.0000, -75.00005);

      // Should select A-BRANCH (first alphabetically)
      expect(result.branchId).toBe('A-BRANCH');
    });
  });

  describe('findNearestBranch edge cases', () => {
    test('should handle single branch', async () => {
      const branches = [
        { id: 'ONLY', city: 'Only Branch', lat: 40.0, lon: -75.0 },
      ];

      query.mockResolvedValueOnce({ rows: branches });

      const result = await BranchFinderService.findNearestBranch(41.0, -76.0);

      expect(result.branchId).toBe('ONLY');
      expect(result.branchName).toBe('Only Branch');
      expect(result.distance).toBeGreaterThan(0);
    });

    test('should handle pocket at exact branch location', async () => {
      const branches = [
        { id: 'EXACT', city: 'Exact Branch', lat: 40.0, lon: -75.0 },
      ];

      query.mockResolvedValueOnce({ rows: branches });

      // Pocket at exact same coordinates
      const result = await BranchFinderService.findNearestBranch(40.0, -75.0);

      expect(result.branchId).toBe('EXACT');
      expect(result.distance).toBe(0);
    });

    test('should return all required fields in result', async () => {
      const branches = [
        { id: 'TEST', city: 'Test City', lat: 40.0, lon: -75.0 },
      ];

      query.mockResolvedValueOnce({ rows: branches });

      const result = await BranchFinderService.findNearestBranch(41.0, -76.0);

      expect(result).toHaveProperty('branchId');
      expect(result).toHaveProperty('branchName');
      expect(result).toHaveProperty('branchLat');
      expect(result).toHaveProperty('branchLon');
      expect(result).toHaveProperty('distance');
      expect(typeof result.distance).toBe('number');
    });
  });

  describe('findNearestBranchesForPockets batch operation', () => {
    test('should find nearest branches for multiple pockets', async () => {
      const branches = [
        { id: 'B1', city: 'Branch 1', lat: 40.0, lon: -75.0 },
        { id: 'B2', city: 'Branch 2', lat: 45.0, lon: -80.0 },
      ];

      query.mockResolvedValueOnce({ rows: branches });

      const pockets = [
        { pocketId: 'P1', lat: 40.1, lon: -75.1 },
        { pocketId: 'P2', lat: 45.1, lon: -80.1 },
      ];

      const result = await BranchFinderService.findNearestBranchesForPockets(pockets);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(2);
      expect(result.get('P1').branchId).toBe('B1');
      expect(result.get('P2').branchId).toBe('B2');
    });

    test('should throw error when no branches exist for batch operation', async () => {
      query.mockResolvedValueOnce({ rows: [] });

      const pockets = [
        { pocketId: 'P1', lat: 40.0, lon: -75.0 },
      ];

      await expect(
        BranchFinderService.findNearestBranchesForPockets(pockets)
      ).rejects.toThrow('No branches found in database');
    });

    test('should handle empty pockets array', async () => {
      const branches = [
        { id: 'B1', city: 'Branch 1', lat: 40.0, lon: -75.0 },
      ];

      query.mockResolvedValueOnce({ rows: branches });

      const result = await BranchFinderService.findNearestBranchesForPockets([]);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });
  });

  describe('distance calculation accuracy', () => {
    test('should calculate correct distance using Haversine formula', async () => {
      const branches = [
        { id: 'NYC', city: 'New York', lat: 40.7128, lon: -74.0060 },
      ];

      query.mockResolvedValueOnce({ rows: branches });

      // LA coordinates
      const result = await BranchFinderService.findNearestBranch(34.0522, -118.2437);

      // Distance NYC to LA is approximately 3,944 km
      const expectedDistance = haversineDistance(34.0522, -118.2437, 40.7128, -74.0060);
      
      expect(result.distance).toBeCloseTo(expectedDistance, 2);
      expect(result.distance).toBeGreaterThan(3900000); // > 3,900 km
      expect(result.distance).toBeLessThan(4000000); // < 4,000 km
    });
  });
});
