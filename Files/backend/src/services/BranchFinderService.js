/**
 * Branch Finder Service
 * Finds the nearest branch to a given pocket location
 */

const { query } = require('../config/database');
const { haversineDistance } = require('../utils/geometry');
const logger = require('../config/logger');

class BranchFinderService {
  /**
   * Find the nearest branch to a pocket center point
   * @param {number} pocketLat - Pocket center latitude
   * @param {number} pocketLon - Pocket center longitude
   * @returns {Promise<Object>} { branchId, branchName, distance }
   * @throws {Error} If no branches exist in database
   */
  async findNearestBranch(pocketLat, pocketLon) {
    try {
      // Get all branches from database
      const result = await query('SELECT id, city, lat, lon FROM branches');
      
      if (result.rows.length === 0) {
        throw new Error('No branches found in database');
      }

      let nearestBranch = null;
      let minDistance = Infinity;

      // Calculate distance to each branch
      for (const branch of result.rows) {
        const distance = haversineDistance(
          pocketLat,
          pocketLon,
          branch.lat,
          branch.lon
        );

        if (distance < minDistance) {
          minDistance = distance;
          nearestBranch = {
            branchId: branch.id,
            branchName: branch.city,
            branchLat: branch.lat,
            branchLon: branch.lon,
            distance,
          };
        }
      }

      // Handle equidistant branches - deterministic selection (first by ID)
      if (nearestBranch) {
        // Check if there are other branches at the same distance
        const equidistantBranches = result.rows.filter(branch => {
          const distance = haversineDistance(
            pocketLat,
            pocketLon,
            branch.lat,
            branch.lon
          );
          return Math.abs(distance - minDistance) < 0.01; // Within 1cm
        });

        if (equidistantBranches.length > 1) {
          // Sort by ID for deterministic selection
          equidistantBranches.sort((a, b) => a.id.localeCompare(b.id));
          const selectedBranch = equidistantBranches[0];
          
          nearestBranch = {
            branchId: selectedBranch.id,
            branchName: selectedBranch.city,
            branchLat: selectedBranch.lat,
            branchLon: selectedBranch.lon,
            distance: minDistance,
          };

          logger.debug('Multiple equidistant branches found, selected by ID', {
            pocketLat,
            pocketLon,
            selectedBranchId: selectedBranch.id,
            equidistantCount: equidistantBranches.length,
          });
        }
      }

      return nearestBranch;
    } catch (error) {
      logger.error('Error finding nearest branch', {
        pocketLat,
        pocketLon,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Find nearest branches for multiple pocket locations (batch operation)
   * @param {Array<{pocketId: string, lat: number, lon: number}>} pockets - Array of pocket locations
   * @returns {Promise<Map<string, Object>>} Map of pocketId to nearest branch info
   */
  async findNearestBranchesForPockets(pockets) {
    try {
      // Get all branches once
      const result = await query('SELECT id, city, lat, lon FROM branches');
      
      if (result.rows.length === 0) {
        throw new Error('No branches found in database');
      }

      const branches = result.rows;
      const pocketBranchMap = new Map();

      // For each pocket, find nearest branch
      for (const pocket of pockets) {
        let nearestBranch = null;
        let minDistance = Infinity;

        for (const branch of branches) {
          const distance = haversineDistance(
            pocket.lat,
            pocket.lon,
            branch.lat,
            branch.lon
          );

          if (distance < minDistance) {
            minDistance = distance;
            nearestBranch = {
              branchId: branch.id,
              branchName: branch.city,
              branchLat: branch.lat,
              branchLon: branch.lon,
              distance,
            };
          }
        }

        if (nearestBranch) {
          pocketBranchMap.set(pocket.pocketId, nearestBranch);
        }
      }

      return pocketBranchMap;
    } catch (error) {
      logger.error('Error finding nearest branches for pockets', {
        pocketCount: pockets.length,
        error: error.message,
      });
      throw error;
    }
  }
}

module.exports = new BranchFinderService();

