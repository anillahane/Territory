# Customer Data Upload Format

## Upload Location
**Batch Processing Page**: http://localhost:5173/batch

---

## Required Columns

| Column Name | Type | Description | Example |
|------------|------|-------------|---------|
| **lan** | Text | Customer ID or identifier | Customer001 |
| **canon_lat** | Number | Customer latitude (-90 to 90) | 19.0760 |
| **canon_long** | Number | Customer longitude (-180 to 180) | 72.8777 |

---

## Sample Data Format

```
lan          | canon_lat | canon_long
-------------|-----------|------------
Customer001  | 19.0760   | 72.8777
Customer002  | 28.7041   | 77.1025
Customer003  | 12.9716   | 77.5946
Customer004  | 13.0827   | 80.2707
Customer005  | 22.5726   | 88.3639
```

---

## Alternative Column Names (Also Accepted)

The system is flexible and accepts these alternative names:

### For Latitude:
- `canon_lat` (preferred)
- `Latitude`
- `latitude`
- `Lat`
- `lat`
- `CANON_LAT`

### For Longitude:
- `canon_long` (preferred)
- `Longitude`
- `longitude`
- `Lon`
- `lon`
- `CANON_LONG`

---

## Output Format

After processing, you'll get back your data PLUS these new columns:

| Column | Description | Example |
|--------|-------------|---------|
| **PocketID** | Assigned pocket identifier | 7F-33-22-11-00 |
| **Distance to Pocket Center (m)** | Distance in meters | 245 |
| **Pocket Center Lat** | Pocket center latitude | 19.0750 |
| **Pocket Center Lon** | Pocket center longitude | 72.8780 |

### Example Output:

```
lan          | canon_lat | canon_long | PocketID       | Distance to Pocket Center (m) | Pocket Center Lat | Pocket Center Lon
-------------|-----------|------------|----------------|-------------------------------|-------------------|------------------
Customer001  | 19.0760   | 72.8777    | 7F-33-22-11-00 | 245                          | 19.0750          | 72.8780
Customer002  | 28.7041   | 77.1025    | 8G-44-33-22-11 | 312                          | 28.7050          | 77.1020
```

---

## How to Upload

### Step 1: Download Template
1. Go to http://localhost:5173/batch
2. Click **"Download Template"** button
3. Template includes sample data with correct format

### Step 2: Fill Your Data
1. Open the downloaded Excel file
2. Replace sample data with your customer data
3. Keep column names: `lan`, `canon_lat`, `canon_long`
4. Save the file

### Step 3: Upload
1. Click **"Upload File"** button
2. Select your Excel file
3. Click **"Process"**

### Step 4: Get Results
- **Small files (<1000 rows)**: Download starts immediately
- **Large files (≥1000 rows)**: Progress bar shows status, then auto-downloads

---

## What Happens During Processing

```
For each customer:
  1. Read: lan, canon_lat, canon_long
  2. Find nearest pocket (by distance to pocket center)
  3. Calculate distance to pocket center
  4. Add: PocketID, Distance, Pocket Center coordinates
  5. Return enhanced data
```

---

## Distance-Based Assignment

The system uses **distance-based assignment**:

1. Customer coordinates are compared to **each pocket's center point**
2. Customer is assigned to the pocket with the **nearest center**
3. Distance is calculated and included in output

**Example:**
```
Customer at (19.1234, 72.8456)
  ↓
Search nearby pockets (50km radius)
  ├─> Pocket A center (19.1000, 72.8500): Distance = 3,245m ✓ NEAREST
  ├─> Pocket B center (19.2000, 72.9000): Distance = 8,521m
  └─> Pocket C center (19.0500, 72.7500): Distance = 12,134m
  ↓
Assigned to Pocket A
Distance: 3,245 meters
```

---

## Validation Rules

### Coordinates
- **canon_lat**: Must be between -90 and 90
- **canon_long**: Must be between -180 and 180
- **Format**: Decimal degrees (e.g., 19.0760)

### Customer ID (lan)
- Can be any text
- Used to identify customer in output
- No uniqueness requirement

---

## Error Handling

### Invalid Coordinates
- Rows with invalid coordinates are marked as ERROR
- Error report shows which rows failed
- Valid rows are still processed

### Missing Columns
- System looks for alternative column names
- If no valid coordinate columns found, upload fails
- Download template to see correct format

---

## Performance

| File Size | Processing Time | Method |
|-----------|----------------|--------|
| < 100 rows | < 1 second | Instant |
| 100-1000 rows | 1-10 seconds | Instant |
| 1000-10000 rows | 10-120 seconds | Background with progress |
| > 10000 rows | 2-20 minutes | Background with progress |

---

## Tips

1. **Use the template** - Download and modify it
2. **Keep column names** - Use `lan`, `canon_lat`, `canon_long`
3. **Check coordinates** - Verify they're in decimal format
4. **Test small first** - Try 5-10 rows to verify format
5. **Save as .xlsx** - Use modern Excel format

---

## Quick Start

```bash
# 1. Go to Batch Processing page
http://localhost:5173/batch

# 2. Download template
Click "Download Template"

# 3. Fill your data
lan          | canon_lat | canon_long
Customer001  | 19.0760   | 72.8777
Customer002  | 28.7041   | 77.1025

# 4. Upload and process
Click "Upload File" → Select file → Click "Process"

# 5. Download results
File auto-downloads with Pocket IDs added
```

---

## API Endpoint

For programmatic access:

```http
POST /api/v1/batch/encode
Content-Type: multipart/form-data

Body: file (Excel with lan, canon_lat, canon_long columns)

Response: 
- Small files: Excel file download (immediate)
- Large files: { jobId, statusUrl } (poll for status)
```

---

## Need Help?

1. **Download template** - Shows exact format
2. **Check column names** - Must include coordinate columns
3. **Verify coordinates** - Decimal format, valid ranges
4. **Browser console** - Press F12 for error details
5. **Backend logs** - Check terminal for processing errors

---

## Summary

✅ **Upload Location**: Batch Processing page
✅ **Required Columns**: lan, canon_lat, canon_long
✅ **Output**: Original data + PocketID + Distance + Pocket Center
✅ **Method**: Distance-based assignment to nearest pocket
✅ **Template**: Available for download on Batch Processing page
