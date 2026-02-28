# Configuration Module - Status & Functionality

## ⚠️ ADMIN-ONLY MODULE

**Access Level**: System Administrators Only  
**Location**: Administration section in sidebar (red-colored)  
**Criticality**: HIGH - Changes affect entire system

## Issue Fixed
**Problem**: Configuration page was stuck in loading state  
**Root Cause**: API response format mismatch between backend and frontend  
**Solution**: Added flexible response handling to support both formats

---

## What This Module Controls

### The Core Mathematical Foundation of Pocket IDs

This module controls the **fundamental parameters** that define how the entire Pocket ID system works:

### 1. 🌍 Origin Point (Latitude, Longitude)
**Purpose**: The reference location from which ALL distance calculations are made.

**Real-World Example**:
- Current default: (8.0, 68.0) - Center of Maldives
- This is the "zero point" of your coordinate system
- All Pocket IDs are calculated relative to this point

**Impact of Change**:
- Every single Pocket ID in the system becomes invalid
- All distance calculations change
- All branch-to-pocket assignments must be recalculated

### 2. 🔤 Alphabet (30-Character Encoding Set)
**Purpose**: The character set used to encode geographic grid positions into readable Pocket IDs.

**Real-World Example**:
- Default: `0123456789ABCDEFGHJKLMNPQRSTUV`
- Excludes ambiguous characters (I/1, O/0) for clarity
- Cannot contain hyphen (-) as it's used as separator
- Example Pocket ID: `A1B2C-D3E4F-G5H6J`

**Impact of Change**:
- All existing Pocket IDs become unreadable/invalid
- Historical data references break
- Integration with external systems fails

### 3. 📏 Grid Levels (5 Distance Tiers)
**Purpose**: Defines the hierarchical structure of how the world is divided into pockets.

**Real-World Example**:
- Default: [500000, 100000, 20000, 5000, 1000] meters
- Level 1: 500km - Country/region level
- Level 2: 100km - City level  
- Level 3: 20km - District level
- Level 4: 5km - Neighborhood level
- Level 5: 1km - Block level

**Impact of Change**:
- Pocket hierarchy changes
- Granularity of location tracking changes
- May require redefining business rules

---

## When to Use This Module

### ✅ Appropriate Use Cases:
1. **Initial System Setup**: Setting up the system for the first time
2. **Geographic Relocation**: Moving the entire operation to a different country/region
3. **System Migration**: Migrating from another system with different parameters
4. **Alphabet Standardization**: Adopting a company-wide encoding standard

### ❌ DO NOT Use For:
1. Regular operational tasks
2. Adding/removing branches
3. Processing customer data
4. Generating reports
5. Day-to-day administration

---

### 1. View Configuration
- **Endpoint**: `GET /api/v1/config`
- **Features**:
  - Display current origin point (latitude, longitude)
  - Display alphabet (30-character encoding set)
  - Display grid levels (5 distance levels for pocket hierarchy)
  - Show version number and timestamps

### 2. Update Configuration
- **Endpoint**: `PUT /api/v1/config`
- **Features**:
  - Update origin latitude (-90 to 90)
  - Update origin longitude (-180 to 180)
  - Update alphabet (exactly 30 unique characters, no hyphens)
  - Update grid levels (optional, defaults to [500000, 100000, 20000, 5000, 1000])
  - Validation for all fields
  - Real-time error feedback
  - Version tracking (auto-increments on each update)

### 3. Configuration History
- **Endpoint**: `GET /api/v1/config/history`
- **Features**:
  - View all previous configuration changes
  - Pagination support (limit/offset)
  - Shows timestamp, origin point, alphabet, and version for each change
  - Audit trail for compliance and debugging

