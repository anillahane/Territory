# Excel File Formats Guide

## Overview

This document describes the Excel file formats required for uploading data to the Location Pockets System.

---

## 1. Branch Upload Format

### Required Columns

| Column Name | Type | Required | Description | Example |
|------------|------|----------|-------------|---------|
| ID | Text | ✅ Yes | Unique branch identifier | BR001 |
| City | Text | ✅ Yes | Branch name or city | Mumbai |
| Latitude | Number | ✅ Yes | Latitude coordinate (-90 to 90) | 19.0760 |
| Longitude | Number | ✅ Yes | Longitude coordinate (-180 to 180) | 72.8777 |

### Column Name Variations (Case-Insensitive)

The system accepts these alternative column names:
- **ID**: `ID`, `id`, `Branch ID`, `branch id`
- **City**: `City`, `city`, `CITY`
- **Latitude**: `Latitude`, `latitude`, `Lat`, `lat`
- **Longitude**: `Longitude`, `longitude`, `Lon`, `lon`

### Sample Data

```
ID      City        Latitude    Longitude
BR001   Mumbai      19.0760     72.8777
BR002   Delhi       28.7041     77.1025
BR003   Bangalore   12.9716     77.5946
BR004   Chennai     13.0827     80.2707
BR005   Kolkata     22.5726     88.3639
```

### Download Template

Click **"Download Template"** button on the Branches page to get a pre-formatted Excel file with:
- Sample data (5 Indian cities)
- Instructions sheet
- Proper column formatting

### What Happens After Upload

1. File is validated
2. Pocket IDs are automatically calculated for each branch
3. Branches are inserted/updated in the database
4. Progress bar shows real-time status
5. Success message displays number of branches uploaded

---

## 2. Batch Processing Format

### Required Columns

| Column Name | Type | Required | Description | Example |
|------------|------|----------|-------------|---------|
| Latitude | Number | ✅ Yes | Latitude coordinate (-90 to 90) | 19.0760 |
| Longitude | Number | ✅ Yes | Longitude coordinate (-180 to 180) | 72.8777 |

### Optional Columns

You can include any additional columns you want - they will be preserved in the output file:

| Column Name | Type | Description | Example |
|------------|------|-------------|---------|
| Location Name | Text | Name of the location | Mumbai Office |
| Description | Text | Additional details | Head Office |
| Customer ID | Text | Your custom identifier | CUST001 |
| Address | Text | Full address | 123 Main St |
| ... | Any | Any other data you need | ... |

### Column Name Variations (Case-Insensitive)

- **Latitude**: `Latitude`, `latitude`, `Lat`, `lat`
- **Longitude**: `Longitude`, `longitude`, `Lon`, `lon`

### Sample Data

```
Location Name       Latitude    Longitude   Description
Mumbai Office       19.0760     72.8777     Head Office
Delhi Branch        28.7041     77.1025     Regional Office
Bangalore Center    12.9716     77.5946     Tech Hub
Chennai Office      13.0827     80.2707     South Regional Office
Kolkata Branch      22.5726     88.3639     East Regional Office
```

### Download Template

Click **"Download Template"** button on the Batch Processing page to get a pre-formatted Excel file with:
- Sample data (5 locations)
- Instructions sheet
- Proper column formatting
- Example optional columns

### What Happens After Upload

1. File is validated
2. Pocket IDs are calculated for each coordinate
3. **New column "PocketID" is added** to your data
4. Result file is generated with all original columns + PocketID
5. File auto-downloads when complete

### Output Format

The output file will contain all your original columns PLUS a new "PocketID" column:

```
Location Name       Latitude    Longitude   Description             PocketID
Mumbai Office       19.0760     72.8777     Head Office            G5H2K8
Delhi Branch        28.7041     77.1025     Regional Office        H3J4M9
Bangalore Center    12.9716     77.5946     Tech Hub               F8K2N5
Chennai Office      13.0827     80.2707     South Regional Office  G2J7P3
Kolkata Branch      22.5726     88.3639     East Regional Office   H5L9Q2
```

---

## Processing Modes

### Branch Upload
- **Always uses background processing** with job queue
- Progress bar shows real-time status
- Can upload multiple files simultaneously
- Job history available for tracking

### Batch Processing
- **Small files (<1000 rows)**: Instant processing, immediate download
- **Large files (≥1000 rows)**: Background processing with progress tracking
- Job history available for large files

---

## Validation Rules

### Coordinates
- **Latitude**: Must be between -90 and 90
- **Longitude**: Must be between -180 and 180
- **Format**: Decimal degrees (e.g., 19.0760, not 19°4'33.6"N)

### Branch ID (Branch Upload Only)
- Must be unique
- Maximum 20 characters
- Can contain letters, numbers, and special characters

### City/Location Name
- Maximum 100 characters
- Can be empty (optional for batch processing)

---

## Error Handling

### Invalid Rows
- Rows with invalid coordinates are skipped
- Error report shows which rows failed and why
- Valid rows are still processed

### Duplicate IDs (Branch Upload)
- Existing branches are updated with new coordinates
- No duplicates are created

---

## Tips for Best Results

1. **Use the templates** - Download and modify the provided templates
2. **Check coordinates** - Verify latitude/longitude are in decimal format
3. **Keep it simple** - Only include necessary columns
4. **Test with small files** - Try 5-10 rows first
5. **Save as .xlsx** - Use modern Excel format (not .xls or .csv)

---

## Quick Access

### Download Templates

**Branches Page:**
- Navigate to: http://localhost:5173/branches
- Click: "Download Template" button

**Batch Processing Page:**
- Navigate to: http://localhost:5173/batch
- Click: "Download Template" button

### API Endpoints

```
GET /api/v1/templates/branch-upload
GET /api/v1/templates/batch-processing
```

---

## Need Help?

If you encounter issues:
1. Check the file format matches the template
2. Verify coordinates are in decimal format
3. Look at the error messages for specific row issues
4. Try the sample template first to ensure system is working
5. Check browser console (F12) for detailed error messages
