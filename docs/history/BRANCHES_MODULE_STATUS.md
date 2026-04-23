# Branches Module - Status & Functionality

## Issue Fixed
**Problem**: Branches page was stuck in loading state  
**Root Cause**: API response format mismatch (camelCase vs snake_case field names)  
**Solution**: Added flexible response parsing to handle both naming conventions

---

## Module Purpose & Application

### What is a Branch?
A **Branch** represents a physical service location (office, store, warehouse, etc.) with:
- **Unique ID**: Identifier for the branch (e.g., "BR001", "NYC-MAIN")
- **Location Name**: City or branch name (e.g., "New York", "Downtown Office")
- **Geographic Coordinates**: Latitude and Longitude
- **Pocket ID**: Automatically calculated based on coordinates

### Real-World Application

**Scenario**: A delivery company with 50 service centers across a country

1. **Branch Upload**: Upload all 50 branch locations via Excel
2. **Automatic Pocket Assignment**: System calculates which geographic pocket each branch belongs to
3. **Customer Assignment**: When customers are processed, they're assigned to the nearest branch
4. **Territory Planning**: Visualize branch coverage and identify service gaps

---

## Core Functionality

### 1. 📋 View All Branches
**Features**:
- Paginated table view (10/25/50/100 per page)
- Sortable columns
- Real-time data grid with Material-UI DataGrid
- Display: ID, City, Lat, Lon, Pocket ID, Actions

**Use Case**: 
- Review all branch locations
- Verify branch data accuracy
- Monitor branch coverage

### 2. ➕ Add Single Branch
**Features**:
- Manual entry form
- Real-time validation
- Automatic Pocket ID calculation
- Coordinate validation (-90 to 90 for lat, -180 to 180 for lon)

**Use Case**:
- Add a new branch location
- Quick single-branch entry
- Testing/prototyping

**Workflow**:
1. Click "Add Branch"
2. Enter Branch ID (unique identifier)
3. Enter City/Name
4. Enter Latitude and Longitude
5. System automatically calculates Pocket ID
6. Save

### 3. ✏️ Edit Branch
**Features**:
- Update city name
- Update coordinates
- Pocket ID recalculates automatically
- Branch ID cannot be changed (primary key)

**Use Case**:
- Correct data entry errors
- Update branch location after relocation
- Refine coordinate precision

### 4. 🗑️ Delete Branch
**Features**:
- Confirmation dialog
- Cascade considerations (check if branch is referenced elsewhere)
- Permanent deletion

**Use Case**:
- Remove closed branches
- Clean up test data
- Maintain accurate branch list

### 5. 📤 Bulk Upload (Excel)
**Features**:
- Upload Excel file (.xlsx, .xls)
- Asynchronous processing with job queue
- Progress tracking
- Validation before insertion
- Duplicate detection
- Error reporting

**Excel Format**:
```
| ID     | City          | Latitude  | Longitude  |
|--------|---------------|-----------|------------|
| BR001  | New York      | 40.7128   | -74.0060   |
| BR002  | Los Angeles   | 34.0522   | -118.2437  |
| BR003  | Chicago       | 41.8781   | -87.6298   |
```

**Column Names** (case-insensitive):
- ID / Branch ID / BranchID
- City / Name / Branch Name
- Latitude / Lat
- Longitude / Lon / Long

**Use Case**:
- Initial system setup with many branches
- Bulk updates from external systems
- Data migration from legacy systems

**Workflow**:
1. Click "Upload Excel"
2. Download template (optional)
3. Select Excel file
4. System validates data
5. Progress bar shows upload status
6. Success message with count of inserted branches

### 6. 📥 Export to Excel
**Features**:
- Export all branches to Excel
- Includes all fields: ID, City, Lat, Lon, Pocket ID
- Timestamped filename
- Ready for editing and re-upload

**Use Case**:
- Backup branch data
- Share with external teams
- Bulk editing in Excel
- Data analysis

### 7. 📄 Download Template
**Features**:
- Pre-formatted Excel template
- Correct column headers
- Example data
- Instructions

**Use Case**:
- First-time users
- Ensure correct format
- Reduce upload errors

### 8. 🔄 Refresh Data
**Features**:
- Manual refresh button
- Reload latest data from database
- Useful after bulk operations

---

## Technical Details

### Database Schema
```sql
CREATE TABLE branches (
    id VARCHAR(20) PRIMARY KEY,
    city VARCHAR(100),
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    geom GEOGRAPHY(POINT, 4326),  -- PostGIS geography for spatial queries
    pocket_id VARCHAR(50),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_lat CHECK (lat >= -90 AND lat <= 90),
    CONSTRAINT valid_lon CHECK (lon >= -180 AND lon <= 180)
);

-- Spatial index for fast geographic queries
CREATE INDEX idx_branches_geom ON branches USING GIST (geom);

-- Index for pocket lookups
CREATE INDEX idx_branches_pocket_id ON branches (pocket_id);
```

### Automatic Features

1. **Pocket ID Calculation**:
   - Triggered on INSERT/UPDATE
   - Uses current system configuration (origin point, alphabet)
   - Encodes geographic position into readable ID