### 4. Database Schema
```sql
-- Main config table (singleton pattern)
CREATE TABLE config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    origin_lat DOUBLE PRECISION NOT NULL DEFAULT 8.0,
    origin_lon DOUBLE PRECISION NOT NULL DEFAULT 68.0,
    alphabet VARCHAR(30) NOT NULL DEFAULT '0123456789ABCDEFGHJKLMNPQRSTUV',
    grid_levels JSONB NOT NULL DEFAULT '[500000, 100000, 20000, 5000, 1000]',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version INTEGER NOT NULL DEFAULT 1
);

-- Audit table for change tracking
CREATE TABLE config_audit (
    id SERIAL PRIMARY KEY,
    config_id INTEGER NOT NULL,
    origin_lat DOUBLE PRECISION NOT NULL,
    origin_lon DOUBLE PRECISION NOT NULL,
    alphabet VARCHAR(30) NOT NULL,
    grid_levels JSONB NOT NULL,
    changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version INTEGER NOT NULL
);
```

### 5. Validation Rules
- **Origin Latitude**: Must be between -90 and 90
- **Origin Longitude**: Must be between -180 and 180
- **Alphabet**: 
  - Exactly 30 characters
  - All characters must be unique
  - Cannot contain hyphen (-) as it's used as separator in Pocket IDs
  - Default: `0123456789ABCDEFGHJKLMNPQRSTUV`
- **Grid Levels**: Array of 5 positive numbers (optional)

### 6. UI Features
- **Configuration Form**:
  - Number inputs with step controls for lat/lon
  - Text input with character counter for alphabet
  - Real-time validation with error messages
  - Helper text for each field
  - Save button with loading state
  
- **Information Panel**:
  - Explanation of each configuration field
  - Warning about impact of changes
  - Guidance on recalculating branch Pocket IDs

- **History Panel**:
  - Collapsible history view
  - Chronological list of changes
  - Formatted timestamps
  - Version numbers

### 7. Automatic Features
- **Triggers**:
  - Auto-update `updated_at` timestamp on config changes
  - Auto-increment version number on updates
  - Auto-insert audit record before each update
  
- **Default Values**:
  - Origin: (8.0, 68.0) - Center of Maldives
  - Alphabet: Base-30 encoding without ambiguous characters (0/O, 1/I, etc.)
  - Grid Levels: [500km, 100km, 20km, 5km, 1km]

## Integration with Other Modules

### Pocket ID Generation
- Origin point is used as reference for all distance calculations
- Alphabet is used to encode grid indices into Pocket IDs
- Grid levels define the hierarchical structure of pockets

### Branch Management
- When configuration changes, existing branch Pocket IDs may need recalculation
- Warning displayed to users about this impact

### Batch Processing
- Uses current configuration for customer-to-pocket assignments
- Configuration version can be tracked with each batch job

## API Response Formats

### GET /api/v1/config
```json
{
  "id": 1,
  "originLat": 8.0,
  "originLon": 68.0,
  "alphabet": "0123456789ABCDEFGHJKLMNPQRSTUV",
  "gridLevels": [500000, 100000, 20000, 5000, 1000],
  "version": 1,
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

### PUT /api/v1/config
```json
{
  "message": "Configuration updated successfully",
  "config": {
    "id": 1,
    "originLat": 8.0,
    "originLon": 68.0,
    "alphabet": "0123456789ABCDEFGHJKLMNPQRSTUV",
    "gridLevels": [500000, 100000, 20000, 5000, 1000],
    "version": 2,
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### GET /api/v1/config/history
```json
{
  "history": [
    {
      "id": 1,
      "configId": 1,
      "originLat": 8.0,
      "originLon": 68.0,
      "alphabet": "0123456789ABCDEFGHJKLMNPQRSTUV",
      "gridLevels": [500000, 100000, 20000, 5000, 1000],
      "version": 1,
      "changedAt": "2024-01-01T00:00:00Z"
    }
  ],
  "pagination": {
    "total": 1,
    "limit": 10,
    "offset": 0,
    "hasMore": false
  }
}
```

## Testing Recommendations

1. **Unit Tests**:
   - Validate alphabet uniqueness
   - Validate coordinate ranges
   - Test version incrementing
   - Test audit trail creation

2. **Integration Tests**:
   - Test full update workflow
   - Verify history retrieval
   - Test pagination

3. **E2E Tests**:
   - Load configuration page
   - Update configuration
   - View history
   - Verify validation errors

## Status: ✅ WORKING

All functionality is implemented and the loading issue has been fixed. The module is ready for use.
