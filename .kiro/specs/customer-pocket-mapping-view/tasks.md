# Implementation Plan: Customer Pocket Mapping View

## Overview

This implementation plan breaks down the Customer Pocket Mapping View feature into discrete coding tasks. The approach follows a bottom-up strategy: first establishing the database schema and backend services, then building API endpoints, and finally implementing the frontend interface. Each task builds incrementally on previous work, with testing integrated throughout to catch errors early.

## Tasks

- [x] 1. Set up database schema and migrations
  - Create migration file for `customer_pocket_mappings` table with all required columns
  - Add indexes on `job_id`, `customer_id`, `pocket_id`, and `created_at` columns
  - Add foreign key constraints to `jobs` and `branches` tables with CASCADE delete
  - Test migration up and down to ensure schema correctness
  - _Requirements: 1.1, 1.2, 1.3, 8.1, 8.3_

- [x] 1.1 Write unit tests for database schema
  - Test foreign key constraints work correctly
  - Test cascade deletion when job is deleted
  - Test index existence
  - _Requirements: 1.3, 8.3_

- [x] 2. Implement distance calculation utility
  - [x] 2.1 Create `distanceCalculator.ts` utility with Haversine formula implementation
    - Implement `calculateDistance(lat1, lon1, lat2, lon2)` function
    - Handle edge cases (same point, antipodal points, invalid coordinates)
    - _Requirements: 5.2, 5.3, 5.4_

  - [x] 2.2 Write property test for distance calculation consistency
    - **Property 4: Distance Calculation Consistency**
    - **Validates: Requirements 1.5, 5.2, 5.3, 5.4**

  - [x] 2.3 Write unit tests for distance calculation
    - Test known coordinate pairs (NYC to LA, London to Tokyo)
    - Test edge cases (same point returns 0, invalid coordinates)
    - _Requirements: 5.2, 5.3_

- [x] 3. Implement branch finder service
  - [x] 3.1 Create `BranchFinderService` class
    - Implement `findNearestBranch(pocketLat, pocketLon)` method
    - Query branches table and calculate distances using distance utility
    - Return branch with minimum distance
    - Handle case when no branches exist
    - _Requirements: 1.4, 5.1_

  - [x] 3.2 Write property test for nearest branch correctness
    - **Property 3: Nearest Branch Correctness**
    - **Validates: Requirements 1.4, 5.1**

  - [x] 3.3 Write unit tests for branch finder
    - Test with known branch locations
    - Test with no branches (error case)
    - Test with equidistant branches (deterministic selection)
    - _Requirements: 1.4, 5.1, 5.5_

- [x] 4. Implement mapping persistence service
  - [x] 4.1 Create `MappingService` class with save functionality
    - Implement `saveMappings(jobId, mappings)` method for bulk insert
    - Use parameterized queries to prevent SQL injection
    - Implement batch insertion (1000 records at a time)
    - Add error handling with logging for failed inserts
    - _Requirements: 1.1, 1.2, 1.3, 7.1, 7.3_

  - [x] 4.2 Write property test for mapping persistence completeness
    - **Property 1: Mapping Persistence Completeness**
    - **Validates: Requirements 1.1, 1.2, 2.2**

  - [x] 4.3 Write property test for job association integrity
    - **Property 2: Job Association Integrity**
    - **Validates: Requirements 1.3**

  - [x] 4.4 Write unit tests for mapping service
    - Test successful bulk insert
    - Test error handling when database fails
    - Test batch splitting for large datasets
    - _Requirements: 1.1, 7.3_

- [x] 5. Integrate mapping persistence with batch processing
  - [x] 5.1 Modify batch processing workflow to call mapping service
    - After assigning customers to pockets, collect mapping data
    - Calculate nearest branch for each pocket
    - Call `saveMappings()` with collected data
    - Maintain existing Excel export functionality
    - Add error handling to continue processing if persistence fails
    - _Requirements: 7.1, 7.2, 7.3, 7.5_

  - [x] 5.2 Write property test for batch processing integration
    - **Property 15: Batch Processing Integration Transparency**
    - **Validates: Requirements 7.1, 7.2**

  - [x] 5.3 Write property test for mapping count invariant
    - **Property 17: Mapping Count Invariant**
    - **Validates: Requirements 7.5**

  - [x] 5.4 Write unit test for error resilience
    - Simulate database failure during batch processing
    - Verify processing continues and completes
    - Verify error is logged
    - _Requirements: 7.3_

- [x] 6. Checkpoint - Ensure persistence layer works
  - Run batch processing with test data
  - Verify mappings appear in database
  - Verify Excel export still works
  - Ensure all tests pass, ask the user if questions arise

