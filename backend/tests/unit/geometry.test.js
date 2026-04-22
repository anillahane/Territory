const {
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
} = require('../../src/utils/geometry');

describe('Geometry Module', () => {
  const config = {
    originLat: 8.0,
    originLon: 68.0,
    alphabet: DEFAULT_ALPHABET,
  };

  describe('metersPerDegreeLon', () => {
    test('should calculate meters per degree longitude at equator', () => {
      const result = metersPerDegreeLon(0);
      expect(result).toBeCloseTo(111000, 0);
    });

    test('should calculate meters per degree longitude at 45 degrees', () => {
      const result = metersPerDegreeLon(45);
      expect(result).toBeCloseTo(78489, 0);
    });

    test('should calculate meters per degree longitude at origin (8°N)', () => {
      const result = metersPerDegreeLon(8);
      expect(result).toBeCloseTo(109920, 0);
    });

    test('should return smaller value at higher latitudes', () => {
      const at30 = metersPerDegreeLon(30);
      const at60 = metersPerDegreeLon(60);
      expect(at30).toBeGreaterThan(at60);
    });
  });

  describe('latLonToMeters', () => {
    test('should convert origin to (0, 0)', () => {
      const result = latLonToMeters(8.0, 68.0, 8.0, 68.0);
      expect(result.x).toBeCloseTo(0, 1);
      expect(result.y).toBeCloseTo(0, 1);
    });

    test('should convert coordinates north of origin', () => {
      const result = latLonToMeters(9.0, 68.0, 8.0, 68.0);
      expect(result.x).toBeCloseTo(0, 1);
      expect(result.y).toBeCloseTo(111000, 0);
    });

    test('should convert coordinates east of origin', () => {
      const result = latLonToMeters(8.0, 69.0, 8.0, 68.0);
      expect(result.x).toBeGreaterThan(0);
      expect(result.y).toBeCloseTo(0, 1);
    });

    test('should handle negative offsets (south and west)', () => {
      const result = latLonToMeters(7.0, 67.0, 8.0, 68.0);
      expect(result.x).toBeLessThan(0);
      expect(result.y).toBeLessThan(0);
    });
  });

  describe('metersToLatLon', () => {
    test('should convert (0, 0) to origin', () => {
      const result = metersToLatLon(0, 0, 8.0, 68.0);
      expect(result.lat).toBeCloseTo(8.0, 5);
      expect(result.lon).toBeCloseTo(68.0, 5);
    });

    test('should be inverse of latLonToMeters', () => {
      const lat = 12.5;
      const lon = 75.3;
      const meters = latLonToMeters(lat, lon, 8.0, 68.0);
      const result = metersToLatLon(meters.x, meters.y, 8.0, 68.0);
      expect(result.lat).toBeCloseTo(lat, 4);
      expect(result.lon).toBeCloseTo(lon, 4);
    });
  });

  describe('calculateIndices', () => {
    test('should calculate indices for origin', () => {
      const indices = calculateIndices(0, 0);
      expect(indices).toHaveLength(5);
      indices.forEach((idx) => {
        expect(idx.row).toBe(0);
        expect(idx.col).toBe(0);
      });
    });

    test('should calculate indices for positive offsets', () => {
      const indices = calculateIndices(550000, 250000);
      expect(indices[0].col).toBe(1); // 500km level
      expect(indices[0].row).toBe(0);
      expect(indices[1].col).toBe(0); // 100km level (50km remaining)
      expect(indices[1].row).toBe(2); // 250km / 100km = 2
    });

    test('should use correct grid levels', () => {
      const indices = calculateIndices(100, 100);
      expect(indices[0].levelSize).toBe(500000);
      expect(indices[1].levelSize).toBe(100000);
      expect(indices[2].levelSize).toBe(20000);
      expect(indices[3].levelSize).toBe(5000);
      expect(indices[4].levelSize).toBe(1000);
    });
  });

  describe('encodeIndices', () => {
    test('should encode all zeros', () => {
      const indices = [
        { row: 0, col: 0 },
        { row: 0, col: 0 },
        { row: 0, col: 0 },
        { row: 0, col: 0 },
        { row: 0, col: 0 },
      ];
      const result = encodeIndices(indices);
      expect(result).toBe('00-00-00-00-00');
    });

    test('should encode using alphabet', () => {
      const indices = [
        { row: 7, col: 15 },
        { row: 3, col: 3 },
        { row: 2, col: 2 },
        { row: 1, col: 1 },
        { row: 0, col: 0 },
      ];
      const result = encodeIndices(indices);
      expect(result).toBe('7F-33-22-11-00');
    });

    test('should throw error for invalid alphabet length', () => {
      const indices = [{ row: 0, col: 0 }];
      expect(() => encodeIndices(indices, 'ABC')).toThrow();
    });
  });

  describe('decodeIndices', () => {
    test('should decode all zeros', () => {
      const result = decodeIndices('00-00-00-00-00');
      expect(result).toHaveLength(5);
      result.forEach((idx) => {
        expect(idx.row).toBe(0);
        expect(idx.col).toBe(0);
      });
    });

    test('should decode Pocket ID', () => {
      const result = decodeIndices('7F-33-22-11-00');
      expect(result[0].row).toBe(7);
      expect(result[0].col).toBe(15);
      expect(result[1].row).toBe(3);
      expect(result[1].col).toBe(3);
    });

    test('should throw error for invalid format', () => {
      expect(() => decodeIndices('7F-33-22')).not.toThrow();
      expect(() => decodeIndices('7F-3-22-11-00')).toThrow(); // Part '7F-3' has wrong length
      expect(() => decodeIndices('7F-33-22-11-00')).not.toThrow(); // Valid format (5 parts)
    });

    test('should throw error for invalid characters', () => {
      expect(() => decodeIndices('ZZ-33-22-11-00')).toThrow();
    });

    test('should be inverse of encodeIndices', () => {
      const original = [
        { row: 5, col: 10 },
        { row: 2, col: 8 },
        { row: 1, col: 3 },
        { row: 0, col: 1 },
        { row: 4, col: 4 },
      ];
      const encoded = encodeIndices(original);
      const decoded = decodeIndices(encoded);
      decoded.forEach((idx, i) => {
        expect(idx.row).toBe(original[i].row);
        expect(idx.col).toBe(original[i].col);
      });
    });
  });

  describe('indicesToMeters', () => {
    test('should return (0, 0) for all zeros', () => {
      const indices = [
        { row: 0, col: 0, levelSize: 500000 },
        { row: 0, col: 0, levelSize: 100000 },
        { row: 0, col: 0, levelSize: 20000 },
        { row: 0, col: 0, levelSize: 5000 },
        { row: 0, col: 0, levelSize: 1000 },
      ];
      const result = indicesToMeters(indices);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });

    test('should calculate correct offsets', () => {
      const indices = [
        { row: 1, col: 1, levelSize: 500000 },
        { row: 0, col: 0, levelSize: 100000 },
        { row: 0, col: 0, levelSize: 20000 },
        { row: 0, col: 0, levelSize: 5000 },
        { row: 0, col: 0, levelSize: 1000 },
      ];
      const result = indicesToMeters(indices);
      expect(result.x).toBe(500000);
      expect(result.y).toBe(500000);
    });
  });

  describe('encodePocketId', () => {
    test('should encode origin coordinates', () => {
      const result = encodePocketId(8.0, 68.0, config);
      expect(result.pocketId).toBe('00-00-00-00-00');
      expect(result.meters.x).toBeCloseTo(0, 1);
      expect(result.meters.y).toBeCloseTo(0, 1);
    });

    test('should encode coordinates and return all data', () => {
      const result = encodePocketId(12.5, 75.3, config);
      expect(result.pocketId).toBeDefined();
      expect(result.indices).toHaveLength(5);
      expect(result.meters).toHaveProperty('x');
      expect(result.meters).toHaveProperty('y');
    });

    test('should produce consistent results', () => {
      const result1 = encodePocketId(12.5, 75.3, config);
      const result2 = encodePocketId(12.5, 75.3, config);
      expect(result1.pocketId).toBe(result2.pocketId);
    });
  });

  describe('decodePocketId', () => {
    test('should decode origin Pocket ID', () => {
      const result = decodePocketId('00-00-00-00-00', config);
      expect(result.centerLat).toBeCloseTo(8.0, 2);
      expect(result.centerLon).toBeCloseTo(68.0, 2);
    });

    test('should return center and corners', () => {
      const result = decodePocketId('00-00-00-00-00', config);
      expect(result).toHaveProperty('centerLat');
      expect(result).toHaveProperty('centerLon');
      expect(result).toHaveProperty('corners');
      expect(result.corners).toHaveProperty('sw');
      expect(result.corners).toHaveProperty('ne');
      expect(result.corners).toHaveProperty('nw');
      expect(result.corners).toHaveProperty('se');
    });

    test('should be approximately inverse of encodePocketId', () => {
      const lat = 12.5;
      const lon = 75.3;
      const encoded = encodePocketId(lat, lon, config);
      const decoded = decodePocketId(encoded.pocketId, config);
      
      // Center should be close to original (within cell size)
      expect(Math.abs(decoded.centerLat - lat)).toBeLessThan(0.01);
      expect(Math.abs(decoded.centerLon - lon)).toBeLessThan(0.01);
    });
  });

  describe('haversineDistance', () => {
    test('should return 0 for same coordinates', () => {
      const result = haversineDistance(8.0, 68.0, 8.0, 68.0);
      expect(result).toBeCloseTo(0, 1);
    });

    test('should calculate distance between two points', () => {
      // Mumbai to Delhi (approx 1150 km)
      const result = haversineDistance(19.0760, 72.8777, 28.7041, 77.1025);
      expect(result).toBeGreaterThan(1100000);
      expect(result).toBeLessThan(1200000);
    });

    test('should be symmetric', () => {
      const d1 = haversineDistance(19.0760, 72.8777, 28.7041, 77.1025);
      const d2 = haversineDistance(28.7041, 77.1025, 19.0760, 72.8777);
      expect(d1).toBeCloseTo(d2, 0);
    });

    test('should handle coordinates across hemispheres', () => {
      const result = haversineDistance(0, 0, 0, 180);
      expect(result).toBeGreaterThan(0);
    });
  });

  describe('validateAlphabet', () => {
    test('should validate correct alphabet', () => {
      const result = validateAlphabet(DEFAULT_ALPHABET);
      expect(result.valid).toBe(true);
    });

    test('should reject alphabet with wrong length', () => {
      const result = validateAlphabet('ABC');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('30 characters');
    });

    test('should reject alphabet with duplicates', () => {
      const result = validateAlphabet('0123456789ABCDEFGHJKLMNPQRSTU0');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('30 unique');
    });

    test('should reject alphabet with hyphen', () => {
      const result = validateAlphabet('0123456789ABCDEFGHJKLMNPQRSTU-');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('hyphen');
    });

    test('should reject non-string input', () => {
      const result = validateAlphabet(null);
      expect(result.valid).toBe(false);
    });
  });

  describe('Integration tests', () => {
    test('should encode and decode round trip', () => {
      const testCases = [
        { lat: 8.0, lon: 68.0 },
        { lat: 12.9716, lon: 77.5946 }, // Bangalore
        { lat: 19.0760, lon: 72.8777 }, // Mumbai
        { lat: 28.7041, lon: 77.1025 }, // Delhi
      ];

      testCases.forEach(({ lat, lon }) => {
        const encoded = encodePocketId(lat, lon, config);
        const decoded = decodePocketId(encoded.pocketId, config);
        
        // Center should be within the finest cell (1km)
        const distance = haversineDistance(
          lat,
          lon,
          decoded.centerLat,
          decoded.centerLon
        );
        expect(distance).toBeLessThan(1000); // Within 1km cell
      });
    });

    test('should handle edge cases near grid boundaries', () => {
      const testCases = [
        { lat: 8.0, lon: 68.0 }, // Origin
        { lat: 8.0 + 500000 / 111000, lon: 68.0 }, // 500km north
        { lat: 8.0, lon: 68.0 + 500000 / metersPerDegreeLon(8.0) }, // 500km east
      ];

      testCases.forEach(({ lat, lon }) => {
        const result = encodePocketId(lat, lon, config);
        expect(result.pocketId).toBeDefined();
        expect(result.pocketId.split('-')).toHaveLength(5);
      });
    });
  });
});
