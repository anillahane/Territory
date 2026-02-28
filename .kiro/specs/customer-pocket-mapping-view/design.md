# Design Document: Customer Pocket Mapping View

## Overview

The Customer Pocket Mapping View feature extends the Location Pockets application to persist and visualize customer-to-pocket assignments created during batch processing. The design introduces a new database table for storing mappings, backend API endpoints for data persistence and retrieval, and a frontend interface for viewing and filtering the data.

The system maintains the existing batch processing workflow while adding transparent persistence of mapping data. Users gain visibility into spatial relationships between customers, pockets, and branches through a paginated, filterable table interface.

## Architecture

### System Components

The feature integrates with three main layers of the existing application:

1. **Database Layer**: New `customer_pocket_mappings` table with indexes for efficient querying
2. **Backend API Layer**: Express.js endpoints for CRUD operations on mappings
3. **Frontend UI Layer**: React component with Material-UI table for data visualization

### Data Flow

```
Batch Processing → Calculate Mappings → Persist to Database
                                              ↓
User Request → API Endpoint → Query Database → Return Paginated Results
                                              ↓
Frontend Component → Display Table → Apply Filters → Re-query API
```

### Integration Points

- **Batch Processing Integration**: Hook into existing customer-to-pocket assignment logic
- **Branch Data Integration**: Query existing `branches` table for nearest branch calculations
- **Job Tracking Integration**: Link mappings to existing `jobs` table records

## Components and Interfaces

### Database Schema

#### customer_pocket_mappings Table

```sql
CREATE TABLE customer_pocket_mappings (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  customer_id VARCHAR(255) NOT NULL,
  customer_lat DECIMAL(10, 8) NOT NULL,
  customer_lon DECIMAL(11, 8) NOT NULL,
  pocket_id INTEGER NOT NULL,
  distance_customer_to_pocket DECIMAL(10, 2) NOT NULL,
  nearest_branch_id INTEGER NOT NULL REFERENCES branches(id),
  distance_pocket_to_branch DECIMAL(10, 2) NOT NULL,
  distance_customer_to_branch DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_job_id (job_id),
  INDEX idx_customer_id (customer_id),
  INDEX idx_pocket_id (pocket_id),
  INDEX idx_created_at (created_at)
);
```

**Design Rationale**: 
- Foreign key to `jobs` table enables cascade deletion when jobs are removed
- Indexes on `job_id`, `customer_id`, and `pocket_id` optimize filtering queries
- `created_at` index supports retention policy queries
- Decimal precision for coordinates matches standard GPS accuracy
- Distance fields use DECIMAL(10,2) for meter precision up to 99,999,999.99m

### Backend API Endpoints

#### POST /api/customer-mappings/batch

Persist multiple customer mappings from batch processing.

**Request Body**:
```typescript
{
  jobId: number;
  mappings: Array<{
    customerId: string;
    customerLat: number;
    customerLon: number;
    pocketId: number;
    distanceCustomerToPocket: number;
    nearestBranchId: number;
    distancePocketToBranch: number;
    distanceCustomerToBranch: number;
  }>;
}
```

**Response**:
```typescript
{
  success: boolean;
  insertedCount: number;
  errors?: Array<string>;
}
```

#### GET /api/customer-mappings

Retrieve customer mappings with pagination and filtering.

**Query Parameters**:
- `page` (number, default: 1): Page number for pagination
- `pageSize` (number, default: 100): Number of records per page
- `jobId` (number, optional): Filter by batch job ID
- `customerId` (string, optional): Filter by customer ID (partial match)
- `pocketId` (number, optional): Filter by pocket ID

**Response**:
```typescript
{
  data: Array<{
    id: number;
    customerId: string;
    customerLat: number;
    customerLon: number;
    pocketId: number;
    distanceCustomerToPocket: number;
    nearestBranchId: number;
    branchName?: string;
    distancePocketToBranch: number;
    distanceCustomerToBranch: number;
    createdAt: string;
  }>;
  pagination: {
    page: number;
    pageSize: number;
    totalRecords: number;
    totalPages: number;
  };
}
```

#### DELETE /api/customer-mappings

Delete mappings based on retention policy.

**Query Parameters**:
- `olderThan` (string, ISO date): Delete mappings created before this date
- `jobId` (number, optional): Delete mappings for specific job

**Response**:
```typescript
{
  success: boolean;
  deletedCount: number;
}
```

### Frontend Components

#### CustomerMappingView Component

Main container component for the mapping view feature.

**Props**: None (manages its own state)

**State**:
```typescript
{
  mappings: CustomerMapping[];
  loading: boolean;
  error: string | null;
  pagination: PaginationState;
  filters: FilterState;
}
```