- [x] 7. Implement mapping retrieval service
  - [x] 7.1 Add `getMappings(filters, pagination)` method to MappingService
    - Build SQL query with WHERE clauses for filters (jobId, customerId, pocketId)
    - Implement pagination with LIMIT and OFFSET
    - Join with branches table to get branch name
    - Return data with pagination metadata
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 7.2 Write property test for pagination boundary correctness
    - **Property 6: Pagination Boundary Correctness**
    - **Validates: Requirements 2.3, 6.2**

  - [x] 7.3 Write property test for job filter exclusivity
    - **Property 7: Job Filter Exclusivity**
    - **Validates: Requirements 2.4**

  - [x] 7.4 Write property test for customer ID filter correctness
    - **Property 8: Customer ID Filter Correctness**
    - **Validates: Requirements 2.5**

  - [x] 7.5 Write property test for pocket ID filter correctness
    - **Property 9: Pocket ID Filter Correctness**
    - **Validates: Requirements 2.6**

  - [x] 7.6 Write unit tests for retrieval service
    - Test with various filter combinations
    - Test pagination edge cases (empty results, single page)
    - Test with invalid parameters (negative page numbers)
    - _Requirements: 2.3, 2.4, 2.5, 2.6_

- [x] 8. Implement GET /api/customer-mappings endpoint
  - [x] 8.1 Create Express route handler for GET /api/customer-mappings
    - Parse query parameters (page, pageSize, jobId, customerId, pocketId)
    - Validate parameters and set defaults
    - Call MappingService.getMappings()
    - Return JSON response with data and pagination metadata
    - Add error handling for database errors
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 8.2 Write property test for API response completeness
    - **Property 5: API Response Completeness**
    - **Validates: Requirements 2.2**

  - [x] 8.3 Write unit tests for GET endpoint
    - Test successful response with valid parameters
    - Test with various filter combinations
    - Test error responses (database failure, invalid parameters)
    - _Requirements: 2.1, 2.2_

- [x] 9. Implement POST /api/customer-mappings/batch endpoint
  - [x] 9.1 Create Express route handler for POST /api/customer-mappings/batch
    - Validate request body structure
    - Call MappingService.saveMappings()
    - Return success response with inserted count
    - Add error handling and return appropriate status codes
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 9.2 Write unit tests for POST endpoint
    - Test successful bulk insert
    - Test with invalid request body
    - Test error handling
    - _Requirements: 1.1_

- [x] 10. Implement DELETE /api/customer-mappings endpoint
  - [x] 10.1 Create `deleteMappings(olderThan, jobId)` method in MappingService
    - Build DELETE query with WHERE clause for date filter
    - Optionally filter by jobId
    - Log deletion operation with count
    - Return deleted count
    - _Requirements: 8.2, 8.3, 8.5_

  - [x] 10.2 Create Express route handler for DELETE /api/customer-mappings
    - Parse query parameters (olderThan, jobId)
    - Validate date format
    - Call MappingService.deleteMappings()
    - Return success response with deleted count
    - _Requirements: 8.2, 8.3_

  - [x] 10.3 Write property test for retention-based deletion
    - **Property 19: Retention-Based Deletion Correctness**
    - **Validates: Requirements 8.2**

  - [x] 10.4 Write property test for deletion audit trail
    - **Property 21: Deletion Audit Trail**
    - **Validates: Requirements 8.5**

  - [x] 10.5 Write unit tests for DELETE endpoint
    - Test deletion with date filter
    - Test deletion with job filter
    - Test with invalid date format
    - _Requirements: 8.2, 8.3_

- [x] 11. Checkpoint - Ensure API layer works
  - Test all endpoints with Postman or curl
  - Verify GET returns correct data with filters
  - Verify POST persists data correctly
  - Verify DELETE removes correct records
  - Ensure all tests pass, ask the user if questions arise

- [x] 12. Create frontend data models and types
  - [x] 12.1 Create TypeScript interfaces in `types/customerMapping.ts`
    - Define CustomerMapping interface
    - Define FilterState interface
    - Define PaginationState interface
    - Define API response types
    - _Requirements: 3.1, 4.1_

- [x] 13. Implement API client service
  - [x] 13.1 Create `customerMappingApi.ts` service
    - Implement `fetchMappings(filters, pagination)` function
    - Implement error handling and retry logic
    - Use axios or fetch for HTTP requests
    - Parse and validate API responses
    - _Requirements: 2.1, 3.1_

  - [x] 13.2 Write unit tests for API client
    - Mock HTTP responses
    - Test successful data fetching
    - Test error handling
    - _Requirements: 2.1_

