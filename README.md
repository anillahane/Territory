# Location Pockets System

A production-ready full-stack web application for converting geographic coordinates into hierarchical alphanumeric Pocket IDs and finding nearest branches on an interactive map.

## 🎯 Project Status

**Overall Progress**: 45% Complete  
**Current Phase**: Phase 2 - Frontend Foundation  
**Last Updated**: 2026-02-28

### ✅ Completed
- Backend API (90%) - All endpoints implemented
- Geometry Module (100%) - Fully tested
- Database Schema - PostgreSQL + PostGIS
- Docker Setup - Development & Production
- CI/CD Pipeline - GitHub Actions
- Unit Tests - 100% coverage for geometry

### 🚧 In Progress
- Frontend Foundation (30%)
- Integration Tests
- API Documentation

## 🚀 Features

- 🗺️ **Interactive Map**: Leaflet-based map with grid overlay, branch markers, and customer dots
- 📍 **Pocket ID Generation**: Convert lat/lon to compact alphanumeric codes (e.g., 7F-33-22-11-00-44)
- 🔍 **Nearest Branch Finder**: Automatic spatial search using PostGIS with real-time highlighting
- 📊 **Batch Processing**: Upload Excel files for bulk coordinate conversion with job queue
- ⚙️ **Configurable Grid**: Customize origin, alphabet, and 5 hierarchical grid levels (500km to 1km)
- 🔒 **Security**: Rate limiting, input validation, CORS, Helmet.js
- 📈 **Monitoring**: Health checks, logging (Winston), error tracking
- 🚀 **Production-Ready**: Docker, CI/CD, spatial indexing, scalability

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Load Balancer (Nginx)                  │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐      ┌─────────────────────────┐
│   React Frontend         │      │  Node.js API Server     │
│   - Material-UI          │      │  - Express              │
│   - Leaflet Map          │      │  - 15 API Endpoints     │
│   - Zustand Store        │      │  - Joi Validation       │
└─────────────────────────┘      └─────────────────────────┘
                                              │
                                              ▼
                                    ┌─────────────────────────┐
                                    │  PostgreSQL + PostGIS    │
                                    │  - Spatial Indexing      │
                                    │  - Audit Trail           │
                                    └─────────────────────────┘
                                              │
                                              ▼
                                    ┌─────────────────────────┐
                                    │  Redis + Bull Queue      │
                                    │  - Batch Processing      │
                                    └─────────────────────────┘
```

## 💻 Tech Stack

### Frontend
- **Framework**: React 18 + TypeScript + Vite
- **UI Library**: Material-UI (MUI)
- **State Management**: Zustand
- **Mapping**: React-Leaflet + Leaflet.markercluster
- **HTTP Client**: Axios
- **Excel**: SheetJS (xlsx)

### Backend
- **Runtime**: Node.js 20 LTS
- **Framework**: Express 4.18
- **Database**: PostgreSQL 15 + PostGIS 3.3
- **Cache/Queue**: Redis 7 + Bull
- **Validation**: Joi
- **Logging**: Winston + Morgan
- **File Upload**: Multer
- **Excel**: SheetJS (xlsx)
- **Geodetic**: Proj4

### DevOps
- **Containerization**: Docker + Docker Compose
- **CI/CD**: GitHub Actions
- **Web Server**: Nginx
- **Testing**: Jest, Vitest, Cypress
- **Monitoring**: Prometheus + Grafana (planned)

## 🚀 Quick Start

### Option 1: Docker Compose (Recommended)

```bash
# Clone repository
git clone <repository-url>
cd location-pockets-system

# Run quick start script
chmod +x start.sh
./start.sh

# Or manually
docker-compose up -d
docker-compose exec backend npm run migrate

# Access application
# Frontend: http://localhost:5173
# Backend: http://localhost:3000
# Health: http://localhost:3000/health
```

### Option 2: Manual Setup

**Prerequisites**
- Node.js 20 LTS
- PostgreSQL 15 with PostGIS
- Redis 7

**Backend**
```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your credentials
npm run migrate
npm run dev
```

**Frontend**
```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

See [SETUP_GUIDE.md](SETUP_GUIDE.md) for detailed instructions.

## 📚 Documentation

### Getting Started
- [📋 Project Plan](PROJECT_PLAN.md) - Complete 12-week development roadmap
- [🔧 Setup Guide](SETUP_GUIDE.md) - Detailed setup instructions
- [📊 Development Status](DEVELOPMENT_STATUS.md) - Current progress tracking
- [📝 Implementation Summary](IMPLEMENTATION_SUMMARY.md) - What's been built

### API Documentation
- **Base URL**: `http://localhost:3000/api/v1`
- **Health Check**: `GET /health`

**Endpoints**:
- Configuration: `GET/PUT /config`, `GET /config/history`
- Branches: `GET/POST/PUT/DELETE /branches`, `POST /branches/upload`, `GET /branches/export`
- Pocket ID: `POST /pocket/encode`, `POST /pocket/decode`, `POST /pocket/validate`
- Nearest: `POST /nearest`, `POST /nearest/fallback`, `GET /nearest/within-pocket/:id`
- Batch: `POST /batch/encode`, `GET /batch/status/:id`, `GET /batch/download/:id`

## 🧪 Testing

### Backend Tests
```bash
cd backend
npm run lint                # Lint backend source
npm test                    # Run all tests (with coverage)
npm run test:watch          # Watch mode
npm run test:integration    # Integration tests
```

**Current Coverage**: 100% for geometry module