**Key Methods**:
- `fetchMappings()`: Load data from API with current filters and pagination
- `handleFilterChange()`: Update filters and trigger data reload
- `handlePageChange()`: Navigate to different page
- `clearFilters()`: Reset all filters to default state

#### CustomerMappingTable Component

Displays the mapping data in a Material-UI table.

**Props**:
```typescript
{
  mappings: CustomerMapping[];
  loading: boolean;
  onPageChange: (page: number) => void;
  pagination: PaginationState;
}
```

**Columns**:
1. Customer ID
2. Customer Lat
3. Customer Lon
4. Pocket ID
5. Distance to Pocket (m)
6. Branch ID/Name
7. Distance Pocket→Branch (m)
8. Distance Customer→Branch (m)

#### FilterPanel Component

Provides filtering controls for the mapping data.

**Props**:
```typescript
{
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
  onClearFilters: () => void;
  availableJobs: Array<{id: number, name: string}>;
}
```

**Controls**:
- Job selector (dropdown)
- Customer ID search (text input with debounce)
- Pocket ID search (text input with debounce)
- Clear filters button

### Service Layer

#### MappingService

Handles business logic for customer mapping operations.

**Key Methods**:

```typescript
class MappingService {
  // Calculate nearest branch for a pocket center
  findNearestBranch(pocketLat: number, pocketLon: number): Promise<Branch>;
  
  // Calculate distance between two geographic points (Haversine formula)
  calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number;
  
  // Persist mappings during batch processing
  saveMappings(jobId: number, mappings: CustomerMapping[]): Promise<void>;
  
  // Retrieve mappings with filters
  getMappings(filters: FilterOptions, pagination: PaginationOptions): Promise<MappingResult>;
  
  // Delete old mappings based on retention policy
  deleteOldMappings(olderThan: Date, jobId?: number): Promise<number>;
}
```

## Data Models

### CustomerMapping

```typescript
interface CustomerMapping {
  id: number;
  jobId: number;
  customerId: string;
  customerLat: number;
  customerLon: number;
  pocketId: number;
  distanceCustomerToPocket: number;
  nearestBranchId: number;
  branchName?: string;
  distancePocketToBranch: number;
  distanceCustomerToBranch: number;
  createdAt: Date;
}
```

### FilterState

```typescript
interface FilterState {
  jobId: number | null;
  customerId: string;
  pocketId: number | null;
}
```

### PaginationState

```typescript
interface PaginationState {
  page: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
}
```

### Branch

```typescript
interface Branch {
  id: number;
  city: string;
  lat: number;
  lon: number;
}
```


## Correctness Properties

A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

### Property 1: Mapping Persistence Completeness

*For any* batch job that assigns customers to pockets, all customer assignments should result in corresponding database records with all required fields populated (customer ID, coordinates, pocket ID, distances, branch ID, and timestamp).

**Validates: Requirements 1.1, 1.2, 2.2**

### Property 2: Job Association Integrity

*For any* customer mapping stored in the database, the mapping should be correctly associated with its originating batch job ID, and querying by that job ID should return that mapping.

**Validates: Requirements 1.3**

### Property 3: Nearest Branch Correctness

*For any* pocket location and set of branches, the assigned nearest branch should be the branch with the minimum distance to the pocket center, calculated using the Haversine formula.

**Validates: Requirements 1.4, 5.1**

### Property 4: Distance Calculation Consistency

*For any* two geographic coordinate pairs, calculating the distance using the system's distance function should produce the same result regardless of which component (mapping service, branch finder, or API) performs the calculation, and the result should match the Haversine formula.

**Validates: Requirements 1.5, 5.2, 5.3, 5.4**

### Property 5: API Response Completeness

*For any* customer mapping retrieved through the API, the response should contain all required fields: customer ID, customer coordinates, pocket ID, all three distance metrics, and branch information.

**Validates: Requirements 2.2**

### Property 6: Pagination Boundary Correctness

*For any* page number and page size, the API should return exactly page_size records (or fewer for the last page), and requesting consecutive pages should return non-overlapping, complete subsets of the total dataset.

**Validates: Requirements 2.3, 6.2**

### Property 7: Job Filter Exclusivity

*For any* job ID filter applied to the API, all returned mappings should have that job ID, and no mappings with different job IDs should be returned.

**Validates: Requirements 2.4**

### Property 8: Customer ID Filter Correctness

*For any* customer ID filter string applied to the API, all returned mappings should have customer IDs that contain the filter string, and no mappings with non-matching customer IDs should be returned.

**Validates: Requirements 2.5**

### Property 9: Pocket ID Filter Correctness

