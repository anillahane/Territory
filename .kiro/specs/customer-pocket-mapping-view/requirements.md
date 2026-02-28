# Requirements Document: Customer Pocket Mapping View

## Introduction

The Customer Pocket Mapping View feature provides a comprehensive interface for viewing and analyzing customer-to-pocket assignments created during batch processing operations. This feature addresses the need to persist and visualize the mapping data that is currently only available in Excel exports, enabling users to understand spatial relationships between customers, pockets, and branches within the Location Pockets application.

## Glossary

- **System**: The Location Pockets application backend and frontend components
- **Customer**: An entity with a unique identifier (lan) and geographic coordinates that needs to be assigned to a pocket
- **Pocket**: A geographic cluster or zone that groups customers based on proximity
- **Branch**: A physical location with geographic coordinates that serves as a service point
- **Batch_Job**: A processing operation that assigns multiple customers to pockets
- **Customer_Mapping**: A record linking a customer to a pocket with associated distance metrics
- **Database**: The PostgreSQL database storing application data
- **API**: The Node.js/Express backend REST endpoints
- **UI**: The React/Material-UI frontend interface
- **Distance_Metric**: A measurement in meters between two geographic points

## Requirements

### Requirement 1: Persist Customer Pocket Mappings

**User Story:** As a system administrator, I want customer-to-pocket mappings to be stored in the database during batch processing, so that the data is available for analysis beyond the Excel export.

#### Acceptance Criteria

1. WHEN a batch job assigns customers to pockets, THE System SHALL store each customer mapping in the database
2. THE System SHALL store the customer identifier, coordinates, assigned pocket identifier, and distance from customer to pocket center for each mapping
3. WHEN storing a customer mapping, THE System SHALL associate it with the batch job identifier
4. WHEN storing a customer mapping, THE System SHALL calculate and store the nearest branch for the assigned pocket
5. THE System SHALL store the distance from pocket center to nearest branch and distance from customer to nearest branch

### Requirement 2: Retrieve Customer Mappings

**User Story:** As a user, I want to retrieve customer-to-pocket mappings through an API, so that I can view and analyze the data in the application interface.

#### Acceptance Criteria

1. THE System SHALL provide an API endpoint to retrieve customer mappings
2. WHEN retrieving customer mappings, THE System SHALL return customer ID, customer coordinates, pocket ID, assigned branch ID, and all distance metrics
3. THE System SHALL support pagination when retrieving customer mappings to handle large datasets
4. WHERE a batch job filter is specified, THE System SHALL return only mappings associated with that batch job
5. WHERE a customer ID filter is specified, THE System SHALL return only mappings matching that customer
6. WHERE a pocket ID filter is specified, THE System SHALL return only mappings for that pocket

### Requirement 3: Display Customer Mappings Table

**User Story:** As a user, I want to view a table of customer-to-pocket mappings, so that I can understand the spatial relationships in my data.

#### Acceptance Criteria

1. THE UI SHALL display a table showing customer mappings with all required columns
2. THE UI SHALL display customer ID, customer latitude, customer longitude, pocket ID, distance from customer to pocket, branch ID, distance from pocket to branch, and distance from customer to branch for each mapping
3. THE UI SHALL support pagination controls to navigate through large datasets
4. WHEN the table loads, THE UI SHALL display mappings in a readable format with appropriate column headers
5. THE UI SHALL provide visual feedback during data loading operations

### Requirement 4: Filter Customer Mappings

**User Story:** As a user, I want to filter customer mappings by batch job, customer ID, or pocket ID, so that I can focus on specific subsets of data.

#### Acceptance Criteria

1. THE UI SHALL provide a filter control for selecting a specific batch job
2. THE UI SHALL provide a search input for filtering by customer ID
3. THE UI SHALL provide a search input for filtering by pocket ID
4. WHEN a filter is applied, THE UI SHALL update the table to show only matching records
5. WHEN multiple filters are applied, THE UI SHALL apply all filters simultaneously
6. THE UI SHALL provide a control to clear all active filters

### Requirement 5: Calculate Branch Assignments

**User Story:** As a system, I want to identify the nearest branch for each pocket, so that users can understand branch service coverage.

#### Acceptance Criteria

1. WHEN assigning a customer to a pocket, THE System SHALL identify the nearest branch to that pocket's center
2. THE System SHALL calculate the distance from the pocket center to the nearest branch using geographic coordinates
3. THE System SHALL calculate the distance from the customer location to the nearest branch
4. THE System SHALL use consistent distance calculation methods across all distance metrics
5. IF multiple branches are equidistant from a pocket center, THE System SHALL select one branch consistently

### Requirement 6: Handle Large Datasets

**User Story:** As a user, I want the system to perform well with large datasets, so that I can work with batch jobs containing thousands of customers.

#### Acceptance Criteria

1. WHEN retrieving customer mappings with more than 10,000 records, THE System SHALL return results within 3 seconds for the first page
2. THE System SHALL support pagination with configurable page sizes
3. THE Database SHALL use appropriate indexes to optimize query performance
4. THE UI SHALL render paginated data without performance degradation
5. WHEN applying filters, THE System SHALL execute filtered queries efficiently

### Requirement 7: Integrate with Batch Processing

**User Story:** As a developer, I want the mapping persistence to integrate seamlessly with existing batch processing, so that no manual intervention is required.

#### Acceptance Criteria

1. WHEN the existing batch processing assigns customers to pockets, THE System SHALL automatically persist mappings to the database
2. THE System SHALL maintain backward compatibility with existing Excel export functionality
3. IF database persistence fails during batch processing, THE System SHALL log the error and continue processing
4. THE System SHALL associate each mapping with the correct batch job identifier
5. WHEN a batch job completes, THE System SHALL confirm that all customer mappings have been persisted

### Requirement 8: Manage Data Retention

**User Story:** As a system administrator, I want control over how long customer mappings are retained, so that I can manage database storage effectively.

#### Acceptance Criteria

1. THE System SHALL store customer mappings with a timestamp indicating when they were created
2. THE System SHALL provide a mechanism to delete mappings older than a specified retention period
3. WHERE a batch job is deleted, THE System SHALL provide an option to delete associated customer mappings
4. THE System SHALL prevent deletion of mappings that are currently being viewed or processed
5. THE System SHALL log all mapping deletion operations for audit purposes