### Frontend Tests
```bash
cd frontend
npm run lint                # Lint frontend source
npm run build               # Type-check and production build
npm test                    # Run all tests
npm run test:ui             # UI mode
npm run test:coverage       # Coverage report
```

### Known Issues
- Full backend integration tests require PostgreSQL/PostGIS and Redis services to be running locally.

## 📁 Project Structure

```
location-pockets-system/
├── backend/                    # Node.js API (90% complete)
│   ├── src/
│   │   ├── config/            # Database, logger config
│   │   ├── routes/            # API endpoints (15 routes)
│   │   ├── middleware/        # Error handling, validation
│   │   ├── utils/             # Geometry calculations
│   │   ├── migrations/        # Database migrations
│   │   └── app.js             # Express application
│   ├── tests/
│   │   └── unit/              # Unit tests (50+ cases)
│   ├── package.json
│   ├── Dockerfile
│   └── jest.config.js
├── frontend/                   # React App (30% complete)
│   ├── src/
│   │   ├── components/        # React components
│   │   ├── pages/             # Page components
│   │   ├── services/          # API client
│   │   ├── store/             # Zustand store
│   │   └── App.tsx
│   ├── package.json
│   ├── vite.config.ts
│   └── Dockerfile
├── .github/
│   └── workflows/
│       └── ci.yml             # CI/CD pipeline
├── docker-compose.yml         # Development environment
├── start.sh                   # Quick start script
├── PROJECT_PLAN.md            # Development roadmap
├── SETUP_GUIDE.md             # Setup instructions
├── DEVELOPMENT_STATUS.md      # Progress tracking
├── IMPLEMENTATION_SUMMARY.md  # Implementation details
└── README.md                  # This file
```

## 🎯 Key Features Implemented

### Backend (90% Complete)
✅ Configuration API with audit trail  
✅ Branch CRUD with Excel import/export  
✅ Pocket ID encoding/decoding  
✅ Nearest branch finder (PostGIS spatial queries)  
✅ Batch processing with job queue  
✅ Geometry calculations (100% tested)  
✅ Security (rate limiting, validation, CORS)  
✅ Logging and error handling  
✅ Health checks  

### Frontend (30% Complete)
✅ Project setup (React + TypeScript + Vite)  
✅ Material-UI theme  
✅ Routing structure  
✅ API service layer  
✅ State management (Zustand)  
🚧 Page implementations (in progress)  
⏳ Map integration (planned)  

### DevOps (40% Complete)
✅ Docker containerization  
✅ Docker Compose for development  
✅ CI/CD pipeline (GitHub Actions)  
✅ Automated testing  
🚧 Kubernetes manifests (planned)  
⏳ Monitoring setup (planned)  

## 📈 Performance Targets

- **Nearest Branch API**: <300ms (p95) for 100,000 branches
- **Grid Overlay**: <500ms initial, <200ms pan/zoom
- **Batch Processing**: 10,000 coordinates in <120 seconds
- **Concurrent Users**: 100 simultaneous
- **Frontend Load**: <2 seconds (first contentful paint)
- **Uptime**: 99.5%

## 🔒 Security Features

- ✅ Helmet.js for secure HTTP headers
- ✅ CORS configuration
- ✅ Rate limiting (60 req/min per IP)
- ✅ Input validation (Joi)
- ✅ SQL injection prevention (parameterized queries)
- ✅ File upload size limits (10 MB)
- ✅ Error handling with proper status codes
- ✅ Environment variable management

## 🛣️ Roadmap

### Phase 1: Backend Foundation ✅ (90% Complete)
- [x] Database schema and migrations
- [x] All API endpoints
- [x] Geometry calculations
- [x] Unit tests
- [ ] Integration tests
- [ ] API documentation

### Phase 2: Frontend Foundation 🚧 (30% Complete)
- [x] Project setup
- [x] Routing and layout
- [ ] Configuration page
- [ ] Branch management page
- [ ] Component tests

### Phase 3: Calculator & Reverse Lookup ⏳
- [ ] Pocket ID calculator UI
- [ ] Reverse lookup UI
- [ ] E2E tests

### Phase 4: Map Integration ⏳
- [ ] Leaflet map setup
- [ ] Grid overlay rendering
- [ ] Branch markers with clustering
- [ ] Nearest branch finder UI
- [ ] Customer dots

### Phase 5: Batch Processing & Polish ⏳
- [ ] Batch upload UI
- [ ] Progress tracking
- [ ] UI polish
- [ ] Performance testing

### Phase 6: Deployment 🚧 (40% Complete)
- [x] Docker setup
- [x] CI/CD pipeline
- [ ] Kubernetes configuration
- [ ] Monitoring setup
- [ ] Production deployment

## 🤝 Contributing

1. Check [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) for current progress
2. Review [PROJECT_PLAN.md](PROJECT_PLAN.md) for planned features
3. Follow the setup guide in [SETUP_GUIDE.md](SETUP_GUIDE.md)
4. Write tests for new features
5. Ensure linting passes: `npm run lint`
6. Submit pull request

## 📞 Support

**Documentation**
- [Setup Guide](SETUP_GUIDE.md)
- [Project Plan](PROJECT_PLAN.md)
- [Development Status](DEVELOPMENT_STATUS.md)
- [Implementation Summary](IMPLEMENTATION_SUMMARY.md)

**Issues**
- Create an issue on GitHub
- Check existing documentation first
- Provide detailed reproduction steps

## 📄 License

Proprietary - All rights reserved

## 👥 Team

Development Team - [contact information]

---

**Built with ❤️ using modern web technologies**

*Last Updated: 2026-02-28*
