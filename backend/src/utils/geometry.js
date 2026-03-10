/**
 * Geometry Calculation Module
 * Handles coordinate conversion, Pocket ID encoding/decoding
 */

const proj4 = require('proj4');

// Constants
const METERS_PER_DEGREE_LAT = 111000; // Fixed
const GRID_LEVELS = [500000, 100000, 20000, 5000, 1000]; // meters
const DEFAULT_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUV'; // 30 chars, excluding I and O

/**
 * Calculate meters per degree longitude at given latitude
 * @param {number} latitude - Latitude in degrees
 * @returns {number} Meters per degree longitude
 */
function metersPerDegreeLon(latitude) {
  const latRad = (latitude * Math.PI) / 180;
  return METERS_PER_DEGREE_LAT * Math.cos(latRad);
}

/**
 * Convert lat/lon to meters from origin
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {number} originLat - Origin latitude
 * @param {number} originLon - Origin longitude
 * @returns {Object} { x, y } in meters
 */
function latLonToMeters(lat, lon, originLat, originLon) {
  const deltaLat = lat - originLat;
  const deltaLon = lon - originLon;
  
  // Use dynamic meters per degree for longitude
  const metersPerDegLon = metersPerDegreeLon(lat);
  
  const y = deltaLat * METERS_PER_DEGREE_LAT;
  const x = deltaLon * metersPerDegLon;
  
  return { x, y };
}

/**
 * Convert meters to lat/lon from origin
 * @param {number} x - X offset in meters
 * @param {number} y - Y offset in meters
 * @param {number} originLat - Origin latitude
 * @param {number} originLon - Origin longitude
 * @returns {Object} { lat, lon }
 */
function metersToLatLon(x, y, originLat, originLon) {
  const lat = originLat + (y / METERS_PER_DEGREE_LAT);
  
  // Use dynamic meters per degree for longitude at calculated latitude
  const metersPerDegLon = metersPerDegreeLon(lat);
  const lon = originLon + (x / metersPerDegLon);
  
  return { lat, lon };
}

/**
 * Calculate row and column indices for all grid levels
 * @param {number} x - X offset in meters
 * @param {number} y - Y offset in meters
 * @param {Array} gridLevels - Array of grid sizes in meters
 * @returns {Array} Array of { row, col, level } objects
 */
function calculateIndices(x, y, gridLevels = GRID_LEVELS) {
  const indices = [];
  let cumulativeX = 0;
  let cumulativeY = 0;
  
  for (let i = 0; i < gridLevels.length; i++) {
    const levelSize = gridLevels[i];
    const col = Math.floor((x - cumulativeX) / levelSize);
    const row = Math.floor((y - cumulativeY) / levelSize);
    
    indices.push({
      level: i,
      levelSize,
      row,
      col,
    });
    
    cumulativeX += col * levelSize;
    cumulativeY += row * levelSize;
  }
  
  return indices;
}

/**
 * Encode indices to Pocket ID using alphabet
 * @param {Array} indices - Array of { row, col } objects
 * @param {string} alphabet - 30-character alphabet
 * @returns {string} Pocket ID (e.g., "7F-33-22-11-00-44")
 */
function encodeIndices(indices, alphabet = DEFAULT_ALPHABET) {
  if (alphabet.length !== 30) {
    throw new Error('Alphabet must contain exactly 30 characters');
  }

  const normalizeAlphabetIndex = (value) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      throw new Error(`Invalid grid index encountered while encoding Pocket ID: ${value}`);
    }

    const normalizedInteger = Math.trunc(numericValue);
    return ((normalizedInteger % 30) + 30) % 30;
  };
  
  const parts = indices.map(({ row, col }) => {
    // JavaScript modulo keeps negative sign; normalize to [0, 29] to avoid "undefined" tokens.
    const rowChar = alphabet[normalizeAlphabetIndex(row)];
    const colChar = alphabet[normalizeAlphabetIndex(col)];
    return `${rowChar}${colChar}`;
  });
  
  return parts.join('-');
}

/**
 * Decode Pocket ID to indices
 * @param {string} pocketId - Pocket ID (e.g., "7F-33-22-11-00-44")
 * @param {string} alphabet - 30-character alphabet
 * @returns {Array} Array of { row, col, level } objects
 */
function decodeIndices(pocketId, alphabet = DEFAULT_ALPHABET) {
  if (alphabet.length !== 30) {
    throw new Error('Alphabet must contain exactly 30 characters');
  }
  
  const parts = pocketId.split('-');
  
  // Allow truncated Pocket IDs (e.g., up to 5km level) as long as they map to leading grid levels.
  if (parts.length < 1 || parts.length > GRID_LEVELS.length) {
    throw new Error(`Invalid Pocket ID format: expected 1 to ${GRID_LEVELS.length} parts, got ${parts.length}`);
  }
  
  const indices = [];
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.length !== 2) {
      throw new Error(`Invalid Pocket ID format at level ${i}`);
    }
    
    const rowChar = part[0];
    const colChar = part[1];
    
    const row = alphabet.indexOf(rowChar);
    const col = alphabet.indexOf(colChar);
    
    if (row === -1 || col === -1) {
      throw new Error(`Invalid characters in Pocket ID at level ${i}`);
    }
    
    indices.push({
      level: i,
      levelSize: GRID_LEVELS[i],
      row,
      col,
    });
  }
  
  return indices;
}

/**
 * Calculate southwest corner coordinates from indices
 * @param {Array} indices - Array of { row, col, levelSize } objects
 * @returns {Object} { x, y } in meters from origin
 */