*For any* pocket ID filter applied to the API, all returned mappings should have that exact pocket ID, and no mappings with different pocket IDs should be returned.

**Validates: Requirements 2.6**

### Property 10: UI Column Completeness

*For any* customer mapping displayed in the UI table, the rendered row should contain all eight required columns: customer ID, customer latitude, customer longitude, pocket ID, distance to pocket, branch ID/name, distance pocket to branch, and distance customer to branch.

**Validates: Requirements 3.1, 3.2**

### Property 11: UI Pagination Synchronization

*For any* page navigation action in the UI, the displayed table data should update to show the records corresponding to the new page number, and the pagination controls should reflect the current page state.

**Validates: Requirements 3.3**

### Property 12: Loading State Visibility

*For any* asynchronous data fetch operation, the UI should display a loading indicator while the operation is in progress, and hide it once the operation completes or fails.

**Validates: Requirements 3.5**

### Property 13: Filter Application Correctness

*For any* filter applied in the UI (job, customer ID, or pocket ID), the displayed table should update to show only records matching the filter criteria, and the API should be called with the correct filter parameters.

**Validates: Requirements 4.4**

### Property 14: Multiple Filter Conjunction

*For any* combination of multiple filters applied simultaneously, the displayed results should include only records that match all active filters (AND logic), not records that match any single filter.

**Validates: Requirements 4.5**

### Property 15: Batch Processing Integration Transparency

*For any* batch job that processes customers, the system should persist all customer-to-pocket mappings to the database while maintaining the existing Excel export functionality, such that both outputs contain equivalent data.

**Validates: Requirements 7.1, 7.2**

### Property 16: Error Resilience in Batch Processing

*For any* database persistence failure during batch processing, the system should log the error, continue processing remaining customers, and complete the batch job without terminating.

**Validates: Requirements 7.3**

### Property 17: Mapping Count Invariant

*For any* completed batch job, the number of customer mappings persisted in the database should equal the number of customers successfully assigned to pockets during that job.

**Validates: Requirements 7.5**

### Property 18: Timestamp Presence

*For any* customer mapping stored in the database, the record should have a non-null created_at timestamp that reflects when the mapping was created.

**Validates: Requirements 8.1**

### Property 19: Retention-Based Deletion Correctness

*For any* retention date specified in a deletion request, all mappings with created_at timestamps before that date should be deleted, and all mappings with timestamps on or after that date should be preserved.

**Validates: Requirements 8.2**

### Property 20: Cascade Deletion Integrity

*For any* batch job that is deleted, if cascade deletion is enabled, all associated customer mappings should also be deleted, and no orphaned mappings should remain in the database.

**Validates: Requirements 8.3**

### Property 21: Deletion Audit Trail

*For any* mapping deletion operation (retention-based or job-based), the system should create a log entry containing the deletion timestamp, the number of records deleted, and the deletion criteria.

**Validates: Requirements 8.5**

## Error Handling

### Database Errors

**Connection Failures**: 
- API endpoints should return 503 Service Unavailable with retry-after header
- Frontend should display user-friendly error message and retry button
- Batch processing should log error and continue with remaining operations

**Constraint Violations**:
- Foreign key violations (invalid job_id or branch_id) should return 400 Bad Request
- Duplicate mapping attempts should be handled idempotently (update existing record)
- NULL constraint violations should be caught and logged before database insertion

**Query Timeouts**:
- Long-running queries should have 30-second timeout
- Timeout errors should return 504 Gateway Timeout
- Frontend should suggest reducing page size or applying filters

### API Errors

**Invalid Parameters**:
- Invalid page numbers (< 1) should default to page 1
- Invalid page sizes should default to 100
- Non-numeric filter values should return 400 Bad Request with validation details

**Not Found**:
- Requests for non-existent job IDs should return empty result set, not 404
- This allows for graceful handling of deleted jobs

**Rate Limiting**:
- Implement rate limiting on GET endpoints (100 requests/minute per IP)
- Return 429 Too Many Requests with retry-after header

### Frontend Errors

**Network Failures**:
- Display toast notification with error message
- Provide retry button
- Maintain last successful data state

**Data Loading Failures**:
- Show error state in table with descriptive message
- Provide action button to retry or clear filters
- Log error details to console for debugging

**Invalid Filter Input**:
- Validate filter inputs client-side before API call
- Show inline validation errors for invalid formats
- Prevent API calls with invalid parameters

### Batch Processing Errors

**Mapping Calculation Failures**:
- Log error with customer ID and coordinates
- Skip that customer and continue with next
- Include error count in batch job summary

