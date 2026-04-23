# Territory Pockets System - Technical Documentation

## Table of Contents
1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Technology Stack](#technology-stack)
4. [Installation & Setup](#installation--setup)
5. [Core Features](#core-features)
6. [API Documentation](#api-documentation)
7. [Database Schema](#database-schema)
8. [Configuration](#configuration)
9. [Deployment](#deployment)
10. [Troubleshooting](#troubleshooting)

---

## 1. System Overview

The Territory Pockets System is a geospatial application that divides geographic territories into hierarchical grid-based "pockets" and manages customer-to-branch assignments based on proximity.

### Key Capabilities
- **Hierarchical Grid System**: 5-level grid (500km → 100km → 20km → 5km → 1km)
- **Pocket ID Encoding**: Custom 30-character alphabet encoding for unique pocket identification
- **Branch Management**: Upload and manage physical branch locations
- **Customer Assignment**: Assign customers to nearest pockets and branches
- **Batch Processing**: Hybrid Node.js/Python worker system for optimal performance
- **Real-time Mapping View**: View and filter customer-pocket-branch relationships

### Business Value
- Optimize territory assignments for sales teams
- Reduce travel time and costs
- Balance workload across branches
- Data-driven territory planning

---

## 2. Architecture

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                         │
│                    http://localhost:5173                         │
│  - Dashboard  - Branches  - Batch Processing  - Calculator      │
│  - Configuration  - Customer Mapping View                        │
└────────────────────────┬────────────────────────────────────────┘
                         │ REST API
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Backend API (Node.js/Express)                 │
│                    http://localhost:3000                         │
│  - Routes  - Services  - Middleware  - Queue Management         │
└──────┬──────────────────┬──────────────────┬────────────────────┘
       │                  │                  │
       ▼                  ▼                  ▼
┌─────────────┐   ┌──────────────┐   ┌─────────────────┐
│ PostgreSQL  │   │    Redis     │   │  Python Worker  │
│  (PostGIS)  │   │  Job Queue   │   │  Large Files    │
│  Port 5434  │   │  Port 6379   │   │  (5000+ rows)   │
└─────────────┘   └──────────────┘   └─────────────────┘
```

### Component Breakdown

#### Frontend (React + TypeScript + Vite)
- **UI Framework**: Material-UI (MUI) for consistent design
- **State Management**: Zustand for global state
- **Routing**: React Router v6
- **HTTP Client**: Axios with retry logic
- **Build Tool**: Vite for fast development

#### Backend (Node.js + Express)
- **API Framework**: Express.js
- **Database Client**: node-postgres (pg)
- **Queue System**: Bull (Redis-based)
- **File Processing**: xlsx for Excel parsing
- **Logging**: Winston for structured logging

#### Python Worker
- **Purpose**: High-performance batch processing for large files
- **Libraries**: pandas, numpy, openpyxl, SQLAlchemy
- **Processing**: Chunked processing (5000 rows/chunk)
- **Queue**: Redis BLPOP for job consumption

#### Database (PostgreSQL + PostGIS)
- **Version**: PostgreSQL 15 with PostGIS 3.3
- **Purpose**: Store branches, jobs, customer mappings, configuration
- **Features**: Spatial indexing, CASCADE deletes, timestamps

#### Cache/Queue (Redis)
- **Version**: Redis 7 Alpine
- **Purpose**: Job queue management, session storage
- **Queues**: `batch-process`, `branch-upload`, `python_batch_jobs`

---

## 3. Technology Stack

### Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| React | 18.x | UI framework |
| TypeScript | 5.x | Type safety |
| Vite | 5.x | Build tool |
| Material-UI | 5.x | Component library |
| Zustand | 4.x | State management |
| React Router | 6.x | Client-side routing |
| Axios | 1.x | HTTP client |

### Backend
| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | 18+ | Runtime |
| Express | 4.x | Web framework |
| PostgreSQL | 15.x | Primary database |
| PostGIS | 3.3 | Spatial extensions |
| Redis | 7.x | Queue & cache |
| Bull | 4.x | Job queue |
| Winston | 3.x | Logging |
| Multer | 1.x | File uploads |
| xlsx | 0.18.x | Excel processing |

### Python Worker
| Technology | Version | Purpose |
|------------|---------|---------|
| Python | 3.9+ | Runtime |
| pandas | 2.x | Data processing |
| numpy | 1.x | Numerical operations |
| SQLAlchemy | 2.x | Database ORM |
| openpyxl | 3.x | Excel reading |
| redis-py | 5.x | Redis client |

### DevOps
| Technology | Version | Purpose |
|------------|---------|---------|
| Docker | 20+ | Containerization |
| Docker Compose | 2.x | Multi-container orchestration |
| Git | 2.x | Version control |

---

## 4. Installation & Setup

### Prerequisites
- Node.js 18+ and npm
- Python 3.9+
- Docker Desktop (for Windows)
- Git

### Quick Start

1. **Clone Repository**

```bash
git clone <repository-url>
cd Territory
```

2. **Install Dependencies**
```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install

# Python Worker
cd ../backend-worker
pip install -r requirements.txt
```

3. **Configure Environment**
```bash
# Backend
cd backend
copy .env.example .env
# Edit .env with your settings

# Frontend
cd ../frontend
copy .env.example .env
# Edit .env with your settings
```

4. **Start Services**
```bash
# From project root
start-all.bat
```

This will start:
- PostgreSQL (port 5434)
- Redis (port 6379)
- Backend API (port 3000)
- Python Worker
- Frontend (port 5173)

5. **Access Application**
- Frontend: http://localhost:5173
- Backend API: http://localhost:3000
- API Health: http://localhost:3000/api/v1/health

### Manual Setup (Alternative)

**Start Docker Services**
```bash
docker-compose up -d
```

**Start Backend**
```bash
cd backend
npm start
```

**Start Python Worker**
```bash
cd backend-worker
python worker.py
```

**Start Frontend**
```bash
cd frontend
npm run dev
```

### Stop Services
```bash
stop-all.bat
```

---

## 5. Core Features

### 5.1 Dashboard
**Purpose**: System overview and quick access to all modules

**Features**:
- System status indicators
- Quick navigation cards
- Recent activity summary

**Access**: Home page (/)

---

### 5.2 Configuration Module
**Purpose**: Manage core system parameters

**Features**:

- **Origin Point**: Set latitude/longitude for grid origin
- **Alphabet**: 30-character encoding alphabet for Pocket IDs
- **Grid Levels**: 5 distance tiers (500km, 100km, 20km, 5km, 1km)

**Access**: Admin → Configuration

**API Endpoints**:
- `GET /api/v1/config` - Get current configuration
- `PUT /api/v1/config` - Update configuration

**Important**: Changes to configuration affect all pocket calculations. Use with caution.

---

### 5.3 Calculator Module
**Purpose**: Convert between coordinates and Pocket IDs

**Features**:
- **Encode**: Latitude/Longitude → Pocket ID
- **Decode**: Pocket ID → Coordinates + Boundaries

**Access**: Admin → Calculator

**API Endpoints**:
- `POST /api/v1/encode` - Encode coordinates to Pocket ID
- `POST /api/v1/decode` - Decode Pocket ID to coordinates

**Use Cases**:
- Test pocket encoding logic
- Verify pocket boundaries
- Debug customer assignments

---

### 5.4 Branches Module
**Purpose**: Manage physical branch locations

**Features**:
- View all branches with pagination
- Add single branch manually
- Bulk upload via Excel
- Automatic Pocket ID calculation
- Edit/Delete branches

**Access**: Branches

**Excel Format**:
```
| Branch ID | City      | Latitude  | Longitude  |
|-----------|-----------|-----------|------------|
| BR001     | New York  | 40.7128   | -74.0060   |
| BR002     | Chicago   | 41.8781   | -87.6298   |
```

**API Endpoints**:
- `GET /api/v1/branches` - List branches (paginated)
- `POST /api/v1/branches` - Create single branch
- `POST /api/v1/branches/upload` - Bulk upload
- `PUT /api/v1/branches/:id` - Update branch
- `DELETE /api/v1/branches/:id` - Delete branch

**Background Processing**: Large uploads use Bull queue for async processing

---

### 5.5 Batch Processing Module
**Purpose**: Assign customers to pockets and branches in bulk

**Features**:

- Upload customer Excel files
- Automatic pocket assignment (nearest pocket center)
- Automatic branch assignment (nearest branch to pocket)
- Distance calculations (customer→pocket, pocket→branch, customer→branch)
- Real-time progress tracking
- Job history with status
- Download results as Excel

**Hybrid Worker System**:
- **Small files** (< 5000 rows): Node.js worker (fast, in-memory)
- **Large files** (≥ 5000 rows): Python worker (memory-efficient, 3-4x faster)

**Excel Input Format**:
```
| LAN       | CANON_LAT | CANON_LONG | ... (other columns) |
|-----------|-----------|------------|---------------------|
| CUST001   | 40.7589   | -73.9851   | ...                 |
| CUST002   | 34.0522   | -118.2437  | ...                 |
```

**Excel Output Format**:
```
Sheet 1: Results
| LAN     | CANON_LAT | CANON_LONG | PocketID      | Distance to Pocket Center (m) | ... |
|---------|-----------|------------|---------------|-------------------------------|-----|
| CUST001 | 40.7589   | -73.9851   | AA-BB-CC-DD-EE| 234                           | ... |

Sheet 2: Statistics
| Pocket ID      | Account Count |
|----------------|---------------|
| AA-BB-CC-DD-EE | 150           |
| FF-GG-HH-II-JJ | 120           |
```

**API Endpoints**:
- `POST /api/v1/batch/encode` - Upload file for processing
- `GET /api/v1/batch/status/:jobId` - Check job status
- `GET /api/v1/batch/download/:jobId` - Download results
- `GET /api/v1/jobs` - List all jobs

**Access**: Batch Processing

**Performance**:
- Small files (< 5000 rows): ~100-200 rows/second
- Large files (≥ 5000 rows): ~300-500 rows/second (Python)
- Memory usage: 87% less for large files with Python worker

---

### 5.6 Customer Mapping View
**Purpose**: View and analyze customer-pocket-branch relationships

**Features**:
- View all customer mappings with pagination
- Filter by customer ID, pocket ID, or branch ID
- Real-time search with debouncing
- Statistics cards (total customers, unique pockets, unique branches, avg distance)
- Sort by any column
- Delete individual mappings
- Bulk delete by job

**Access**: Customer Mappings

**API Endpoints**:
- `GET /api/v1/customer-mappings` - List mappings (paginated, filtered)
- `POST /api/v1/customer-mappings` - Create mapping
- `DELETE /api/v1/customer-mappings/:id` - Delete mapping
- `DELETE /api/v1/customer-mappings/job/:jobId` - Delete all mappings from job

**Statistics Displayed**:

- Total Customers
- Unique Pockets
- Unique Branches
- Average Distance (customer to pocket)

---

## 6. API Documentation

### Base URL
```
http://localhost:3000/api/v1
```

### Authentication
Currently no authentication required (add JWT/OAuth as needed)

### Common Response Format
```json
{
  "success": true,
  "data": { ... },
  "message": "Operation successful"
}
```

### Error Response Format
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message"
  }
}
```

### API Endpoints

#### Configuration
**GET /api/v1/config**
- Description: Get current system configuration
- Response:
```json
{
  "id": 1,
  "originLat": 0,
  "originLon": 0,
  "alphabet": "ABCDEFGHJKLMNPQRSTUVWXYZ2345",
  "gridLevels": [500000, 100000, 20000, 5000, 1000]
}
```

**PUT /api/v1/config**
- Description: Update system configuration
- Body:
```json
{
  "originLat": 40.7128,
  "originLon": -74.0060,
  "alphabet": "ABCDEFGHJKLMNPQRSTUVWXYZ2345"
}
```

#### Encoding/Decoding
**POST /api/v1/encode**
- Description: Convert coordinates to Pocket ID
- Body:
```json
{
  "latitude": 40.7589,
  "longitude": -73.9851
}
```
- Response:
```json
{
  "pocketId": "AA-BB-CC-DD-EE",
  "latitude": 40.7589,
  "longitude": -73.9851
}
```

**POST /api/v1/decode**
- Description: Convert Pocket ID to coordinates
- Body:
```json
{
  "pocketId": "AA-BB-CC-DD-EE"
}
```
- Response:
```json
{
  "pocketId": "AA-BB-CC-DD-EE",
  "centerLat": 40.7589,
  "centerLon": -73.9851,
  "boundaries": {
    "north": 40.7639,
    "south": 40.7539,
    "east": -73.9801,
    "west": -73.9901
  }
}
```

#### Branches
**GET /api/v1/branches**
- Description: List branches with pagination
- Query Parameters:
  - `page` (default: 1)
  - `limit` (default: 100, max: 1000)
- Response:

```json
{
  "branches": [
    {
      "id": "BR001",
      "city": "New York",
      "lat": 40.7128,
      "lon": -74.0060,
      "pocketId": "AA-BB-CC-DD-EE",
      "createdAt": "2026-02-28T00:00:00Z",
      "updatedAt": "2026-02-28T00:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 100,
    "total": 188,
    "totalPages": 2
  }
}
```

**POST /api/v1/branches**
- Description: Create single branch
- Body:
```json
{
  "id": "BR001",
  "city": "New York",
  "lat": 40.7128,
  "lon": -74.0060
}
```

**POST /api/v1/branches/upload**
- Description: Bulk upload branches via Excel
- Content-Type: multipart/form-data
- Body: file (Excel file)
- Response:
```json
{
  "message": "Branches uploaded successfully",
  "inserted": 188,
  "skipped": 0,
  "errors": 14,
  "total": 202
}
```

**DELETE /api/v1/branches/:id**
- Description: Delete branch by ID
- Response:
```json
{
  "message": "Branch deleted successfully"
}
```

#### Batch Processing
**POST /api/v1/batch/encode**
- Description: Upload customer file for batch processing
- Content-Type: multipart/form-data
- Body: file (Excel file)
- Response:
```json
{
  "message": "File uploaded successfully. Processing in background.",
  "jobId": "a1518b29-7cd8-4e61-a9a6-5e27967be0bf",
  "fileName": "customers.xlsx",
  "total": 17137,
  "worker": "python",
  "statusUrl": "/api/v1/batch/status/a1518b29-7cd8-4e61-a9a6-5e27967be0bf"
}
```

**GET /api/v1/batch/status/:jobId**
- Description: Check job processing status
- Response:
```json
{
  "jobId": "a1518b29-7cd8-4e61-a9a6-5e27967be0bf",
  "type": "batch_encode",
  "status": "active",
  "progress": 45,
  "total": 17137,
  "resultUrl": null,
  "error": null,
  "createdAt": "2026-02-28T08:10:16Z",
  "updatedAt": "2026-02-28T08:12:30Z",
  "completedAt": null
}
```

Status values: `pending`, `active`, `completed`, `failed`

**GET /api/v1/batch/download/:jobId**
- Description: Download processed results
- Response: Excel file (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet)

**GET /api/v1/jobs**
- Description: List all jobs
- Query Parameters:
  - `limit` (default: 20)
- Response:

```json
{
  "jobs": [
    {
      "id": 10,
      "jobId": "a1518b29-7cd8-4e61-a9a6-5e27967be0bf",
      "type": "batch_encode",
      "status": "completed",
      "progress": 100,
      "total": 17137,
      "resultUrl": "/api/v1/batch/download/a1518b29-7cd8-4e61-a9a6-5e27967be0bf",
      "error": null,
      "createdAt": "2026-02-28T08:10:16Z",
      "completedAt": "2026-02-28T08:15:42Z"
    }
  ]
}
```

#### Customer Mappings
**GET /api/v1/customer-mappings**
- Description: List customer mappings with filters
- Query Parameters:
  - `page` (default: 1)
  - `limit` (default: 100, max: 1000)
  - `search` (filter by customer ID, pocket ID, or branch ID)
- Response:
```json
{
  "mappings": [
    {
      "id": 1,
      "jobId": 10,
      "customerId": "CUST001",
      "customerLat": 40.7589,
      "customerLon": -73.9851,
      "pocketId": "AA-BB-CC-DD-EE",
      "distanceCustomerToPocket": 234.5,
      "nearestBranchId": "BR001",
      "distancePocketToBranch": 1500.2,
      "distanceCustomerToBranch": 1650.8,
      "createdAt": "2026-02-28T08:15:42Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 100,
    "total": 17137,
    "totalPages": 172
  },
  "statistics": {
    "totalCustomers": 17137,
    "uniquePockets": 10312,
    "uniqueBranches": 188,
    "avgDistance": 456.7
  }
}
```

**POST /api/v1/customer-mappings**
- Description: Create single customer mapping
- Body:
```json
{
  "customerId": "CUST001",
  "customerLat": 40.7589,
  "customerLon": -73.9851,
  "pocketId": "AA-BB-CC-DD-EE",
  "nearestBranchId": "BR001"
}
```

**DELETE /api/v1/customer-mappings/:id**
- Description: Delete single mapping
- Response:
```json
{
  "message": "Mapping deleted successfully"
}
```

**DELETE /api/v1/customer-mappings/job/:jobId**
- Description: Delete all mappings from a specific job
- Response:
```json
{
  "message": "All mappings from job deleted successfully",
  "deletedCount": 17137
}
```

---

## 7. Database Schema

### Tables

#### config
Stores system configuration parameters
```sql
CREATE TABLE config (
  id SERIAL PRIMARY KEY,
  origin_lat DOUBLE PRECISION NOT NULL DEFAULT 0,
  origin_lon DOUBLE PRECISION NOT NULL DEFAULT 0,
  alphabet VARCHAR(30) NOT NULL DEFAULT 'ABCDEFGHJKLMNPQRSTUVWXYZ2345',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### branches

Stores physical branch locations
```sql
CREATE TABLE branches (
  id VARCHAR(50) PRIMARY KEY,
  city VARCHAR(100) NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  pocket_id VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_branches_pocket_id ON branches(pocket_id);
CREATE INDEX idx_branches_lat_lon ON branches(lat, lon);
```

#### jobs
Tracks batch processing jobs
```sql
CREATE TABLE jobs (
  id SERIAL PRIMARY KEY,
  job_id VARCHAR(255) UNIQUE NOT NULL,
  type VARCHAR(50) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  total INTEGER,
  result_url TEXT,
  error TEXT,
  data JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE INDEX idx_jobs_job_id ON jobs(job_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC);
```

#### customer_pocket_mappings
Stores customer-to-pocket-to-branch relationships
```sql
CREATE TABLE customer_pocket_mappings (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  customer_id VARCHAR(100) NOT NULL,
  customer_lat DOUBLE PRECISION NOT NULL,
  customer_lon DOUBLE PRECISION NOT NULL,
  pocket_id VARCHAR(50) NOT NULL,
  distance_customer_to_pocket DOUBLE PRECISION,
  nearest_branch_id VARCHAR(50) REFERENCES branches(id) ON DELETE CASCADE,
  distance_pocket_to_branch DOUBLE PRECISION,
  distance_customer_to_branch DOUBLE PRECISION,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_mappings_customer_id ON customer_pocket_mappings(customer_id);
CREATE INDEX idx_mappings_pocket_id ON customer_pocket_mappings(pocket_id);
CREATE INDEX idx_mappings_branch_id ON customer_pocket_mappings(nearest_branch_id);
CREATE INDEX idx_mappings_job_id ON customer_pocket_mappings(job_id);
```

### Relationships
- `customer_pocket_mappings.job_id` → `jobs.id` (CASCADE DELETE)
- `customer_pocket_mappings.nearest_branch_id` → `branches.id` (CASCADE DELETE)

### Cascade Behavior
- Deleting a job deletes all associated customer mappings
- Deleting a branch deletes all customer mappings referencing that branch

---

## 8. Configuration

### Environment Variables

#### Backend (.env)
```env
# Server
NODE_ENV=development
PORT=3000

# Database
DB_HOST=localhost
DB_PORT=5434
DB_NAME=location_pockets
DB_USER=postgres
DB_PASSWORD=postgres

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_URL=redis://localhost:6379

# CORS
CORS_ORIGIN=http://localhost:5173

# File Upload
MAX_FILE_SIZE_MB=50
UPLOAD_DIR=./uploads

# Batch Processing - Hybrid Worker
PYTHON_WORKER_THRESHOLD=5000
```

#### Frontend (.env)

```env
VITE_API_BASE_URL=http://localhost:3000/api/v1
```

#### Python Worker
Uses environment variables from backend or defaults:
- `REDIS_URL`: Redis connection string (default: redis://127.0.0.1:6379)
- `DATABASE_URL`: PostgreSQL connection string (default: postgresql://postgres:postgres@localhost:5434/pockets)
- `UPLOAD_DIR`: Upload directory path (default: ../backend/uploads)

### Docker Compose Configuration
```yaml
version: '3.8'

services:
  postgres:
    image: postgis/postgis:15-3.3
    container_name: location-pockets-db
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: location_pockets
    ports:
      - "5434:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: location-pockets-redis
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

### Grid Configuration
The hierarchical grid system uses 5 levels:
```javascript
const GRID_LEVELS = [
  500000,  // Level 0: 500 km
  100000,  // Level 1: 100 km
  20000,   // Level 2: 20 km
  5000,    // Level 3: 5 km
  1000     // Level 4: 1 km (finest)
];
```

### Alphabet Configuration
30-character alphabet for Pocket ID encoding (excludes ambiguous characters):
```
ABCDEFGHJKLMNPQRSTUVWXYZ2345
```
Excluded: I, O, 0, 1, 6, 7, 8, 9 (to avoid confusion)

---

## 9. Deployment

### Development Deployment
Use the provided batch files:
```bash
start-all.bat  # Start all services
stop-all.bat   # Stop all services
```

### Production Deployment

#### Option 1: Docker Compose (Recommended)
1. Update environment variables for production
2. Build production images:
```bash
docker-compose -f docker-compose.prod.yml build
```
3. Start services:
```bash
docker-compose -f docker-compose.prod.yml up -d
```

#### Option 2: Manual Deployment

**Backend**:
```bash
cd backend
npm run build
npm start
```

**Frontend**:
```bash
cd frontend
npm run build
# Serve dist/ folder with nginx or similar
```

**Python Worker**:
```bash
cd backend-worker
python worker.py
```

### Environment-Specific Configuration

**Production Checklist**:
- [ ] Set `NODE_ENV=production`
- [ ] Use strong database passwords
- [ ] Enable HTTPS/SSL
- [ ] Configure CORS for production domain
- [ ] Set up monitoring and logging
- [ ] Configure backup strategy
- [ ] Set up Redis persistence
- [ ] Configure rate limiting
- [ ] Enable authentication/authorization
- [ ] Set up CDN for frontend assets

### Scaling Considerations

**Horizontal Scaling**:

- Backend API: Run multiple instances behind load balancer
- Python Workers: Run multiple worker processes
- Redis: Use Redis Cluster for high availability
- PostgreSQL: Use read replicas for read-heavy workloads

**Performance Tuning**:
- Adjust `PYTHON_WORKER_THRESHOLD` based on server capacity
- Increase Bull queue concurrency for parallel processing
- Optimize database indexes for query patterns
- Enable PostgreSQL connection pooling
- Use Redis for session caching

---

## 10. Troubleshooting

### Common Issues

#### Issue: Backend won't start
**Symptoms**: Error connecting to database or Redis

**Solutions**:
1. Check Docker containers are running:
```bash
docker ps
```
2. Verify PostgreSQL is ready:
```bash
docker exec location-pockets-db pg_isready -U postgres
```
3. Check Redis connection:
```bash
docker exec location-pockets-redis redis-cli ping
```
4. Review backend logs:
```bash
cd backend
type logs\app.log
```

#### Issue: Python worker not processing jobs
**Symptoms**: Jobs stuck in "pending" status

**Solutions**:
1. Check Python worker is running
2. Verify Redis connection:
```bash
docker exec location-pockets-redis redis-cli LLEN python_batch_jobs
```
3. Check worker logs for errors
4. Restart Python worker:
```bash
cd backend-worker
python worker.py
```

#### Issue: File upload timeout
**Symptoms**: "timeout of 120000ms exceeded"

**Solutions**:
1. Check file size (max 50MB by default)
2. Increase timeout in frontend:
```typescript
// frontend/src/services/api.ts
timeout: 180000  // 3 minutes
```
3. Check backend is processing the file
4. Review backend logs for errors

#### Issue: Database parameter mismatch
**Symptoms**: "bind message supplies X parameters, but prepared statement requires Y"

**Solutions**:
1. This was a bug in MappingService.js (fixed)
2. Verify fix at line 275: `baseIndex = index * 9` (not 8)
3. Restart backend after fix

#### Issue: No branches found
**Symptoms**: "No branches found in database" error during batch processing

**Solutions**:
1. Upload branches first via Branches module
2. Verify branches exist:
```sql
SELECT COUNT(*) FROM branches;
```
3. Check branch upload logs for errors

#### Issue: Frontend shows "0-0 of 0"
**Symptoms**: Empty data tables

**Solutions**:
1. Check API response format (camelCase vs snake_case)
2. Verify backend is running and accessible
3. Check browser console for errors
4. Verify database has data

### Logging

**Backend Logs**:
- Location: `backend/logs/app.log` and `backend/logs/error.log`
- Format: JSON structured logging
- Levels: error, warn, info, debug

**Python Worker Logs**:
- Location: Console output
- Format: Emoji-prefixed messages
- Redirect to file:
```bash
python worker.py > worker.log 2>&1
```

**Frontend Logs**:
- Location: Browser console
- Use React DevTools for component debugging

### Database Maintenance

**Backup Database**:
```bash
docker exec location-pockets-db pg_dump -U postgres location_pockets > backup.sql
```

**Restore Database**:
```bash
docker exec -i location-pockets-db psql -U postgres location_pockets < backup.sql
```

**Clear Old Jobs**:
```sql
DELETE FROM jobs WHERE created_at < NOW() - INTERVAL '30 days';
```

**Vacuum Database**:
```sql
VACUUM ANALYZE;
```

### Performance Monitoring

**Check Queue Status**:
```bash
docker exec location-pockets-redis redis-cli INFO stats
```

**Check Database Connections**:
```sql
SELECT count(*) FROM pg_stat_activity;
```

**Monitor Job Processing**:
```sql
SELECT status, COUNT(*) 
FROM jobs 
GROUP BY status;
```

---

## Appendix A: Pocket ID Format

### Structure

Pocket IDs follow the format: `L0-L1-L2-L3-L4`

Each level consists of 2 characters (row, column) from the 30-character alphabet.

**Example**: `AA-BB-CC-DD-EE`
- `AA`: Level 0 (500km grid)
- `BB`: Level 1 (100km grid)
- `CC`: Level 2 (20km grid)
- `DD`: Level 3 (5km grid)
- `EE`: Level 4 (1km grid - finest)

### Encoding Algorithm
1. Convert lat/lon to meters from origin
2. For each grid level:
   - Calculate row and column indices
   - Encode indices using alphabet
   - Concatenate with hyphen separator

### Decoding Algorithm
1. Split Pocket ID by hyphen
2. For each level:
   - Decode characters to row/column indices
   - Calculate meter offsets
3. Calculate center coordinates
4. Convert meters back to lat/lon

---

## Appendix B: Distance Calculations

### Haversine Formula
Used for calculating great-circle distances between two points on Earth:

```javascript
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // Distance in meters
}
```

### Distance Types
1. **Customer to Pocket**: Distance from customer coordinates to pocket center
2. **Pocket to Branch**: Distance from pocket center to nearest branch
3. **Customer to Branch**: Direct distance from customer to assigned branch

---

## Appendix C: Testing

### Unit Tests
Located in `backend/tests/unit/`

**Run Tests**:
```bash
cd backend
npm test
```

**Test Coverage**:
```bash
npm run test:coverage
```

### Property-Based Tests
Uses fast-check library for property-based testing

**Example Test Files**:
- `batch.property.test.js`
- `MappingService.property.test.js`
- `BranchFinderService.property.test.js`
- `customerMappingsRoute.property.test.js`

**Run Property Tests**:
```bash
npm test -- --testPathPattern=property
```

### Integration Tests
Located in `backend/tests/integration/`

**Run Integration Tests**:
```bash
npm run test:integration
```

### Frontend Tests
Located in `frontend/src/`

**Run Frontend Tests**:
```bash
cd frontend
npm test
```

---

## Appendix D: API Rate Limits

Currently no rate limiting implemented. For production, consider:

**Recommended Limits**:
- Upload endpoints: 10 requests/minute per IP
- Query endpoints: 100 requests/minute per IP
- Download endpoints: 20 requests/minute per IP

**Implementation Options**:
- express-rate-limit middleware
- Redis-based rate limiting
- API Gateway (AWS, Azure, GCP)

---

## Appendix E: Security Considerations

### Current State
- No authentication/authorization
- No input sanitization beyond basic validation
- No SQL injection protection (using parameterized queries)
- CORS enabled for localhost only

### Production Recommendations
1. **Authentication**: Implement JWT or OAuth 2.0
2. **Authorization**: Role-based access control (RBAC)
3. **Input Validation**: Use Joi or Yup for schema validation
4. **SQL Injection**: Continue using parameterized queries
5. **XSS Protection**: Sanitize user inputs, use Content Security Policy
6. **CSRF Protection**: Implement CSRF tokens
7. **HTTPS**: Enforce SSL/TLS in production
8. **API Keys**: For programmatic access
9. **Audit Logging**: Track all data modifications
10. **File Upload Security**: Validate file types, scan for malware

---

## Appendix F: Support & Maintenance

### Monitoring Recommendations
- **Application**: New Relic, Datadog, or Application Insights
- **Infrastructure**: Prometheus + Grafana
- **Logs**: ELK Stack (Elasticsearch, Logstash, Kibana)
- **Uptime**: Pingdom, UptimeRobot

### Backup Strategy
- **Database**: Daily automated backups with 30-day retention
- **Files**: Backup upload directory regularly
- **Configuration**: Version control for all config files

### Update Procedures
1. Test updates in development environment
2. Run database migrations
3. Update dependencies
4. Run test suite
5. Deploy to staging
6. Deploy to production with rollback plan

---

## Contact & Support

For technical support or questions:
- Documentation: This file
- Issue Tracker: [GitHub Issues]
- Email: [support@example.com]

---

**Document Version**: 1.0  
**Last Updated**: February 28, 2026  
**Author**: Development Team