function indicesToMeters(indices) {
  let x = 0;
  let y = 0;
  
  for (const { row, col, levelSize } of indices) {
    x += col * levelSize;
    y += row * levelSize;
  }
  
  return { x, y };
}

/**
 * Encode lat/lon to Pocket ID
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {Object} config - Configuration object
 * @returns {Object} { pocketId, indices, meters }
 */
function encodePocketId(lat, lon, config) {
  const { originLat, originLon, alphabet } = config;
  
  // Convert to meters
  const meters = latLonToMeters(lat, lon, originLat, originLon);
  
  // Calculate indices
  const indices = calculateIndices(meters.x, meters.y);
  
  // Encode to Pocket ID
  const pocketId = encodeIndices(indices, alphabet);
  
  return {
    pocketId,
    indices,
    meters,
  };
}

/**
 * Decode Pocket ID to center coordinates
 * @param {string} pocketId - Pocket ID
 * @param {Object} config - Configuration object
 * @returns {Object} { centerLat, centerLon, corners, indices }
 */
function decodePocketId(pocketId, config) {
  const { originLat, originLon, alphabet } = config;
  
  // Decode to indices
  const indices = decodeIndices(pocketId, alphabet);
  
  // Calculate southwest corner in meters
  const swCorner = indicesToMeters(indices);
  
  // Get finest level size
  const finestLevel = indices[indices.length - 1].levelSize;
  
  // Calculate center by adding half the cell size
  const centerX = swCorner.x + finestLevel / 2;
  const centerY = swCorner.y + finestLevel / 2;
  
  // Convert to lat/lon
  const center = metersToLatLon(centerX, centerY, originLat, originLon);
  
  // Calculate corners
  const sw = metersToLatLon(swCorner.x, swCorner.y, originLat, originLon);
  const ne = metersToLatLon(
    swCorner.x + finestLevel,
    swCorner.y + finestLevel,
    originLat,
    originLon
  );
  const nw = metersToLatLon(swCorner.x, swCorner.y + finestLevel, originLat, originLon);
  const se = metersToLatLon(swCorner.x + finestLevel, swCorner.y, originLat, originLon);
  
  return {
    centerLat: center.lat,
    centerLon: center.lon,
    corners: {
      sw,
      ne,
      nw,
      se,
    },
    indices,
  };
}

/**
 * Calculate Haversine distance between two points
 * @param {number} lat1 - Latitude 1
 * @param {number} lon1 - Longitude 1
 * @param {number} lat2 - Latitude 2
 * @param {number} lon2 - Longitude 2
 * @returns {number} Distance in meters
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return R * c;
}

/**
 * Validate alphabet
 * @param {string} alphabet - Alphabet string
 * @returns {Object} { valid, error }
 */
function validateAlphabet(alphabet) {
  if (!alphabet || typeof alphabet !== 'string') {
    return { valid: false, error: 'Alphabet must be a string' };
  }
  
  if (alphabet.length !== 30) {
    return { valid: false, error: 'Alphabet must contain exactly 30 characters' };
  }
  
  // Check for duplicates
  const uniqueChars = new Set(alphabet);
  if (uniqueChars.size !== 30) {
    return { valid: false, error: 'Alphabet must contain 30 unique characters' };
  }
  
  // Check for hyphen (reserved as separator)
  if (alphabet.includes('-')) {
    return { valid: false, error: 'Alphabet cannot contain hyphen (-)' };
  }
  
  return { valid: true };
}

/**
 * Find nearest pocket to customer coordinates
 * Generates all possible pockets at finest level and finds the one with nearest center point
 * @param {number} customerLat - Customer latitude
 * @param {number} customerLon - Customer longitude
 * @param {Object} config - Configuration object
 * @param {Object} options - Options { searchRadius: meters to search }
 * @returns {Object} { pocketId, distance, centerLat, centerLon }
 */
function findNearestPocket(customerLat, customerLon, config, options = {}) {
  const { originLat, originLon, alphabet } = config;
  const pocketLevelMeters = Number.isFinite(Number(options.pocketLevelMeters))
    ? Number(options.pocketLevelMeters)
    : GRID_LEVELS[GRID_LEVELS.length - 1];
  const pocketLevelIndex = GRID_LEVELS.indexOf(pocketLevelMeters);
  if (pocketLevelIndex === -1) {
    throw new Error(`Unsupported pocket level: ${pocketLevelMeters}`);
  }

  // Convert customer location to meters, then place customer into the containing pocket cell.
  const customerMeters = latLonToMeters(customerLat, customerLon, originLat, originLon);
  const fullIndices = calculateIndices(customerMeters.x, customerMeters.y);
  const pocketIndices = fullIndices.slice(0, pocketLevelIndex + 1);
  const pocketId = encodeIndices(pocketIndices, alphabet);
  const pocket = decodePocketId(pocketId, config);
  const distance = haversineDistance(
    customerLat,
    customerLon,
    pocket.centerLat,
    pocket.centerLon
  );

  return {
    pocketId,
    distance,
    centerLat: pocket.centerLat,
    centerLon: pocket.centerLon,
  };
}

module.exports = {
  METERS_PER_DEGREE_LAT,
  GRID_LEVELS,
  DEFAULT_ALPHABET,
  metersPerDegreeLon,
  latLonToMeters,
  metersToLatLon,
  calculateIndices,
  encodeIndices,
  decodeIndices,
  indicesToMeters,
  encodePocketId,
  decodePocketId,
  haversineDistance,
  validateAlphabet,
  findNearestPocket,
};