2. **Geography Column**:
   - Automatically populated from lat/lon
   - Enables spatial queries (nearest branch, within radius)
   - PostGIS GEOGRAPHY type for accurate distance calculations

3. **Timestamp Management**:
   - `created_at`: Set on INSERT
   - `updated_at`: Auto-updated on every UPDATE

### API Endpoints

#### GET /api/v1/branches
**Query Parameters**:
- `limit`: Number of records (default: 100)
- `offset`: Pagination offset (default: 0)
- `search`: Search in ID, city, or pocket_id

**Response**:
```json
{
  "branches": [
    {
      "id": "BR001",
      "city": "New York",
      "lat": 40.7128,
      "lon": -74.0060,
      "pocketId": "A1B2C-D3E4F",
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    }
  ],
  "pagination": {
    "total": 50,
    "limit": 100,
    "offset": 0,
    "hasMore": false
  }
}
```

#### POST /api/v1/branches
**Request Body**:
```json
{
  "id": "BR001",
  "city": "New York",
  "lat": 40.7128,
  "lon": -74.0060
}
```

#### PUT /api/v1/branches/:id
**Request Body**:
```json
{
  "city": "New York City",
  "lat": 40.7128,
  "lon": -74.0060
}
```

#### DELETE /api/v1/branches/:id
**Response**: 204 No Content

#### POST /api/v1/branches/upload
**Request**: multipart/form-data with Excel file
**Response**:
```json
{
  "message": "Upload queued for processing",
  "jobId": "uuid-here",
  "status": "queued",
  "statusUrl": "/api/v1/jobs/uuid-here"
}
```

#### GET /api/v1/branches/export
**Response**: Excel file download

---

## Integration with Other Modules

### 1. Configuration Module
- Uses origin point and alphabet from configuration
- Pocket ID calculation depends on configuration
- Configuration changes require branch Pocket ID recalculation

### 2. Batch Processing
- Customers are assigned to nearest branch
- Branch locations used for distance calculations
- Branch Pocket IDs used for territory grouping

### 3. Customer Mappings
- Each mapping includes nearest branch ID
- Branch name displayed in mapping table
- Foreign key relationship ensures data integrity

### 4. Calculator
- Branch locations used for nearest branch finder
- Distance calculations from customer to branch
- Pocket-based branch lookup

### 5. Dashboard (Future)
- Branch markers on map
- Branch coverage visualization
- Territory heat maps

---

## Validation Rules

### Branch ID
- Required
- Max 20 characters
- Must be unique
- Cannot be changed after creation

### City/Name
- Optional
- Max 100 characters
- Descriptive name for the branch

### Latitude
- Required
- Must be between -90 and 90
- Decimal degrees format
- 6 decimal places recommended for precision

### Longitude
- Required
- Must be between -180 and 180
- Decimal degrees format
- 6 decimal places recommended for precision

### Pocket ID
- Automatically calculated
- Cannot be manually set
- Recalculates on coordinate change
- Format: `XXXXX-XXXXX-XXXXX` (varies by grid level)

---

## Common Workflows

### Initial Setup (50+ Branches)
1. Download template
2. Fill in Excel with all branch data
3. Upload Excel file
4. Monitor progress
5. Verify all branches loaded correctly
6. Export for backup

### Add New Branch
1. Click "Add Branch"
2. Enter details
3. Verify Pocket ID looks correct
4. Save

### Update Branch Location
1. Find branch in table
2. Click Edit icon
3. Update coordinates
4. Note new Pocket ID
5. Save

### Bulk Update
1. Export current branches
2. Edit in Excel
3. Upload updated file
4. System updates existing branches

### Data Cleanup
1. Review branch list
2. Identify duplicates or errors
3. Delete incorrect entries
4. Re-upload corrected data if needed

---

## Performance Considerations

### Large Datasets
- Pagination prevents loading all branches at once
- DataGrid virtualizes rows for smooth scrolling
- Spatial indexes enable fast geographic queries

### Upload Processing
- Asynchronous job queue prevents timeout
- Progress tracking for user feedback
- Batch insertion (1000 records at a time)

### Search
- Indexed columns for fast search
- ILIKE for case-insensitive search
- Searches ID, city, and pocket_id

---

## Error Handling

### Upload Errors
- Invalid file format → Clear error message
- Missing columns → Validation error with details
- Duplicate IDs → Skip or update based on logic
- Invalid coordinates → Row-level error reporting

### Validation Errors
- Real-time feedback in forms
- Clear error messages
- Helper text for guidance

### Network Errors
- Retry logic in API client
- User-friendly error messages
- Graceful degradation

---

## Status: ✅ WORKING

All functionality is implemented and the loading issue has been fixed. The module is ready for production use.

## Next Steps (Optional Enhancements)

1. **Map View**: Visualize branches on interactive map
2. **Bulk Edit**: Edit multiple branches at once
3. **Import History**: Track upload history and changes
4. **Branch Groups**: Organize branches into regions/territories
5. **Coverage Analysis**: Identify areas without branch coverage
6. **Distance Matrix**: Pre-calculate distances between all branches