- [x] 14. Implement CustomerMappingTable component
  - [x] 14.1 Create `CustomerMappingTable.tsx` component
    - Use Material-UI Table components
    - Display all 8 required columns with headers
    - Implement pagination controls using Material-UI TablePagination
    - Handle loading state with skeleton rows or spinner
    - Handle empty state with message
    - _Requirements: 3.1, 3.2, 3.3, 3.5_

  - [x] 14.2 Write property test for UI column completeness
    - **Property 10: UI Column Completeness**
    - **Validates: Requirements 3.1, 3.2**

  - [x] 14.3 Write property test for loading state visibility
    - **Property 12: Loading State Visibility**
    - **Validates: Requirements 3.5**

  - [x] 14.4 Write unit tests for table component
    - Test rendering with mock data
    - Test pagination controls
    - Test loading state
    - Test empty state
    - _Requirements: 3.1, 3.2, 3.3, 3.5_

- [x] 15. Implement FilterPanel component
  - [x] 15.1 Create `FilterPanel.tsx` component
    - Add Material-UI Select for job filter
    - Add TextField for customer ID search with debounce (500ms)
    - Add TextField for pocket ID search with debounce (500ms)
    - Add Button to clear all filters
    - Emit filter changes to parent component
    - _Requirements: 4.1, 4.2, 4.3, 4.6_

  - [x] 15.2 Write property test for filter application correctness
    - **Property 13: Filter Application Correctness**
    - **Validates: Requirements 4.4**

  - [x] 15.3 Write property test for multiple filter conjunction
    - **Property 14: Multiple Filter Conjunction**
    - **Validates: Requirements 4.5**

  - [x] 15.4 Write unit tests for filter panel
    - Test filter controls render correctly
    - Test debounce behavior
    - Test clear filters button
    - _Requirements: 4.1, 4.2, 4.3, 4.6_

- [x] 16. Implement CustomerMappingView container component
  - [x] 16.1 Create `CustomerMappingView.tsx` container
    - Manage state for mappings, filters, pagination, loading, and errors
    - Implement `fetchMappings()` function to call API
    - Implement `handleFilterChange()` to update filters and refetch
    - Implement `handlePageChange()` to update page and refetch
    - Implement `clearFilters()` to reset filters
    - Compose FilterPanel and CustomerMappingTable components
    - Add error handling with toast notifications or error display
    - _Requirements: 2.1, 3.1, 4.4, 4.5_

  - [x] 16.2 Write property test for UI pagination synchronization
    - **Property 11: UI Pagination Synchronization**
    - **Validates: Requirements 3.3**

  - [x] 16.3 Write integration tests for container component
    - Mock API calls
    - Test full user flow (load data, apply filters, change pages)
    - Test error handling
    - _Requirements: 3.1, 4.4_

- [x] 17. Integrate CustomerMappingView into application
  - [x] 17.1 Add route for customer mapping view
    - Add route in React Router configuration
    - Add navigation link in Batch Processing section
    - Use appropriate icon and label ("Customer Mappings" or "Mapping View")
    - _Requirements: 3.1_

  - [x] 17.2 Write end-to-end test for navigation
    - Test clicking navigation link loads the view
    - Test view displays data correctly
    - _Requirements: 3.1_

- [x] 18. Add timestamp property to mappings
  - [x] 18.1 Ensure created_at timestamp is set on insert
    - Verify database default CURRENT_TIMESTAMP works
    - Verify timestamp appears in API responses
    - _Requirements: 8.1_

  - [x] 18.2 Write property test for timestamp presence
    - **Property 18: Timestamp Presence**
    - **Validates: Requirements 8.1**

- [x] 19. Implement cascade deletion for job cleanup
  - [x] 19.1 Verify CASCADE delete constraint works
    - Test deleting a job removes associated mappings
    - Add logging for cascade deletions
    - _Requirements: 8.3_

  - [x] 19.2 Write property test for cascade deletion integrity
    - **Property 20: Cascade Deletion Integrity**
    - **Validates: Requirements 8.3**

  - [x] 19.3 Write unit test for cascade deletion
    - Create job with mappings
    - Delete job
    - Verify mappings are deleted
    - _Requirements: 8.3_

- [x] 20. Final checkpoint - End-to-end testing
  - Run complete batch processing workflow
  - Verify mappings appear in database
  - Open frontend and verify data displays correctly
  - Test all filters and pagination
  - Test with large dataset (10,000+ records)
  - Verify performance is acceptable
  - Ensure all tests pass, ask the user if questions arise

## Notes

- All tasks are required for comprehensive implementation with full test coverage
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at key milestones
- Property tests validate universal correctness properties across random inputs
- Unit tests validate specific examples, edge cases, and error conditions
- The implementation follows a bottom-up approach: database → services → API → frontend
- All distance calculations use the Haversine formula for consistency
- Pagination defaults to 100 records per page for performance
- Filter inputs use 500ms debounce to reduce API calls
- Bulk inserts process 1000 records at a time to avoid memory issues