**Bulk Insert Failures**:
- Attempt to insert mappings in smaller batches (1000 at a time)
- If batch fails, attempt individual inserts to identify problematic records
- Log all failures with full context

**Branch Assignment Failures**:
- If no branches exist, log critical error and fail batch job
- If branch distance calculation fails, use fallback (first branch alphabetically)
- Log warning for fallback usage

## Testing Strategy

### Dual Testing Approach

This feature requires both unit testing and property-based testing for comprehensive coverage:

- **Unit tests**: Verify specific examples, edge cases, and error conditions
- **Property tests**: Verify universal properties across all inputs

Together, these approaches provide comprehensive coverage where unit tests catch concrete bugs and property tests verify general correctness.

### Property-Based Testing Configuration

**Library Selection**: 
- Backend (Node.js): Use `fast-check` library for property-based testing
- Frontend (React): Use `fast-check` with React Testing Library

**Test Configuration**:
- Minimum 100 iterations per property test (due to randomization)
- Each property test must reference its design document property
- Tag format: `Feature: customer-pocket-mapping-view, Property {number}: {property_text}`

**Example Property Test Structure**:

```typescript
// Feature: customer-pocket-mapping-view, Property 4: Distance Calculation Consistency
test('distance calculation produces consistent results across components', () => {
  fc.assert(
    fc.property(
      fc.float({ min: -90, max: 90 }), // lat1
      fc.float({ min: -180, max: 180 }), // lon1
      fc.float({ min: -90, max: 90 }), // lat2
      fc.float({ min: -180, max: 180 }), // lon2
      (lat1, lon1, lat2, lon2) => {
        const distanceFromService = mappingService.calculateDistance(lat1, lon1, lat2, lon2);
        const distanceFromBranchFinder = branchFinder.calculateDistance(lat1, lon1, lat2, lon2);
        const distanceFromAPI = apiHelper.calculateDistance(lat1, lon1, lat2, lon2);
        
        expect(distanceFromService).toBeCloseTo(distanceFromBranchFinder, 2);
        expect(distanceFromService).toBeCloseTo(distanceFromAPI, 2);
      }
    ),
    { numRuns: 100 }
  );
});
```

### Unit Testing Focus Areas

**Database Layer**:
- Test schema creation and migrations
- Test index existence and effectiveness
- Test foreign key constraints
- Test cascade deletion behavior
- Example: Verify deleting a job deletes associated mappings

**API Endpoints**:
- Test successful responses with valid data
- Test error responses with invalid parameters
- Test pagination edge cases (empty results, single page, last page)
- Test filter combinations
- Example: Verify filtering by non-existent job returns empty array

**Service Layer**:
- Test Haversine distance calculation with known coordinates
- Test nearest branch selection with known branch locations
- Test bulk insert with various batch sizes
- Test error handling for missing branches
- Example: Verify distance between NYC and LA coordinates

**Frontend Components**:
- Test table rendering with mock data
- Test pagination control interactions
- Test filter input handling and debouncing
- Test loading and error states
- Example: Verify clicking page 2 calls API with page=2

**Integration Points**:
- Test batch processing integration end-to-end
- Test Excel export still works after adding persistence
- Test concurrent access scenarios
- Example: Run batch job and verify mappings appear in database

### Edge Cases to Test

1. **Empty datasets**: Verify UI handles zero mappings gracefully
2. **Single record**: Verify pagination works with one record
3. **Exact page boundary**: Verify last record on page N doesn't appear on page N+1
4. **Equidistant branches**: Verify deterministic selection
5. **Invalid coordinates**: Verify validation rejects lat > 90 or lon > 180
6. **Very large distances**: Verify distance calculations handle antipodal points
7. **Concurrent deletions**: Verify race conditions don't cause orphaned records
8. **Special characters in customer IDs**: Verify SQL injection prevention

### Performance Testing

While not part of automated correctness testing, the following performance benchmarks should be validated manually:

- API response time with 10,000+ records: < 3 seconds for first page
- UI rendering time for 100 records: < 500ms
- Bulk insert of 17,000 mappings: < 10 seconds
- Filter application response time: < 1 second

### Test Data Generation

**For Property Tests**:
- Generate random coordinates within valid ranges (-90 to 90 lat, -180 to 180 lon)
- Generate random customer IDs (alphanumeric strings, 5-20 characters)
- Generate random pocket IDs (positive integers)
- Generate random distances (positive floats, 0 to 20,000,000 meters)
- Generate random timestamps within last 2 years

**For Unit Tests**:
- Use fixed, known coordinate pairs (e.g., NYC, LA, London, Tokyo)
- Use realistic customer IDs from sample data
- Use small datasets (10-50 records) for readability
- Use edge case values (0, negative, very large numbers)
