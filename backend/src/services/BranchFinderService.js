/**
 * Branch Finder Service
 * Finds the nearest branch to a given pocket location
 */

const logger = require('../config/logger');
const nearestService = require('./NearestService');

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
      return await nearestService.findNearestBranch({
        lat: pocketLat,
        lon: pocketLon,
      });
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
      return await nearestService.findNearestBranchesForPockets(pockets);
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

