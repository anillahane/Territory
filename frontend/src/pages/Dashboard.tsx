import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Divider,
  Drawer,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  OutlinedInput,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';
import {
  Map,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type MapMouseEvent
} from 'maplibre-gl';
import booleanIntersects from '@turf/boolean-intersects';
import { polygon as turfPolygon } from '@turf/helpers';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreCspWorkerUrl from 'maplibre-gl/dist/maplibre-gl-csp-worker.js?url';
import { useNavigate } from 'react-router-dom';
import { type DashboardGridLevelId, useStore } from '../store/useStore';
import api from '../services/api';

const DEFAULT_BOUNDS = [63.0, 1.5, 102.5, 42.5] as [number, number, number, number];
const DEFAULT_CENTER = [78.9629, 20.5937] as [number, number];
const DEFAULT_ZOOM = 4.5;

const KM_GRID_LEVELS: Array<{
  id: DashboardGridLevelId;
  label: string;
  stepKm: number;
  minZoom: number;
  color: string;
  width: number;
  opacity: number;
}> = [
  { id: '500km', label: '500 km', stepKm: 500, minZoom: 0, color: '#93C5FD', width: 1.4, opacity: 0.5 },
  { id: '100km', label: '100 km', stepKm: 100, minZoom: 0, color: '#60A5FA', width: 1.1, opacity: 0.55 },
  { id: '20km', label: '20 km', stepKm: 20, minZoom: 0, color: '#38BDF8', width: 0.9, opacity: 0.6 },
  { id: '5km', label: '5 km', stepKm: 5, minZoom: 6, color: '#22D3EE', width: 1, opacity: 0.95 },
  { id: '1km', label: '1 km', stepKm: 1, minZoom: 6, color: '#06B6D4', width: 0.8, opacity: 0.9 }
];

const buildDefaultDashboardGridLevelColors = (): Record<DashboardGridLevelId, string> =>
  KM_GRID_LEVELS.reduce((accumulator, level) => ({
    ...accumulator,
    [level.id]: level.color
  }), {} as Record<DashboardGridLevelId, string>);

const normalizeDashboardGridLevelColors = (rawColors: unknown): Record<DashboardGridLevelId, string> => {
  const nextColors = buildDefaultDashboardGridLevelColors();
  if (!rawColors || typeof rawColors !== 'object' || Array.isArray(rawColors)) {
    return nextColors;
  }

  KM_GRID_LEVELS.forEach((level) => {
    const candidate = String((rawColors as Record<string, unknown>)[level.id] || '').trim();
    if (HEX_COLOR_REGEX.test(candidate)) {
      nextColors[level.id] = candidate.toUpperCase();
    }
  });

  return nextColors;
};

const extractDashboardGridLevelColors = (rawConfigPayload: unknown): unknown => {
  if (!rawConfigPayload || typeof rawConfigPayload !== 'object') {
    return null;
  }

  const configPayload = rawConfigPayload as Record<string, unknown>;
  if (configPayload.gridLevelColors && typeof configPayload.gridLevelColors === 'object') {
    return configPayload.gridLevelColors;
  }

  const rawGridLevels = configPayload.gridLevels as Record<string, unknown> | undefined;
  if (rawGridLevels && typeof rawGridLevels === 'object') {
    if (rawGridLevels.gridLevelColors && typeof rawGridLevels.gridLevelColors === 'object') {
      return rawGridLevels.gridLevelColors;
    }
    if (rawGridLevels.colors && typeof rawGridLevels.colors === 'object') {
      return rawGridLevels.colors;
    }
  }

  const rawGridLevelsSnake = configPayload.grid_levels as Record<string, unknown> | undefined;
  if (rawGridLevelsSnake && typeof rawGridLevelsSnake === 'object') {
    if (rawGridLevelsSnake.gridLevelColors && typeof rawGridLevelsSnake.gridLevelColors === 'object') {
      return rawGridLevelsSnake.gridLevelColors;
    }
    if (rawGridLevelsSnake.colors && typeof rawGridLevelsSnake.colors === 'object') {
      return rawGridLevelsSnake.colors;
    }
  }

  return null;
};

const resolveGridLayerOpacity = (levelId: DashboardGridLevelId, fallbackOpacity: number): number => {
  const strictOpacityByLevel: Record<DashboardGridLevelId, number> = {
    '500km': 0.5,
    '100km': 0.55,
    '20km': 0.6,
    '5km': 0.95,
    '1km': 0.9
  };
  return strictOpacityByLevel[levelId] ?? fallbackOpacity;
};

const GRID_SOURCE_PREFIX = 'dashboard-grid';
const GRID_LAYER_PREFIX = 'dashboard-grid-lines';
const OFFICIAL_INDIA_GEOJSON_URL = '/data/indiaStateBounds_official.geojson';
const STATE_BORDERS_SOURCE_ID = 'official-state-borders';
const STATE_BORDERS_LAYER_ID = 'state-borders';
const STATE_BORDERS_GEOJSON_URL = '/data/stateBorders_official.geojson';
const BRANCH_MARKERS_SOURCE_ID = 'branch-markers';
const BRANCH_MARKERS_LAYER_ID = 'branch-markers-layer';
const TERRITORY_SOURCE_ID = 'territory-polygons';
const TERRITORY_FILL_LAYER_ID = 'territory-polygons-fill';
const TERRITORY_LINE_LAYER_ID = 'territory-polygons-line';
const TERRITORY_POINTS_SOURCE_ID = 'territory-points';
const TERRITORY_POINTS_LAYER_ID = 'territory-points-layer';
const TERRITORY_CUSTOMERS_SOURCE_ID = 'territory-customers';
const TERRITORY_CUSTOMERS_LAYER_ID = 'territory-customers-layer';
const TERRITORY_SELECTED_BRANCHES_SOURCE_ID = 'territory-selected-branches';
const TERRITORY_SELECTED_BRANCHES_LAYER_ID = 'territory-selected-branches-layer';
const GRID1_SOURCE_ID = 'grid1-assigned-pockets';
const GRID1_FILL_LAYER_ID = 'grid1-fill';
const GRID1_LINE_LAYER_ID = 'grid1-line';
const GRID1_HIGHLIGHT_LAYER_ID = 'grid1-highlight';
const GRID1_SELECTED_SOURCE_ID = 'grid1-selected-pockets';
const GRID1_SELECTED_FILL_LAYER_ID = 'grid1-selected-fill';
const GRID1_SELECTED_LINE_LAYER_ID = 'grid1-selected-line';
const GRID1_SELECTION_PREVIEW_SOURCE_ID = 'grid1-selection-preview';
const GRID1_SELECTION_PREVIEW_FILL_LAYER_ID = 'grid1-selection-preview-fill';
const GRID1_SELECTION_PREVIEW_LINE_LAYER_ID = 'grid1-selection-preview-line';
const GRID1_FALLBACK_COLOR = '#E2E8F0';
const DEFAULT_EMPLOYEE_COLOR_PALETTE = [
  '#D50711',
  '#10B981',
  '#8B4513',
  '#B8860B',
  '#000000',
  '#FFFFFF',
  '#2563EB',
  '#059669',
  '#D97706',
  '#DC2626',
  '#7C3AED',
  '#0D9488'
];
const DEFAULT_ASSIGNMENT_TOLERANCE = 0.10;
const DEFAULT_EMPLOYEE_MAX_CAPACITY = 120;
const MAX_TERRITORY_BRANCHES = 1;
const TERRITORY_MODE_OPTIONS = [
  { value: 'existing_customers', label: 'Existing Customer Mapped' },
  { value: 'nearest_pockets', label: 'Branches -> Nearest Pockets' },
  { value: 'customer_availability', label: 'Branches -> Customer Availability' }
] as const;
const TERRITORY_CUSTOMER_VIEW_OPTIONS = [
  { value: 'selected_pockets', label: 'Customers From Selected Pockets' },
  { value: 'original_customers', label: 'Original Customers' }
] as const;
const ALLOCATION_LEVEL_OPTIONS = [
  { value: 5000, label: '5 km' },
  { value: 1000, label: '1 km' }
] as const;

type TerritoryMode = typeof TERRITORY_MODE_OPTIONS[number]['value'];
type TerritoryCustomerView = typeof TERRITORY_CUSTOMER_VIEW_OPTIONS[number]['value'];

type TerritoryBranchOption = {
  id: string;
  city: string;
  customerCount: number;
};

type TerritorySummary = {
  territories: number;
  branches: number;
  points: number;
  customers: number;
  customersVisible: number;
  selectedPocketCustomersVisible?: number;
  originalCustomersVisible?: number;
  sourceType: string;
};

type TerritoryVisualizationResponse = {
  mode: TerritoryMode;
  modeLabel: string;
  customerView?: TerritoryCustomerView;
  selectedBranchIds: string[];
  maxSelectableBranches: number;
  availableBranches: TerritoryBranchOption[];
  summary: TerritorySummary;
  territories: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
  branches: GeoJSON.FeatureCollection<GeoJSON.Point>;
  points: GeoJSON.FeatureCollection<GeoJSON.Point>;
  customers: GeoJSON.FeatureCollection<GeoJSON.Point>;
};

type EmployeeTerritoryAssignmentResponse = {
  branchId: string;
  tolerance: number;
  requestedSource?: string;
  resolvedSource?: string;
  fallbackApplied?: boolean;
  fallbackReason?: string | null;
  repairRecommended?: boolean;
  geometryAlignment?: {
    assignmentLevelMeters?: number;
  };
  summary: {
    totalPockets: number;
    assignedEmployees: number;
    totalAccounts: number;
    mergedTerritories: number;
  };
  territories: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
  pockets: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
};

type SelectionMode = 'box' | 'lasso';

type GridPocketProperties = {
  branch_id?: string;
  grid_cell_id?: string;
  pocket_id?: string;
  level_m?: number;
  employee_id?: string | null;
  account_count?: number;
  customer_count?: number;
  selected_branch_customer_count?: number;
  other_branch_customer_count?: number;
  color?: string;
  [key: string]: unknown;
};

type GridPocketFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, GridPocketProperties>;
type GridPocketCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, GridPocketProperties>;

type EmployeeMetric = {
  employeeId: string;
  accountTotal: number;
  pocketCount: number;
  nonEmptyPocketCount: number;
  targetAccounts: number;
  lowerLimit: number;
  upperLimit: number;
  status: 'within' | 'under' | 'over';
};

type BranchEmployee = {
  id: string;
  branchId: string;
  name: string;
  employeeCode: string;
  colorCode: string;
  maxCapacity: number | null;
  isActive: boolean;
  allocatedPocketsCount: number;
  allocatedCustomerCount: number;
};

type BranchEmployeeFormState = {
  id: string;
  employeeCode: string;
  name: string;
  colorCode: string;
  maxCapacity: string;
  isActive: boolean;
};

type PocketAllocationRow = {
  pocketId: string;
  totalCustomers: number;
  employeeId: string;
  color: string;
};

const EMPTY_GRID_FEATURE_COLLECTION = {
  type: 'FeatureCollection',
  features: []
} as GeoJSON.FeatureCollection<GeoJSON.LineString>;
const EMPTY_BRANCH_FEATURE_COLLECTION = {
  type: 'FeatureCollection',
  features: []
} as GeoJSON.FeatureCollection<GeoJSON.Point>;
const EMPTY_TERRITORY_FEATURE_COLLECTION = {
  type: 'FeatureCollection',
  features: []
} as GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
const EMPTY_TERRITORY_POINT_FEATURE_COLLECTION = {
  type: 'FeatureCollection',
  features: []
} as GeoJSON.FeatureCollection<GeoJSON.Point>;
const EMPTY_GRID_POCKET_FEATURE_COLLECTION = {
  type: 'FeatureCollection',
  features: []
} as GridPocketCollection;
const EMPTY_SELECTION_PREVIEW_FEATURE_COLLECTION = {
  type: 'FeatureCollection',
  features: []
} as GeoJSON.FeatureCollection<GeoJSON.Polygon>;

// Use explicit CSP worker file so runtime worker code does not depend on
// helper symbols injected by the bundler.
setWorkerUrl(maplibreCspWorkerUrl);

const getGridSourceId = (id: DashboardGridLevelId) => `${GRID_SOURCE_PREFIX}-${id}`;
const getGridLayerId = (id: DashboardGridLevelId) => `${GRID_LAYER_PREFIX}-${id}`;

const stringifyDiagnosticValue = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Error) {
    return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const buildViewportSnapshot = (mapInstance: Map): string => {
  const center = mapInstance.getCenter();
  const bounds = mapInstance.getBounds();

  return [
    `zoom=${mapInstance.getZoom().toFixed(2)}`,
    `center=${center.lat.toFixed(4)}deg,${center.lng.toFixed(4)}deg`,
    `bounds=[${bounds.getSouth().toFixed(4)},${bounds.getWest().toFixed(4)}]-[${bounds.getNorth().toFixed(4)},${bounds.getEast().toFixed(4)}]`
  ].join(' | ');
};

const buildMapStatusMessage = (
  summary: string,
  mapInstance: Map | null,
  details?: Record<string, unknown>,
  error?: unknown
): string => {
  const lines: string[] = [summary];

  if (mapInstance) {
    lines.push(`viewport: ${buildViewportSnapshot(mapInstance)}`);
  }

  if (details) {
    Object.entries(details).forEach(([key, value]) => {
      if (value !== undefined) {
        lines.push(`${key}: ${stringifyDiagnosticValue(value)}`);
      }
    });
  }

  if (error !== undefined) {
    lines.push(`error: ${stringifyDiagnosticValue(error)}`);
  }

  return lines.join('\n');
};

const buildGridOverlayLabel = (selectedGridLevels: DashboardGridLevelId[], zoom: number): string => {
  if (selectedGridLevels.length === 0) return 'None selected';

  const visibleGridLabels = KM_GRID_LEVELS
    .filter((level) => selectedGridLevels.includes(level.id) && zoom >= level.minZoom)
    .map((level) => level.label);

  if (visibleGridLabels.length > 0) {
    return visibleGridLabels.join(', ');
  }

  const hasOnlyZoomRestrictedLevels = selectedGridLevels.every((id) => {
    const levelConfig = KM_GRID_LEVELS.find((level) => level.id === id);
    return Boolean(levelConfig && zoom < levelConfig.minZoom);
  });

  return hasOnlyZoomRestrictedLevels ? 'Selected grids visible from zoom 6+' : 'None visible';
};

const buildGridGeoJsonKm = (
  bounds: [number, number, number, number],
  stepKm: number
): GeoJSON.FeatureCollection<GeoJSON.LineString> => {
  const [rawWest, rawSouth, rawEast, rawNorth] = bounds;
  if (![rawWest, rawSouth, rawEast, rawNorth, stepKm].every((value) => Number.isFinite(value))) {
    return EMPTY_GRID_FEATURE_COLLECTION;
  }

  const west = Math.max(-180, Math.min(180, Math.min(rawWest, rawEast)));
  const east = Math.max(-180, Math.min(180, Math.max(rawWest, rawEast)));
  const south = Math.max(-90, Math.min(90, Math.min(rawSouth, rawNorth)));
  const north = Math.max(-90, Math.min(90, Math.max(rawSouth, rawNorth)));
  if (west >= east || south >= north || stepKm <= 0) {
    return EMPTY_GRID_FEATURE_COLLECTION;
  }

  const stepMeters = stepKm * 1000;
  const latStepDeg = stepMeters / 111000;
  const meanLatRad = ((south + north) / 2) * (Math.PI / 180);
  const lonMetersPerDeg = Math.max(1, 111000 * Math.cos(meanLatRad));
  const lonStepDeg = stepMeters / lonMetersPerDeg;
  if (!Number.isFinite(latStepDeg) || !Number.isFinite(lonStepDeg) || latStepDeg <= 0 || lonStepDeg <= 0) {
    return EMPTY_GRID_FEATURE_COLLECTION;
  }

  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  const maxLineCount = 2500;
  const epsilon = 1e-9;
  const roundCoordinate = (value: number) => Number(value.toFixed(6));

  const startLat = Math.floor(south / latStepDeg) * latStepDeg;
  for (let lat = startLat; lat <= north + epsilon; lat += latStepDeg) {
    if (features.length >= maxLineCount) break;
    const clippedLat = Math.max(-90, Math.min(90, lat));
    features.push({
      type: 'Feature',
      properties: { step_km: stepKm },
      geometry: {
        type: 'LineString',
        coordinates: [
          [roundCoordinate(west), roundCoordinate(clippedLat)],
          [roundCoordinate(east), roundCoordinate(clippedLat)]
        ]
      }
    });
  }

  const startLon = Math.floor(west / lonStepDeg) * lonStepDeg;
  for (let lon = startLon; lon <= east + epsilon; lon += lonStepDeg) {
    if (features.length >= maxLineCount) break;
    const clippedLon = Math.max(-180, Math.min(180, lon));
    features.push({
      type: 'Feature',
      properties: { step_km: stepKm },
      geometry: {
        type: 'LineString',
        coordinates: [
          [roundCoordinate(clippedLon), roundCoordinate(south)],
          [roundCoordinate(clippedLon), roundCoordinate(north)]
        ]
      }
    });
  }

  return {
    type: 'FeatureCollection',
    features
  };
};

const formatGridLevelMetersLabel = (levelMeters: number): string => {
  const normalizedMeters = Math.round(Number(levelMeters) || 0);
  if (normalizedMeters <= 0) {
    return '';
  }

  const knownLevel = KM_GRID_LEVELS.find(
    (level) => Math.round(level.stepKm * 1000) === normalizedMeters
  );
  if (knownLevel) {
    return knownLevel.label;
  }

  if (normalizedMeters >= 1000) {
    const km = normalizedMeters / 1000;
    return Number.isInteger(km) ? `${km} km` : `${km.toFixed(1)} km`;
  }

  return `${normalizedMeters} m`;
};

const formatGridLevelMetersCompactLabel = (levelMeters: number): string => {
  const normalizedMeters = Math.round(Number(levelMeters) || 0);
  if (normalizedMeters <= 0) {
    return '';
  }
  if (normalizedMeters === 1000) return '1km';
  if (normalizedMeters === 5000) return '5km';
  if (normalizedMeters >= 1000) {
    const km = normalizedMeters / 1000;
    return Number.isInteger(km) ? `${km}km` : `${km.toFixed(1)}km`;
  }
  return `${normalizedMeters}m`;
};

const hasSameIds = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((value, index) => value === b[index]);
};

const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{6})$/;

const normalizeHexColor = (value: string | null | undefined, fallback = GRID1_FALLBACK_COLOR): string => {
  const normalized = String(value || '').trim();
  if (!HEX_COLOR_REGEX.test(normalized)) {
    return fallback;
  }
  return normalized.toUpperCase();
};

const createEmptyBranchEmployeeFormState = (): BranchEmployeeFormState => ({
  id: '',
  employeeCode: '',
  name: '',
  colorCode: DEFAULT_EMPLOYEE_COLOR_PALETTE[0],
  maxCapacity: String(DEFAULT_EMPLOYEE_MAX_CAPACITY),
  isActive: true
});

const normalizeBranchEmployeeRecord = (employee: Record<string, unknown>): BranchEmployee => ({
  id: String(employee.id || '').trim(),
  branchId: String(employee.branchId || employee.branch_id || '').trim(),
  name: String(employee.name || employee.employeeCode || employee.employee_id || employee.id || '').trim(),
  employeeCode: String(employee.employeeCode || employee.employee_id || '').trim(),
  colorCode: normalizeHexColor(String(employee.colorCode || employee.color_code || ''), GRID1_FALLBACK_COLOR),
  maxCapacity: Number.isFinite(Number(employee.maxCapacity ?? employee.max_capacity))
    ? Number(employee.maxCapacity ?? employee.max_capacity)
    : null,
  isActive: Boolean(employee.isActive ?? employee.is_active ?? true),
  allocatedPocketsCount: Number(employee.allocatedPocketsCount ?? employee.allocated_pockets_count ?? 0),
  allocatedCustomerCount: Number(employee.allocatedCustomerCount ?? employee.allocated_customer_count ?? 0)
});

const buildEmployeeColorStateFromPockets = (
  pockets: GridPocketCollection,
  previousColors: Record<string, string>
): Record<string, string> => {
  const backendColors = new globalThis.Map<string, string>();
  const employeeIds: string[] = [];

  pockets.features.forEach((feature) => {
    const employeeId = getPocketEmployeeId(feature);
    if (!employeeId || employeeId === 'unassigned') {
      return;
    }

    if (!employeeIds.includes(employeeId)) {
      employeeIds.push(employeeId);
    }

    const pocketColor = normalizeHexColor(
      typeof feature.properties?.color === 'string' ? feature.properties.color : '',
      ''
    );
    if (pocketColor && pocketColor !== '' && !backendColors.has(employeeId)) {
      backendColors.set(employeeId, pocketColor);
    }
  });

  const nextColors: Record<string, string> = {};
  employeeIds.sort((a, b) => a.localeCompare(b)).forEach((employeeId, index) => {
    const fallbackPaletteColor = DEFAULT_EMPLOYEE_COLOR_PALETTE[index % DEFAULT_EMPLOYEE_COLOR_PALETTE.length];
    nextColors[employeeId] = normalizeHexColor(
      previousColors[employeeId]
      || backendColors.get(employeeId)
      || fallbackPaletteColor,
      fallbackPaletteColor
    );
  });

  return nextColors;
};

// --- ORIGINAL BACKUP ---
// const buildEmployeeColorMatchExpression = (_employeeColors: Record<string, string>) => {
//   // Always prefer backend-assigned feature color to keep map colors aligned with system config.
//   return ['coalesce', ['get', 'color'], GRID1_FALLBACK_COLOR];
// };
// --- ORIGINAL BACKUP ---
// const buildEmployeeColorMatchExpression = (_employeeColors: Record<string, string>) =>
//   ['coalesce', ['get', 'color_code'], 'rgba(150, 150, 150, 0.15)'];
// --- ORIGINAL BACKUP ---
// const buildEmployeeColorMatchExpression = (_employeeColors: Record<string, string>) =>
//   ['coalesce', ['get', 'color_code'], ['get', 'color'], 'rgba(150, 150, 150, 0.15)'];
const buildEmployeeColorMatchExpression = (_employeeColors: Record<string, string>) =>
  ['coalesce', ['get', 'color_code'], 'rgba(150, 150, 150, 0.15)'];

const applyEmployeeColorOverridesToPockets = (
  pockets: GridPocketCollection
): GridPocketCollection => ({
  type: 'FeatureCollection',
  features: (pockets.features || []).map((feature) => {
    const backendColor = normalizeHexColor(
      typeof feature.properties?.color === 'string' ? feature.properties.color : '',
      GRID1_FALLBACK_COLOR
    );

    return {
      ...feature,
      properties: {
        ...(feature.properties || {}),
        // Keep both color keys in sync because backend payloads use either `color` or `color_code`.
        color: backendColor,
        color_code: backendColor
      }
    } as GridPocketFeature;
  })
});

const normalizePocketFeatureCollection = (
  pockets: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>
): GridPocketCollection => ({
  type: 'FeatureCollection',
  features: (pockets.features || []).map((feature) => {
    const normalizedColor = typeof feature.properties?.color === 'string' && feature.properties.color.trim()
      ? feature.properties.color.trim()
      : (typeof feature.properties?.color_code === 'string' && feature.properties.color_code.trim()
        ? feature.properties.color_code.trim()
        : GRID1_FALLBACK_COLOR);

    return {
      ...feature,
      properties: {
        ...(feature.properties || {}),
        branch_id: feature.properties?.branch_id ? String(feature.properties.branch_id) : undefined,
        grid_cell_id: feature.properties?.grid_cell_id ? String(feature.properties.grid_cell_id) : undefined,
        pocket_id: feature.properties?.pocket_id
          ? String(feature.properties.pocket_id)
          : (feature.properties?.grid_cell_id ? String(feature.properties.grid_cell_id) : undefined),
        employee_id:
          feature.properties?.employee_id === undefined || feature.properties?.employee_id === null
            ? null
            : String(feature.properties.employee_id),
        level_m: Number(feature.properties?.level_m || 0),
        account_count: Number(feature.properties?.account_count || 0),
        customer_count: Number(
          feature.properties?.customer_count ?? feature.properties?.account_count ?? 0
        ),
        selected_branch_customer_count: Number(
          feature.properties?.selected_branch_customer_count ?? feature.properties?.account_count ?? 0
        ),
        other_branch_customer_count: Number(feature.properties?.other_branch_customer_count ?? 0),
        color: normalizedColor,
        color_code: normalizedColor
      }
    } as GridPocketFeature;
  })
});

const getFeatureColorForSelection = (feature: GridPocketFeature): string =>
  String(
    feature.properties?.color
    || feature.properties?.color_code
    || ''
  ).trim();

const getRawPocketColor = (properties: Record<string, unknown>): string =>
  String(
    properties.color
    || properties.color_code
    || ''
  ).trim();

const withPocketColorCode = (properties: Record<string, unknown>, colorCode: string): Record<string, unknown> => ({
  ...properties,
  color: colorCode,
  color_code: colorCode
});

const getPocketGridCellId = (feature: GridPocketFeature): string => String(feature.properties?.grid_cell_id || '').trim();

const getPocketId = (feature: GridPocketFeature): string =>
  String(feature.properties?.pocket_id || feature.properties?.grid_cell_id || '').trim();

const getPocketSelectionKey = (feature: GridPocketFeature): string => getPocketId(feature);

const getPocketEmployeeId = (feature: GridPocketFeature): string => {
  const employeeId = feature.properties?.employee_id;
  const normalized = employeeId === undefined || employeeId === null ? '' : String(employeeId).trim();
  return normalized || 'unassigned';
};

const getPocketAccountCount = (feature: GridPocketFeature): number => {
  const value = Number(feature.properties?.account_count || 0);
  return Number.isFinite(value) ? value : 0;
};

const getPocketCustomerCount = (feature: GridPocketFeature): number => {
  const value = Number(feature.properties?.customer_count ?? feature.properties?.account_count ?? 0);
  return Number.isFinite(value) ? value : 0;
};

const getPocketSelectedBranchCustomerCount = (feature: GridPocketFeature): number => {
  const value = Number(
    feature.properties?.selected_branch_customer_count ?? feature.properties?.account_count ?? 0
  );
  return Number.isFinite(value) ? value : 0;
};

const getPocketOtherBranchCustomerCount = (feature: GridPocketFeature): number => {
  const value = Number(feature.properties?.other_branch_customer_count ?? 0);
  return Number.isFinite(value) ? value : 0;
};

const buildEmployeeMetrics = (pockets: GridPocketCollection, tolerance: number): EmployeeMetric[] => {
  const totalsByEmployee = new globalThis.Map<string, { accounts: number; pockets: number; nonEmptyPockets: number }>();
  let totalAccounts = 0;

  pockets.features.forEach((feature) => {
    const employeeId = getPocketEmployeeId(feature);
    const accounts = getPocketAccountCount(feature);
    totalAccounts += accounts;
    const existing = totalsByEmployee.get(employeeId) || { accounts: 0, pockets: 0, nonEmptyPockets: 0 };
    existing.accounts += accounts;
    existing.pockets += 1;
    if (accounts > 0) {
      existing.nonEmptyPockets += 1;
    }
    totalsByEmployee.set(employeeId, existing);
  });

  const managedEmployeeIds = Array.from(totalsByEmployee.keys()).filter((employeeId) => employeeId !== 'unassigned');
  const targetAccounts = managedEmployeeIds.length > 0
    ? totalAccounts / managedEmployeeIds.length
    : 0;
  const lowerLimit = targetAccounts * (1 - tolerance);
  const upperLimit = targetAccounts * (1 + tolerance);

  return Array.from(totalsByEmployee.entries())
    .map(([employeeId, totals]) => {
      let status: EmployeeMetric['status'] = 'within';
      if (employeeId !== 'unassigned') {
        if (totals.accounts < lowerLimit) {
          status = 'under';
        } else if (totals.accounts > upperLimit) {
          status = 'over';
        }
      } else {
        status = totals.accounts > 0 ? 'over' : 'within';
      }

      return {
        employeeId,
        accountTotal: totals.accounts,
        pocketCount: totals.pockets,
        nonEmptyPocketCount: totals.nonEmptyPockets,
        targetAccounts,
        lowerLimit,
        upperLimit,
        status
      };
    })
    .sort((a, b) => {
      if (a.employeeId === 'unassigned') return 1;
      if (b.employeeId === 'unassigned') return -1;
      return a.employeeId.localeCompare(b.employeeId);
    });
};

const buildRectangleSelectionCoordinates = (
  start: [number, number],
  end: [number, number]
): [number, number][] => [
  [start[0], start[1]],
  [end[0], start[1]],
  [end[0], end[1]],
  [start[0], end[1]],
  [start[0], start[1]]
];

export default function Dashboard() {
  const navigate = useNavigate();
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const map = useRef<Map | null>(null);
  const updateGridOverlayRef = useRef<() => void>(() => undefined);
  const setDashboardMapPanel = useStore((state) => state.setDashboardMapPanel);
  const resetDashboardMapPanel = useStore((state) => state.resetDashboardMapPanel);
  const selectedGridLevels = useStore((state) => state.dashboardSelectedGridLevels);
  const showBranches = useStore((state) => state.showBranches);
  const selectedGridLevelsRef = useRef<DashboardGridLevelId[]>(selectedGridLevels);
  const showBranchesRef = useRef(showBranches);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [currentZoom, setCurrentZoom] = useState(DEFAULT_ZOOM);
  const [currentCenter, setCurrentCenter] = useState(DEFAULT_CENTER);
  const [currentGridLabel, setCurrentGridLabel] = useState(
    buildGridOverlayLabel(selectedGridLevels, DEFAULT_ZOOM)
  );
  const [territoryMode, setTerritoryMode] = useState<TerritoryMode>('existing_customers');
  const [territoryCustomerView, setTerritoryCustomerView] = useState<TerritoryCustomerView>('selected_pockets');
  const [territoryBranchOptions, setTerritoryBranchOptions] = useState<TerritoryBranchOption[]>([]);
  const [selectedTerritoryBranchIds, setSelectedTerritoryBranchIds] = useState<string[]>([]);
  const [dashboardGridLevelColors, setDashboardGridLevelColors] = useState<Record<DashboardGridLevelId, string>>(
    buildDefaultDashboardGridLevelColors()
  );
  const [systemOrigin, setSystemOrigin] = useState<{ lat: number; lon: number }>({
    lat: 8.0,
    lon: 68.0
  });
  const dashboardGridLevelColorsRef = useRef<Record<DashboardGridLevelId, string>>(
    buildDefaultDashboardGridLevelColors()
  );
  const systemOriginRef = useRef<{ lat: number; lon: number }>({ lat: 8.0, lon: 68.0 });
  const [territorySummary, setTerritorySummary] = useState<TerritorySummary | null>(null);
  const [territoryLoading, setTerritoryLoading] = useState(false);
  const [branchOptionsLoading, setBranchOptionsLoading] = useState(false);
  const [territoryError, setTerritoryError] = useState<string | null>(null);
  const [showTerritoryCustomers, setShowTerritoryCustomers] = useState(true);
  const [showOtherBranches, setShowOtherBranches] = useState(false);
  const [showPocketLayout, setShowPocketLayout] = useState(true);
  const [managerOverrideEnabled, setManagerOverrideEnabled] = useState(false);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('box');
  const [selectedPocketIds, setSelectedPocketIds] = useState<string[]>([]);
  const [reassignEmployeeId, setReassignEmployeeId] = useState('');
  const [activeAssignmentBranchId, setActiveAssignmentBranchId] = useState('');
  const [allocationLevel, setAllocationLevel] = useState<number>(5000);
  const [activeAllocationLevelMeters, setActiveAllocationLevelMeters] = useState(0);
  const [assignmentTolerance, setAssignmentTolerance] = useState(DEFAULT_ASSIGNMENT_TOLERANCE);
  const [assignedGridPockets, setAssignedGridPockets] = useState<GridPocketCollection>(EMPTY_GRID_POCKET_FEATURE_COLLECTION);
  const [employeeTerritoryLoading, setEmployeeTerritoryLoading] = useState(false);
  const [employeeTerritoryEmptyState, setEmployeeTerritoryEmptyState] = useState<{
    branchId: string;
    levelMeters: number;
  } | null>(null);
  const [allocationFallbackApplied, setAllocationFallbackApplied] = useState(false);
  const [allocationFallbackReason, setAllocationFallbackReason] = useState<string | null>(null);
  const [allocationRepairLoading, setAllocationRepairLoading] = useState(false);
  const [employeeColors, setEmployeeColors] = useState<Record<string, string>>({});
  const [branchEmployees, setBranchEmployees] = useState<BranchEmployee[]>([]);
  const [branchTeamEmployees, setBranchTeamEmployees] = useState<BranchEmployee[]>([]);
  const [branchEmployeesLoading, setBranchEmployeesLoading] = useState(false);
  const [manageTeamExpanded, setManageTeamExpanded] = useState(false);
  const [employeeFormState, setEmployeeFormState] = useState<BranchEmployeeFormState>(
    createEmptyBranchEmployeeFormState()
  );
  const [employeeFormSaving, setEmployeeFormSaving] = useState(false);
  const [employeeRowActionId, setEmployeeRowActionId] = useState('');
  const [employeeFormError, setEmployeeFormError] = useState<string | null>(null);
  const [employeeMetrics, setEmployeeMetrics] = useState<EmployeeMetric[]>([]);
  const [selectedPocket, setSelectedPocket] = useState<any | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [, setDrawerEmployeeId] = useState('');
  const [tableAssignLoadingPocketId, setTableAssignLoadingPocketId] = useState('');
  const [hoveredPocketId, setHoveredPocketId] = useState('');
  const [showPocketAllocationsPanel, setShowPocketAllocationsPanel] = useState(true);
  const [lassoDraftCoordinates, setLassoDraftCoordinates] = useState<[number, number][]>([]);
  const [lassoCursorCoordinate, setLassoCursorCoordinate] = useState<[number, number] | null>(null);
  const territoryRequestCounterRef = useRef(0);
  const employeeTerritoryRequestCounterRef = useRef(0);
  const branchMarkerRequestCounterRef = useRef(0);
  const branchCatalogLoadedRef = useRef(false);
  const boxSelectionStartRef = useRef<[number, number] | null>(null);
  const isBoxSelectingRef = useRef(false);
  const skipNextMapClickRef = useRef(false);
  const managerOverrideEnabledRef = useRef(managerOverrideEnabled);
  const selectionModeRef = useRef<SelectionMode>(selectionMode);
  const assignedGridPocketsRef = useRef<GridPocketCollection>(assignedGridPockets);
  const activeAssignmentBranchIdRef = useRef(activeAssignmentBranchId);
  const activeAllocationLevelMetersRef = useRef(activeAllocationLevelMeters);
  const showPocketLayoutRef = useRef(showPocketLayout);
  const authoritativePocketCountRef = useRef(assignedGridPockets.features.length);

  const applyConfiguredGridLayerColors = useCallback(
    (colors: Record<DashboardGridLevelId, string>) => {
      if (!map.current || !map.current.isStyleLoaded()) {
        return;
      }

      KM_GRID_LEVELS.forEach((level) => {
        const layerId = getGridLayerId(level.id);
        if (!map.current?.getLayer(layerId)) {
          return;
        }

        map.current.setPaintProperty(
          layerId,
          'line-color',
          colors[level.id] || level.color
        );
        map.current.setPaintProperty(
          layerId,
          'line-opacity',
          resolveGridLayerOpacity(level.id, level.opacity)
        );
      });
    },
    []
  );

  const loadSystemConfig = useCallback(async () => {
    try {
      const configResponse = await api.getConfig();
      const configPayload = configResponse?.config || configResponse;
      
      // Colors
      const nextColors = normalizeDashboardGridLevelColors(
        extractDashboardGridLevelColors(configPayload)
      );
      dashboardGridLevelColorsRef.current = nextColors;
      setDashboardGridLevelColors(nextColors);
      applyConfiguredGridLayerColors(nextColors);

      // Origin
      if (configPayload.originLat !== undefined && configPayload.originLon !== undefined) {
        const nextOrigin = {
          lat: Number(configPayload.originLat),
          lon: Number(configPayload.originLon)
        };
        systemOriginRef.current = nextOrigin;
        setSystemOrigin(nextOrigin);
      }
    } catch (error) {
      console.debug('Failed to load system config. Using defaults.', error);
    }
  }, [applyConfiguredGridLayerColors]);

  useEffect(() => {
    void loadSystemConfig();

    const handleWindowFocus = () => {
      void loadSystemConfig();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void loadSystemConfig();
      }
    };

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadSystemConfig]);

  const addBranchMarkers = useCallback(async () => {
    if (!map.current || !map.current.isStyleLoaded()) return;

    const mapInstance = map.current;

    if (!mapInstance.getSource(BRANCH_MARKERS_SOURCE_ID)) {
      mapInstance.addSource(BRANCH_MARKERS_SOURCE_ID, {
        type: 'geojson',
        data: EMPTY_BRANCH_FEATURE_COLLECTION
      });
    }

    if (!mapInstance.getLayer(BRANCH_MARKERS_LAYER_ID)) {
      mapInstance.addLayer({
        id: BRANCH_MARKERS_LAYER_ID,
        type: 'circle',
        source: BRANCH_MARKERS_SOURCE_ID,
        layout: {
          visibility: showBranchesRef.current && showOtherBranches ? 'visible' : 'none'
        },
        paint: {
          'circle-color': '#EF4444',
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            4, 5.5,
            8, 7.5,
            12, 9.5
          ],
          'circle-opacity': 1,
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': 2
        }
      });
    }

    if (mapInstance.getLayer(BRANCH_MARKERS_LAYER_ID)) {
      // Keep branch markers above fill/border/grid layers.
      mapInstance.moveLayer(BRANCH_MARKERS_LAYER_ID);
      mapInstance.setLayoutProperty(
        BRANCH_MARKERS_LAYER_ID,
        'visibility',
        showBranchesRef.current && showOtherBranches ? 'visible' : 'none'
      );
    }

    try {
      const bounds = mapInstance.getBounds();
      const bbox = [
        bounds.getWest().toFixed(6),
        bounds.getSouth().toFixed(6),
        bounds.getEast().toFixed(6),
        bounds.getNorth().toFixed(6)
      ].join(',');

      const requestId = branchMarkerRequestCounterRef.current + 1;
      branchMarkerRequestCounterRef.current = requestId;

      const response = await api.getBranches({
        limit: 1000,
        offset: 0,
        bbox
      });
      const rawCandidate = response?.branches ?? response?.data ?? response;
      const rawBranches = Array.isArray(rawCandidate)
        ? rawCandidate
        : Array.isArray(rawCandidate?.branches)
          ? rawCandidate.branches
          : [];

      const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
      rawBranches.forEach((branch: Record<string, unknown>) => {
        const lat = Number(branch.lat);
        const lon = Number(branch.lon);

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          return;
        }

        features.push({
          type: 'Feature',
          properties: {
            id: String(branch.id ?? ''),
            city: String(branch.city ?? '')
          },
          geometry: {
            type: 'Point',
            coordinates: [lon, lat]
          }
        });
      });

      if (
        !map.current
        || map.current !== mapInstance
        || requestId !== branchMarkerRequestCounterRef.current
      ) {
        return;
      }

      const source = mapInstance.getSource(BRANCH_MARKERS_SOURCE_ID) as unknown as {
        setData: (data: GeoJSON.FeatureCollection<GeoJSON.Point>) => void;
      } | undefined;

      source?.setData({
        type: 'FeatureCollection',
        features
      });
    } catch (error) {
      console.error('Failed to load branch markers:', error);
    }
  }, [showOtherBranches]);

  const setGeoJsonSourceData = (
    mapInstance: Map,
    sourceId: string,
    data:
      | GeoJSON.FeatureCollection<GeoJSON.Point>
      | GeoJSON.FeatureCollection<GeoJSON.LineString>
      | GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>
  ) => {
    const source = mapInstance.getSource(sourceId) as unknown as {
      setData: (
        nextData:
          | GeoJSON.FeatureCollection<GeoJSON.Point>
          | GeoJSON.FeatureCollection<GeoJSON.LineString>
          | GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>
      ) => void;
    } | undefined;
    source?.setData(data);
  };

  const enforceTerritoryLayerStackOrder = (mapInstance: Map) => {
    const orderedLayers = [
      TERRITORY_FILL_LAYER_ID,
      TERRITORY_LINE_LAYER_ID,
      GRID1_FILL_LAYER_ID,
      GRID1_LINE_LAYER_ID,
      GRID1_HIGHLIGHT_LAYER_ID,
      GRID1_SELECTION_PREVIEW_FILL_LAYER_ID,
      GRID1_SELECTION_PREVIEW_LINE_LAYER_ID,
      GRID1_SELECTED_FILL_LAYER_ID,
      GRID1_SELECTED_LINE_LAYER_ID,
      TERRITORY_CUSTOMERS_LAYER_ID,
      TERRITORY_SELECTED_BRANCHES_LAYER_ID,
      BRANCH_MARKERS_LAYER_ID
    ];

    orderedLayers.forEach((layerId) => {
      if (mapInstance.getLayer(layerId)) {
        mapInstance.moveLayer(layerId);
      }
    });
  };

  const applyPocketLayoutVisibility = (mapInstance: Map, visible: boolean) => {
    const visibility = visible ? 'visible' : 'none';
    [
      GRID1_FILL_LAYER_ID,
      GRID1_LINE_LAYER_ID,
      GRID1_HIGHLIGHT_LAYER_ID,
      GRID1_SELECTED_FILL_LAYER_ID,
      GRID1_SELECTED_LINE_LAYER_ID,
      GRID1_SELECTION_PREVIEW_FILL_LAYER_ID,
      GRID1_SELECTION_PREVIEW_LINE_LAYER_ID
    ].forEach((layerId) => {
      if (mapInstance.getLayer(layerId)) {
        mapInstance.setLayoutProperty(layerId, 'visibility', visibility);
      }
    });
  };

  const applyTerritoryPolygonVisibility = (mapInstance: Map, visible: boolean) => {
    const visibility = visible ? 'visible' : 'none';
    [TERRITORY_FILL_LAYER_ID, TERRITORY_LINE_LAYER_ID].forEach((layerId) => {
      if (mapInstance.getLayer(layerId)) {
        mapInstance.setLayoutProperty(layerId, 'visibility', visibility);
      }
    });
  };

  const setSelectionPreviewData = (
    nextData: GeoJSON.FeatureCollection<GeoJSON.Polygon>
  ) => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    setGeoJsonSourceData(map.current, GRID1_SELECTION_PREVIEW_SOURCE_ID, nextData);
  };

  const resetSelectionPreview = () => {
    setSelectionPreviewData(EMPTY_SELECTION_PREVIEW_FEATURE_COLLECTION);
  };

  const selectPocketsWithinPolygon = (
    polygonCoordinates: [number, number][],
    appendToSelection = false
  ) => {
    if (polygonCoordinates.length < 4) {
      return;
    }

    const selectionPolygon = turfPolygon([polygonCoordinates]);
    const matchedIds: string[] = [];

    assignedGridPocketsRef.current.features.forEach((feature) => {
      const selectionKey = getPocketSelectionKey(feature);
      if (!selectionKey) {
        return;
      }

      try {
        if (booleanIntersects(feature as any, selectionPolygon as any)) {
          matchedIds.push(selectionKey);
        }
      } catch {
        // Ignore malformed geometries to keep selection tool resilient.
      }
    });

    setSelectedPocketIds((previousIds) => {
      if (!appendToSelection) {
        return Array.from(new Set(matchedIds));
      }
      return Array.from(new Set([...previousIds, ...matchedIds]));
    });
  };

  const clearManagerSelection = () => {
    setSelectedPocketIds([]);
    setLassoDraftCoordinates([]);
    setLassoCursorCoordinate(null);
    setReassignEmployeeId('');
    boxSelectionStartRef.current = null;
    isBoxSelectingRef.current = false;
    if (map.current?.dragPan) {
      map.current.dragPan.enable();
    }
    resetSelectionPreview();
  };

  const branchEmployeeMap = useMemo(
    () => new globalThis.Map(branchEmployees.map((employee) => [employee.id, employee])),
    [branchEmployees]
  );

  const buildSelectedPocketPayload = useCallback((feature: GridPocketFeature) => {
    const gridCellId = getPocketGridCellId(feature);
    const pocketId = getPocketId(feature);
    const employeeId = getPocketEmployeeId(feature);
    const customerCount = getPocketCustomerCount(feature);
    const selectedBranchCustomerCount = getPocketSelectedBranchCustomerCount(feature);
    const otherBranchCustomerCount = getPocketOtherBranchCustomerCount(feature);
    // --- ORIGINAL BACKUP ---
    // const assignedColor = normalizeHexColor(
    //   employeeId !== 'unassigned'
    //     ? (branchEmployeeMap.get(employeeId)?.colorCode || String(feature.properties?.color || ''))
    //     : String(feature.properties?.color || ''),
    //   GRID1_FALLBACK_COLOR
    // );
    const assignedColor = normalizeHexColor(
      employeeId !== 'unassigned'
        ? (branchEmployeeMap.get(employeeId)?.colorCode || getFeatureColorForSelection(feature))
        : getFeatureColorForSelection(feature),
      GRID1_FALLBACK_COLOR
    );

    return {
      branch_id: String(feature.properties?.branch_id || activeAssignmentBranchId || '').trim(),
      grid_cell_id: gridCellId,
      pocket_id: pocketId || gridCellId,
      employee_id: employeeId,
      color: assignedColor,
      customer_count: customerCount,
      selected_branch_customer_count: selectedBranchCustomerCount,
      other_branch_customer_count: otherBranchCustomerCount
    };
  }, [activeAssignmentBranchId, branchEmployeeMap]);

  const loadBranchEmployees = useCallback(async (branchId: string) => {
    const normalizedBranchId = String(branchId || '').trim();
    if (!normalizedBranchId) {
      setBranchEmployees([]);
      setBranchTeamEmployees([]);
      setEmployeeFormState(createEmptyBranchEmployeeFormState());
      setEmployeeFormError(null);
      return;
    }

    setBranchEmployeesLoading(true);
    try {
      const response = await api.getEmployeesByBranch(normalizedBranchId, {
        includeInactive: true
      });
      const employees: Record<string, unknown>[] = Array.isArray(response?.employees)
        ? response.employees as Record<string, unknown>[]
        : [];
      const normalizedEmployees: BranchEmployee[] = employees
        .map((employee) => normalizeBranchEmployeeRecord(employee))
        .filter((employee: BranchEmployee) => employee.id.length > 0);
      setBranchTeamEmployees(normalizedEmployees);
      setBranchEmployees(normalizedEmployees.filter((employee) => employee.isActive));
      setEmployeeFormError(null);
    } catch (error) {
      console.error('Failed to load branch employees:', error);
      setBranchEmployees([]);
      setBranchTeamEmployees([]);
    } finally {
      setBranchEmployeesLoading(false);
    }
  }, []);

  const applyPocketReassignment = async () => {
    // --- ORIGINAL BACKUP ---
    // if (!reassignEmployeeId || selectedPocketIds.length === 0) {
    if (allocationFallbackLocked || !reassignEmployeeId || selectedPocketIds.length === 0) {
      return;
    }

    const targetEmployeeId = reassignEmployeeId;
    const targetColor = normalizeHexColor(
      branchEmployeeMap.get(targetEmployeeId)?.colorCode || '',
      GRID1_FALLBACK_COLOR
    );
    const selectedIdsSnapshot = [...selectedPocketIds];
    const selectedSet = new Set(selectedPocketIds);
    const updatedPockets: GridPocketCollection = {
      type: 'FeatureCollection',
      features: assignedGridPockets.features.map((feature) => {
        const selectionKey = getPocketSelectionKey(feature);
        if (!selectionKey || !selectedSet.has(selectionKey)) {
          return feature;
        }
        // --- ORIGINAL BACKUP ---
        // return {
        //   ...feature,
        //   properties: {
        //     ...(feature.properties || {}),
        //     employee_id: reassignEmployeeId
        //   }
        // } as GridPocketFeature;
        return {
          ...feature,
          properties: withPocketColorCode(
            {
              ...(feature.properties || {}),
              employee_id: reassignEmployeeId
            },
            targetColor
          )
        } as GridPocketFeature;
      })
    };

    setAssignedGridPockets(updatedPockets);
    setEmployeeMetrics(buildEmployeeMetrics(updatedPockets, assignmentTolerance));
    clearManagerSelection();

    if (!activeAssignmentBranchId) {
      return;
    }

    try {
      const response = await api.reassignEmployeeTerritories(activeAssignmentBranchId, {
        employeeId: targetEmployeeId,
        gridCellIds: selectedIdsSnapshot,
        level_m: allocationLevel
      }) as EmployeeTerritoryAssignmentResponse;

      const syncedPockets = normalizePocketFeatureCollection(
        response.pockets || EMPTY_TERRITORY_FEATURE_COLLECTION
      );
      const syncedTerritories = response.territories || EMPTY_TERRITORY_FEATURE_COLLECTION;

      setAssignedGridPockets(syncedPockets);
      setEmployeeColors((previousColors) =>
        buildEmployeeColorStateFromPockets(syncedPockets, previousColors)
      );
      const selectedPocketKey = String(
        selectedPocket?.pocket_id || selectedPocket?.grid_cell_id || ''
      ).trim();
      if (selectedPocketKey) {
        const refreshedInspectedFeature = syncedPockets.features.find(
          (feature) => getPocketSelectionKey(feature) === selectedPocketKey
        );
        setSelectedPocket(
          refreshedInspectedFeature
            ? buildSelectedPocketPayload(refreshedInspectedFeature)
            : null
        );
      }
      if (map.current && map.current.isStyleLoaded()) {
        setGeoJsonSourceData(
          map.current,
          TERRITORY_SOURCE_ID,
          syncedTerritories as GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>
        );
        if (map.current.getLayer(TERRITORY_FILL_LAYER_ID)) {
          map.current.moveLayer(TERRITORY_FILL_LAYER_ID, STATE_BORDERS_LAYER_ID);
        }
        if (map.current.getLayer(TERRITORY_LINE_LAYER_ID)) {
          map.current.moveLayer(TERRITORY_LINE_LAYER_ID, STATE_BORDERS_LAYER_ID);
        }
      }
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Failed to persist pocket reassignment.';
      setTerritoryError(message);
    }
  };

  const finishLassoSelection = (appendToSelection = false) => {
    if (lassoDraftCoordinates.length < 3) {
      setTerritoryError('Lasso requires at least 3 points.');
      return;
    }

    const closedCoordinates: [number, number][] = [
      ...lassoDraftCoordinates,
      lassoDraftCoordinates[0]
    ];
    selectPocketsWithinPolygon(closedCoordinates, appendToSelection);
    setLassoDraftCoordinates([]);
    setLassoCursorCoordinate(null);
    resetSelectionPreview();
  };

  const ensureTerritoryLayers = (mapInstance: Map) => {
    if (!mapInstance.getSource(TERRITORY_SOURCE_ID)) {
      mapInstance.addSource(TERRITORY_SOURCE_ID, {
        type: 'geojson',
        data: EMPTY_TERRITORY_FEATURE_COLLECTION
      });
    }

    if (!mapInstance.getSource(GRID1_SOURCE_ID)) {
      mapInstance.addSource(GRID1_SOURCE_ID, {
        type: 'geojson',
        data: EMPTY_TERRITORY_FEATURE_COLLECTION
      });
    }

    if (!mapInstance.getLayer(GRID1_FILL_LAYER_ID)) {
      // --- ORIGINAL BACKUP ---
      // mapInstance.addLayer(
      //   {
      //     id: GRID1_FILL_LAYER_ID,
      //     type: 'fill',
      //     source: GRID1_SOURCE_ID,
      //     layout: {
      //       visibility: showPocketLayout ? 'visible' : 'none'
      //     },
      //     paint: {
      //       'fill-color': ['coalesce', ['get', 'color_code'], 'rgba(200, 200, 200, 0.2)'],
      //       'fill-opacity': 0.82
      //     }
      //   },
      //   STATE_BORDERS_LAYER_ID
      // );
      mapInstance.addLayer(
        {
          id: GRID1_FILL_LAYER_ID,
          type: 'fill',
          source: GRID1_SOURCE_ID,
          layout: {
            visibility: showPocketLayout ? 'visible' : 'none'
          },
          paint: {
            // --- ORIGINAL BACKUP ---
            // 'fill-color': ['coalesce', ['get', 'color_code'], 'rgba(150, 150, 150, 0.15)'],
            // --- ORIGINAL BACKUP ---
            // 'fill-color': ['coalesce', ['get', 'color_code'], ['get', 'color'], 'rgba(150, 150, 150, 0.15)'],
            'fill-color': ['coalesce', ['get', 'color_code'], 'rgba(150, 150, 150, 0.15)'],
            'fill-opacity': 0.8
          }
        },
        STATE_BORDERS_LAYER_ID
      );
    }

    if (!mapInstance.getLayer(GRID1_LINE_LAYER_ID)) {
      // --- ORIGINAL BACKUP ---
      // mapInstance.addLayer(
      //   {
      //     id: GRID1_LINE_LAYER_ID,
      //     type: 'line',
      //     source: GRID1_SOURCE_ID,
      //     layout: {
      //       visibility: showPocketLayout ? 'visible' : 'none'
      //     },
      //     paint: {
      //       'line-color': '#E2E8F0',
      //       'line-width': [
      //         'interpolate',
      //         ['linear'],
      //         ['zoom'],
      //         5, 0.9,
      //         9, 1.1,
      //         12, 1.35,
      //         15, 1.6
      //       ],
      //       'line-opacity': 0.95
      //     }
      //   },
      //   STATE_BORDERS_LAYER_ID
      // );
      mapInstance.addLayer(
        {
          id: GRID1_LINE_LAYER_ID,
          type: 'line',
          source: GRID1_SOURCE_ID,
          layout: {
            visibility: showPocketLayout ? 'visible' : 'none'
          },
          paint: {
            'line-color': '#ffffff',
            // --- ORIGINAL BACKUP ---
            // 'line-width': [
            //   'interpolate',
            //   ['linear'],
            //   ['zoom'],
            //   10, 0.5,
            //   14, 2
            // ],
            // --- ORIGINAL BACKUP ---
            // // Clamp width at low zoom so box borders remain visible.
            // 'line-width': ['max', 0.5, ['interpolate', ['linear'], ['zoom'], 10, 0.5, 14, 2]],
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 14, 2],
            'line-opacity': 1
          }
        },
        STATE_BORDERS_LAYER_ID
      );
    }
    if (mapInstance.getLayer(GRID1_LINE_LAYER_ID)) {
      // --- ORIGINAL BACKUP ---
      // mapInstance.setPaintProperty(GRID1_LINE_LAYER_ID, 'line-color', '#E2E8F0');
      // mapInstance.setPaintProperty(
      //   GRID1_LINE_LAYER_ID,
      //   'line-width',
      //   ['interpolate', ['linear'], ['zoom'], 5, 0.9, 9, 1.1, 12, 1.35, 15, 1.6]
      // );
      // mapInstance.setPaintProperty(GRID1_LINE_LAYER_ID, 'line-opacity', 0.95);
      mapInstance.setPaintProperty(GRID1_LINE_LAYER_ID, 'line-color', '#ffffff');
      mapInstance.setPaintProperty(
        GRID1_LINE_LAYER_ID,
        'line-width',
        // --- ORIGINAL BACKUP ---
        // ['interpolate', ['linear'], ['zoom'], 10, 0.5, 14, 2]
        // --- ORIGINAL BACKUP ---
        // ['max', 0.5, ['interpolate', ['linear'], ['zoom'], 10, 0.5, 14, 2]]
        ['interpolate', ['linear'], ['zoom'], 10, 0.5, 14, 2]
      );
      mapInstance.setPaintProperty(GRID1_LINE_LAYER_ID, 'line-opacity', 1);
    }

    if (!mapInstance.getLayer(GRID1_HIGHLIGHT_LAYER_ID)) {
      mapInstance.addLayer({
        id: GRID1_HIGHLIGHT_LAYER_ID,
        type: 'line',
        source: GRID1_SOURCE_ID,
        layout: {
          visibility: showPocketLayout ? 'visible' : 'none'
        },
        filter: ['==', ['coalesce', ['get', 'pocket_id'], ['get', 'grid_cell_id']], ''],
        paint: {
          'line-color': '#FDE047',
          'line-width': 3,
          'line-opacity': 1
        }
      });
    }

    if (!mapInstance.getSource(GRID1_SELECTED_SOURCE_ID)) {
      mapInstance.addSource(GRID1_SELECTED_SOURCE_ID, {
        type: 'geojson',
        data: EMPTY_GRID_POCKET_FEATURE_COLLECTION
      });
    }

    if (!mapInstance.getLayer(GRID1_SELECTED_FILL_LAYER_ID)) {
      mapInstance.addLayer(
        {
          id: GRID1_SELECTED_FILL_LAYER_ID,
          type: 'fill',
          source: GRID1_SELECTED_SOURCE_ID,
          layout: {
            visibility: showPocketLayout ? 'visible' : 'none'
          },
          paint: {
            'fill-color': '#F8FAFC',
            'fill-opacity': 0.5
          }
        }
      );
    }

    if (!mapInstance.getLayer(GRID1_SELECTED_LINE_LAYER_ID)) {
      mapInstance.addLayer(
        {
          id: GRID1_SELECTED_LINE_LAYER_ID,
          type: 'line',
          source: GRID1_SELECTED_SOURCE_ID,
          layout: {
            visibility: showPocketLayout ? 'visible' : 'none'
          },
          paint: {
            'line-color': '#FDE047',
            'line-width': 2,
            'line-opacity': 0.95
          }
        }
      );
    }

    if (!mapInstance.getSource(GRID1_SELECTION_PREVIEW_SOURCE_ID)) {
      mapInstance.addSource(GRID1_SELECTION_PREVIEW_SOURCE_ID, {
        type: 'geojson',
        data: EMPTY_SELECTION_PREVIEW_FEATURE_COLLECTION
      });
    }

    if (!mapInstance.getLayer(GRID1_SELECTION_PREVIEW_FILL_LAYER_ID)) {
      mapInstance.addLayer({
        id: GRID1_SELECTION_PREVIEW_FILL_LAYER_ID,
        type: 'fill',
        source: GRID1_SELECTION_PREVIEW_SOURCE_ID,
        layout: {
          visibility: showPocketLayout ? 'visible' : 'none'
        },
        paint: {
          'fill-color': '#38BDF8',
          'fill-opacity': 0.2
        }
      });
    }

    if (!mapInstance.getLayer(GRID1_SELECTION_PREVIEW_LINE_LAYER_ID)) {
      mapInstance.addLayer({
        id: GRID1_SELECTION_PREVIEW_LINE_LAYER_ID,
        type: 'line',
        source: GRID1_SELECTION_PREVIEW_SOURCE_ID,
        layout: {
          visibility: showPocketLayout ? 'visible' : 'none'
        },
        paint: {
          'line-color': '#7DD3FC',
          'line-width': 1.6,
          'line-opacity': 0.95
        }
      });
    }

    if (!mapInstance.getLayer(TERRITORY_FILL_LAYER_ID)) {
      mapInstance.addLayer(
        {
          id: TERRITORY_FILL_LAYER_ID,
          type: 'fill',
          source: TERRITORY_SOURCE_ID,
          paint: {
            'fill-color': '#10B981',
            'fill-opacity': 0.2
          }
        },
        STATE_BORDERS_LAYER_ID
      );
    }

    if (!mapInstance.getLayer(TERRITORY_LINE_LAYER_ID)) {
      mapInstance.addLayer(
        {
          id: TERRITORY_LINE_LAYER_ID,
          type: 'line',
          source: TERRITORY_SOURCE_ID,
          paint: {
            'line-color': '#34D399',
            'line-width': 2,
            'line-opacity': 0.9
          }
        },
        STATE_BORDERS_LAYER_ID
      );
    }

    if (!mapInstance.getSource(TERRITORY_POINTS_SOURCE_ID)) {
      mapInstance.addSource(TERRITORY_POINTS_SOURCE_ID, {
        type: 'geojson',
        data: EMPTY_TERRITORY_POINT_FEATURE_COLLECTION
      });
    }

    if (mapInstance.getLayer(TERRITORY_POINTS_LAYER_ID)) {
      mapInstance.removeLayer(TERRITORY_POINTS_LAYER_ID);
    }

    if (!mapInstance.getSource(TERRITORY_CUSTOMERS_SOURCE_ID)) {
      mapInstance.addSource(TERRITORY_CUSTOMERS_SOURCE_ID, {
        type: 'geojson',
        data: EMPTY_TERRITORY_POINT_FEATURE_COLLECTION
      });
    }

    if (!mapInstance.getLayer(TERRITORY_CUSTOMERS_LAYER_ID)) {
      mapInstance.addLayer({
        id: TERRITORY_CUSTOMERS_LAYER_ID,
        type: 'circle',
        source: TERRITORY_CUSTOMERS_SOURCE_ID,
        layout: {
          visibility: showTerritoryCustomers ? 'visible' : 'none'
        },
        paint: {
          // --- ORIGINAL BACKUP ---
          // 'circle-color': '#FB923C',
          'circle-color': [
            'case',
            ['==', ['coalesce', ['get', 'isSelectedBranchCustomer'], 0], 1],
            '#22C55E',
            '#EF4444'
          ],
          'circle-opacity': 0.95,
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            4, 1.8,
            8, 2.8,
            12, 4.0
          ],
          'circle-stroke-color': '#FFFFFF',
          // --- ORIGINAL BACKUP ---
          // 'circle-stroke-width': 0.9
          'circle-stroke-width': 1
        }
      });
    }

    if (!mapInstance.getSource(TERRITORY_SELECTED_BRANCHES_SOURCE_ID)) {
      mapInstance.addSource(TERRITORY_SELECTED_BRANCHES_SOURCE_ID, {
        type: 'geojson',
        data: EMPTY_BRANCH_FEATURE_COLLECTION
      });
    }

    if (!mapInstance.getLayer(TERRITORY_SELECTED_BRANCHES_LAYER_ID)) {
      mapInstance.addLayer({
        id: TERRITORY_SELECTED_BRANCHES_LAYER_ID,
        type: 'circle',
        source: TERRITORY_SELECTED_BRANCHES_SOURCE_ID,
        paint: {
          'circle-color': '#DC2626',
          'circle-opacity': 1,
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            4, 5.5,
            8, 7.5,
            12, 10
          ],
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': 2.4
        }
      });
    }
  };

  const clearTerritoryVisualization = () => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    const mapInstance = map.current;
    employeeTerritoryRequestCounterRef.current += 1;
    setGeoJsonSourceData(mapInstance, TERRITORY_SOURCE_ID, EMPTY_TERRITORY_FEATURE_COLLECTION);
    setGeoJsonSourceData(mapInstance, GRID1_SOURCE_ID, EMPTY_TERRITORY_FEATURE_COLLECTION);
    setGeoJsonSourceData(mapInstance, GRID1_SELECTED_SOURCE_ID, EMPTY_GRID_POCKET_FEATURE_COLLECTION);
    setGeoJsonSourceData(mapInstance, GRID1_SELECTION_PREVIEW_SOURCE_ID, EMPTY_SELECTION_PREVIEW_FEATURE_COLLECTION);
    setGeoJsonSourceData(mapInstance, TERRITORY_POINTS_SOURCE_ID, EMPTY_TERRITORY_POINT_FEATURE_COLLECTION);
    setGeoJsonSourceData(mapInstance, TERRITORY_CUSTOMERS_SOURCE_ID, EMPTY_TERRITORY_POINT_FEATURE_COLLECTION);
    setGeoJsonSourceData(mapInstance, TERRITORY_SELECTED_BRANCHES_SOURCE_ID, EMPTY_BRANCH_FEATURE_COLLECTION);
    if (mapInstance.getLayer(GRID1_FILL_LAYER_ID)) {
      mapInstance.setPaintProperty(
        GRID1_FILL_LAYER_ID,
        'fill-color',
        buildEmployeeColorMatchExpression(employeeColors)
      );
      mapInstance.setFilter(GRID1_FILL_LAYER_ID, null);
    }
    setAssignedGridPockets(EMPTY_GRID_POCKET_FEATURE_COLLECTION);
    setEmployeeTerritoryLoading(false);
    setEmployeeTerritoryEmptyState(null);
    setAllocationFallbackApplied(false);
    setAllocationFallbackReason(null);
    setAllocationRepairLoading(false);
    setEmployeeColors({});
    setEmployeeMetrics([]);
    setSelectedPocket(null);
    setDrawerEmployeeId('');
    setIsDrawerOpen(false);
    setHoveredPocketId('');
    setActiveAssignmentBranchId('');
    setActiveAllocationLevelMeters(0);
    setAssignmentTolerance(DEFAULT_ASSIGNMENT_TOLERANCE);
    clearManagerSelection();
  };

  const loadEmployeeTerritoryAssignment = async (
    branchId: string,
    requestedLevelMeters: number = allocationLevel
  ) => {
    if (!map.current || !map.current.isStyleLoaded()) return;

    const trimmedBranchId = String(branchId || '').trim();

    if (!trimmedBranchId) {
      setEmployeeTerritoryLoading(false);
      setEmployeeTerritoryEmptyState(null);
      setGeoJsonSourceData(map.current, GRID1_SOURCE_ID, EMPTY_TERRITORY_FEATURE_COLLECTION);
      setGeoJsonSourceData(map.current, GRID1_SELECTED_SOURCE_ID, EMPTY_GRID_POCKET_FEATURE_COLLECTION);
      setGeoJsonSourceData(map.current, GRID1_SELECTION_PREVIEW_SOURCE_ID, EMPTY_SELECTION_PREVIEW_FEATURE_COLLECTION);
      if (map.current.getLayer(GRID1_FILL_LAYER_ID)) {
        map.current.setPaintProperty(
          GRID1_FILL_LAYER_ID,
          'fill-color',
          buildEmployeeColorMatchExpression(employeeColors)
        );
        map.current.setFilter(GRID1_FILL_LAYER_ID, null);
      }
      setAssignedGridPockets(EMPTY_GRID_POCKET_FEATURE_COLLECTION);
      setEmployeeColors({});
      setEmployeeMetrics([]);
      setSelectedPocket(null);
      setDrawerEmployeeId('');
      setHoveredPocketId('');
      setActiveAssignmentBranchId('');
      setActiveAllocationLevelMeters(0);
      setAssignmentTolerance(DEFAULT_ASSIGNMENT_TOLERANCE);
      setAllocationFallbackApplied(false);
      setAllocationFallbackReason(null);
      setAllocationRepairLoading(false);
      clearManagerSelection();
      return;
    }

    const requestId = employeeTerritoryRequestCounterRef.current + 1;
    employeeTerritoryRequestCounterRef.current = requestId;

    const normalizedRequestedLevel = Number.isFinite(Number(requestedLevelMeters)) && Number(requestedLevelMeters) > 0
      ? Math.round(Number(requestedLevelMeters))
      : undefined;
    setEmployeeTerritoryLoading(true);
    setEmployeeTerritoryEmptyState(null);

    try {
      const payload = await api.getBranchTerritories(trimmedBranchId, {
        useExistingTerritoriesOnly: true,
        level_m: normalizedRequestedLevel
      }) as EmployeeTerritoryAssignmentResponse;
      const fallbackApplied = Boolean(payload.fallbackApplied);
      const fallbackReason = fallbackApplied
        ? String(payload.fallbackReason || 'Persisted branch territories are invalid or missing. Operational preview is shown.')
        : null;

      const pockets = normalizePocketFeatureCollection(
        payload.pockets || EMPTY_TERRITORY_FEATURE_COLLECTION
      );

      if (
        !map.current
        || !map.current.isStyleLoaded()
        || employeeTerritoryRequestCounterRef.current !== requestId
      ) {
        return;
      }

      const mapInstance = map.current;
      const mergedTerritories = payload.territories || EMPTY_TERRITORY_FEATURE_COLLECTION;
      const tolerance = Number.isFinite(Number(payload.tolerance))
        ? Number(payload.tolerance)
        : DEFAULT_ASSIGNMENT_TOLERANCE;
      const payloadLevelMeters = Number(payload.geometryAlignment?.assignmentLevelMeters || 0);
      const featureLevelMeters = Number(pockets.features[0]?.properties?.level_m || 0);
      const assignmentLevelMeters = Number.isFinite(payloadLevelMeters) && payloadLevelMeters > 0
        ? Math.round(payloadLevelMeters)
        : (Number.isFinite(featureLevelMeters) && featureLevelMeters > 0
          ? Math.round(featureLevelMeters)
          : (normalizedRequestedLevel || 0));

      ensureTerritoryLayers(mapInstance);
      setGeoJsonSourceData(
        mapInstance,
        GRID1_SOURCE_ID,
        pockets
      );
      setGeoJsonSourceData(
        mapInstance,
        TERRITORY_SOURCE_ID,
        mergedTerritories as GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>
      );
      setGeoJsonSourceData(mapInstance, GRID1_SELECTED_SOURCE_ID, EMPTY_GRID_POCKET_FEATURE_COLLECTION);
      setGeoJsonSourceData(mapInstance, GRID1_SELECTION_PREVIEW_SOURCE_ID, EMPTY_SELECTION_PREVIEW_FEATURE_COLLECTION);

      if (mapInstance.getLayer(GRID1_FILL_LAYER_ID)) {
        mapInstance.setPaintProperty(
          GRID1_FILL_LAYER_ID,
          'fill-color',
          buildEmployeeColorMatchExpression(employeeColors)
        );
        mapInstance.setFilter(GRID1_FILL_LAYER_ID, null);
      }
      applyPocketLayoutVisibility(mapInstance, showPocketLayout);
      enforceTerritoryLayerStackOrder(mapInstance);

      setAssignedGridPockets(pockets);
      setEmployeeColors((previousColors) =>
        buildEmployeeColorStateFromPockets(pockets, previousColors)
      );
      setEmployeeMetrics(buildEmployeeMetrics(pockets, tolerance));
      const selectedPocketKey = String(
        selectedPocket?.pocket_id || selectedPocket?.grid_cell_id || ''
      ).trim();
      if (selectedPocketKey) {
        const refreshedInspectedFeature = pockets.features.find(
          (feature) => getPocketSelectionKey(feature) === selectedPocketKey
        );
        setSelectedPocket(
          refreshedInspectedFeature
            ? buildSelectedPocketPayload(refreshedInspectedFeature)
            : null
        );
      } else {
        setSelectedPocket(null);
        setDrawerEmployeeId('');
      }
      setAssignmentTolerance(tolerance);
      setActiveAssignmentBranchId(trimmedBranchId);
      setActiveAllocationLevelMeters(assignmentLevelMeters);
      setAllocationFallbackApplied(fallbackApplied);
      setAllocationFallbackReason(fallbackReason);
      setAllocationRepairLoading(false);
      if (pockets.features.length === 0) {
        setEmployeeTerritoryEmptyState({
          branchId: trimmedBranchId,
          levelMeters: Number(
            normalizedRequestedLevel
            || assignmentLevelMeters
            || allocationLevel
            || 5000
          )
        });
      } else {
        setEmployeeTerritoryEmptyState(null);
      }
      clearManagerSelection();
    // --- ORIGINAL BACKUP ---
    // } catch (error) {
    //   if (employeeTerritoryRequestCounterRef.current !== requestId) {
    //     return;
    //   }
    //
    //   if (map.current && map.current.isStyleLoaded()) {
    //     setGeoJsonSourceData(map.current, GRID1_SOURCE_ID, EMPTY_TERRITORY_FEATURE_COLLECTION);
    //     setGeoJsonSourceData(map.current, GRID1_SELECTED_SOURCE_ID, EMPTY_GRID_POCKET_FEATURE_COLLECTION);
    //     setGeoJsonSourceData(map.current, GRID1_SELECTION_PREVIEW_SOURCE_ID, EMPTY_SELECTION_PREVIEW_FEATURE_COLLECTION);
    //     if (map.current.getLayer(GRID1_FILL_LAYER_ID)) {
    //       map.current.setPaintProperty(
    //         GRID1_FILL_LAYER_ID,
    //         'fill-color',
    //         buildEmployeeColorMatchExpression(employeeColors)
    //       );
    //       map.current.setFilter(GRID1_FILL_LAYER_ID, null);
    //     }
    //   }
    //   setAssignedGridPockets(EMPTY_GRID_POCKET_FEATURE_COLLECTION);
    //   setEmployeeColors({});
    //   setBranchEmployees([]);
    //   setBranchTeamEmployees([]);
    //   setEmployeeMetrics([]);
    //   setSelectedPocket(null);
    //   setDrawerEmployeeId('');
    //   setHoveredPocketId('');
    //   setActiveAssignmentBranchId('');
    //   setActiveAllocationLevelMeters(0);
    //   setEmployeeTerritoryEmptyState(null);
    //   setAssignmentTolerance(DEFAULT_ASSIGNMENT_TOLERANCE);
    //   setEmployeeFormState(createEmptyBranchEmployeeFormState());
    //   setEmployeeFormError(null);
    //   clearManagerSelection();
    //
    //   const message = error instanceof Error
    //     ? error.message
    //     : 'Failed to assign employee territories';
    //   setTerritoryError(message);
    // } finally {
    } catch (error) {
      if (employeeTerritoryRequestCounterRef.current !== requestId) {
        return;
      }

      const normalizedError = error as Error & {
        status?: number;
        originalError?: {
          response?: {
            status?: number;
          };
        };
      };
      const statusCode = Number(
        normalizedError?.status
        ?? normalizedError?.originalError?.response?.status
        ?? 0
      );
      const message = error instanceof Error
        ? error.message
        : 'Failed to assign employee territories';

      if (statusCode === 429) {
        setTerritoryError(message);
        return;
      }

      if (map.current && map.current.isStyleLoaded()) {
        setGeoJsonSourceData(map.current, GRID1_SOURCE_ID, EMPTY_TERRITORY_FEATURE_COLLECTION);
        setGeoJsonSourceData(map.current, GRID1_SELECTED_SOURCE_ID, EMPTY_GRID_POCKET_FEATURE_COLLECTION);
        setGeoJsonSourceData(map.current, GRID1_SELECTION_PREVIEW_SOURCE_ID, EMPTY_SELECTION_PREVIEW_FEATURE_COLLECTION);
        if (map.current.getLayer(GRID1_FILL_LAYER_ID)) {
          map.current.setPaintProperty(
            GRID1_FILL_LAYER_ID,
            'fill-color',
            buildEmployeeColorMatchExpression(employeeColors)
          );
          map.current.setFilter(GRID1_FILL_LAYER_ID, null);
        }
      }
      setAssignedGridPockets(EMPTY_GRID_POCKET_FEATURE_COLLECTION);
      setEmployeeColors({});
      setBranchEmployees([]);
      setBranchTeamEmployees([]);
      setEmployeeMetrics([]);
      setSelectedPocket(null);
      setDrawerEmployeeId('');
      setHoveredPocketId('');
      setActiveAssignmentBranchId('');
      setActiveAllocationLevelMeters(0);
      setEmployeeTerritoryEmptyState(null);
      setAllocationFallbackApplied(false);
      setAllocationFallbackReason(null);
      setAllocationRepairLoading(false);
      setAssignmentTolerance(DEFAULT_ASSIGNMENT_TOLERANCE);
      setEmployeeFormState(createEmptyBranchEmployeeFormState());
      setEmployeeFormError(null);
      clearManagerSelection();
      setTerritoryError(message);
    } finally {
      if (employeeTerritoryRequestCounterRef.current === requestId) {
        setEmployeeTerritoryLoading(false);
      }
    }
  };

  const loadTerritoryVisualization = async (
    mode: TerritoryMode,
    branchIds: string[],
    customerView: TerritoryCustomerView,
    options?: {
      showLoader?: boolean;
    }
  ) => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    if (!Array.isArray(branchIds) || branchIds.length === 0) {
      setTerritoryError('Select a branch to load territory visualization.');
      clearTerritoryVisualization();
      return;
    }

    const showLoader = options?.showLoader !== false;
    const requestId = territoryRequestCounterRef.current + 1;
    territoryRequestCounterRef.current = requestId;

    if (showLoader) {
      setTerritoryLoading(true);
    }
    setTerritoryError(null);

    try {
      const payload = await api.getTerritoryVisualization({
        mode,
        branchIds: branchIds.length > 0 ? branchIds : undefined,
        customerView
      }) as TerritoryVisualizationResponse;

      if (!map.current || territoryRequestCounterRef.current !== requestId) return;

      const mapInstance = map.current;
      const selectedIds = (payload.selectedBranchIds || []).map((id) => String(id));
      const selectedBranchIdSet = new Set(selectedIds);
      const selectedDashboardBranchId = String(selectedIds[0] || branchIds[0] || '').trim();
      const filteredCustomers: GeoJSON.FeatureCollection<GeoJSON.Point> = {
        type: 'FeatureCollection',
        features: (payload.customers?.features || [])
          .filter((feature) =>
            selectedBranchIdSet.has(String(feature.properties?.branchId ?? ''))
          )
          .map((feature) => {
            const properties = feature.properties || {};
            const existingBranchId = String(
              properties.existingBranchId
              ?? properties.branchId
              ?? ''
            ).trim();
            const isSelectedBranchCustomer = (
              selectedDashboardBranchId
              && existingBranchId === selectedDashboardBranchId
            ) ? 1 : 0;

            return {
              ...feature,
              properties: {
                ...properties,
                existingBranchId,
                isSelectedBranchCustomer
              }
            };
          })
      };
      ensureTerritoryLayers(mapInstance);
      setGeoJsonSourceData(mapInstance, TERRITORY_SOURCE_ID, payload.territories);
      setGeoJsonSourceData(mapInstance, TERRITORY_POINTS_SOURCE_ID, EMPTY_TERRITORY_POINT_FEATURE_COLLECTION);
      setGeoJsonSourceData(mapInstance, TERRITORY_CUSTOMERS_SOURCE_ID, filteredCustomers);
      setGeoJsonSourceData(mapInstance, TERRITORY_SELECTED_BRANCHES_SOURCE_ID, payload.branches as GeoJSON.FeatureCollection<GeoJSON.Point>);

      if (mapInstance.getLayer(TERRITORY_FILL_LAYER_ID)) {
        mapInstance.moveLayer(TERRITORY_FILL_LAYER_ID, STATE_BORDERS_LAYER_ID);
      }
      if (mapInstance.getLayer(TERRITORY_LINE_LAYER_ID)) {
        mapInstance.moveLayer(TERRITORY_LINE_LAYER_ID, STATE_BORDERS_LAYER_ID);
      }
      if (mapInstance.getLayer(TERRITORY_CUSTOMERS_LAYER_ID)) {
        mapInstance.moveLayer(TERRITORY_CUSTOMERS_LAYER_ID);
        mapInstance.setLayoutProperty(
          TERRITORY_CUSTOMERS_LAYER_ID,
          'visibility',
          showTerritoryCustomers ? 'visible' : 'none'
        );
      }
      if (mapInstance.getLayer(TERRITORY_SELECTED_BRANCHES_LAYER_ID)) {
        mapInstance.moveLayer(TERRITORY_SELECTED_BRANCHES_LAYER_ID);
      }
      if (mapInstance.getLayer(BRANCH_MARKERS_LAYER_ID)) {
        mapInstance.moveLayer(BRANCH_MARKERS_LAYER_ID);
      }
      enforceTerritoryLayerStackOrder(mapInstance);

      if (Array.isArray(payload.availableBranches) && payload.availableBranches.length > 0) {
        const customerCountByBranchId = new globalThis.Map<string, number>(
          payload.availableBranches.map((branch) => [
            String(branch.id || ''),
            Number(branch.customerCount || 0)
          ])
        );
        setTerritoryBranchOptions((previousOptions) => {
          if (previousOptions.length === 0) {
            return payload.availableBranches;
          }
          return previousOptions.map((option) => ({
            ...option,
            customerCount: customerCountByBranchId.has(option.id)
              ? Number(customerCountByBranchId.get(option.id) || 0)
              : option.customerCount
          }));
        });
      }
      setTerritorySummary(payload.summary || null);

      const responseSelectedIds = selectedIds.slice(0, MAX_TERRITORY_BRANCHES);
      if (!hasSameIds(responseSelectedIds, selectedTerritoryBranchIds)) {
        setSelectedTerritoryBranchIds(responseSelectedIds);
      }

      const assignmentBranchId = responseSelectedIds[0] || selectedIds[0] || branchIds[0] || '';
      if (assignmentBranchId) {
        void loadEmployeeTerritoryAssignment(assignmentBranchId, allocationLevel);
      } else {
        setGeoJsonSourceData(mapInstance, GRID1_SOURCE_ID, EMPTY_TERRITORY_FEATURE_COLLECTION);
        if (mapInstance.getLayer(GRID1_FILL_LAYER_ID)) {
          mapInstance.setPaintProperty(
            GRID1_FILL_LAYER_ID,
            'fill-color',
            buildEmployeeColorMatchExpression(employeeColors)
          );
          mapInstance.setFilter(GRID1_FILL_LAYER_ID, null);
        }
      }
    // --- ORIGINAL BACKUP ---
    // } catch (error) {
    //   if (territoryRequestCounterRef.current !== requestId) return;
    //
    //   const message = error instanceof Error ? error.message : 'Failed to load territory visualization';
    //   setTerritoryError(message);
    //   setTerritorySummary(null);
    //   clearTerritoryVisualization();
    // } finally {
    } catch (error) {
      if (territoryRequestCounterRef.current !== requestId) return;

      const normalizedError = error as Error & {
        status?: number;
        originalError?: {
          response?: {
            status?: number;
          };
        };
      };
      const statusCode = Number(
        normalizedError?.status
        ?? normalizedError?.originalError?.response?.status
        ?? 0
      );
      const message = error instanceof Error ? error.message : 'Failed to load territory visualization';
      setTerritoryError(message);

      if (statusCode === 429) {
        return;
      }

      setTerritorySummary(null);
      clearTerritoryVisualization();
    } finally {
      if (showLoader && territoryRequestCounterRef.current === requestId) {
        setTerritoryLoading(false);
      }
    }
  };

  const loadTerritoryBranchCatalog = useCallback(async () => {
    if (branchCatalogLoadedRef.current && territoryBranchOptions.length > 0) {
      return;
    }

    setBranchOptionsLoading(true);
    try {
      const response = await api.getBranches({ limit: 500, offset: 0 });
      const rawCandidate = response?.branches ?? response?.data ?? response;
      const rawBranches = Array.isArray(rawCandidate)
        ? rawCandidate
        : [];

      const nextOptions: TerritoryBranchOption[] = rawBranches
        .map((branch: Record<string, unknown>) => {
          const id = String(branch.id || '').trim();
          const city = String(branch.city || '').trim();
          if (!id) return null;

          return {
            id,
            city,
            customerCount: 0
          };
        })
        .filter((entry): entry is TerritoryBranchOption => Boolean(entry))
        .sort((a, b) => a.id.localeCompare(b.id));

      setTerritoryBranchOptions(nextOptions);
      branchCatalogLoadedRef.current = nextOptions.length > 0;

      const activeSelected = String(selectedTerritoryBranchIds[0] || '').trim();
      if (!activeSelected && nextOptions.length > 0) {
        const initialBranchId = nextOptions[0].id;
        setSelectedTerritoryBranchIds([initialBranchId]);
        void loadTerritoryVisualization(
          territoryMode,
          [initialBranchId],
          territoryCustomerView
        );
      }
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Failed to load branch options';
      setTerritoryError(message);
    } finally {
      setBranchOptionsLoading(false);
    }
  }, [
    selectedTerritoryBranchIds,
    territoryMode,
    territoryCustomerView,
    territoryBranchOptions.length
  ]);

  const handleTerritoryModeChange = (nextMode: TerritoryMode) => {
    setTerritoryMode(nextMode);
    const activeBranchId = String(
      selectedTerritoryBranchIds[0] || territoryBranchOptions[0]?.id || ''
    ).trim();
    if (!activeBranchId) {
      setTerritoryError('Select a branch to load territory visualization.');
      return;
    }
    if (!hasSameIds([activeBranchId], selectedTerritoryBranchIds)) {
      setSelectedTerritoryBranchIds([activeBranchId]);
    }
    void loadTerritoryVisualization(nextMode, [activeBranchId], territoryCustomerView);
  };

  const handleTerritoryCustomerViewChange = (nextCustomerView: TerritoryCustomerView) => {
    setTerritoryCustomerView(nextCustomerView);
    const activeBranchId = String(
      selectedTerritoryBranchIds[0] || territoryBranchOptions[0]?.id || ''
    ).trim();
    if (!activeBranchId) {
      setTerritoryError('Select a branch to load territory visualization.');
      return;
    }
    if (!hasSameIds([activeBranchId], selectedTerritoryBranchIds)) {
      setSelectedTerritoryBranchIds([activeBranchId]);
    }
    void loadTerritoryVisualization(territoryMode, [activeBranchId], nextCustomerView);
  };

  const handleTerritoryBranchChange = (nextBranchIds: string[]) => {
    if (nextBranchIds.length > MAX_TERRITORY_BRANCHES) {
      setTerritoryError(`Select up to ${MAX_TERRITORY_BRANCHES} branches only.`);
      return;
    }

    setTerritoryError(null);
    setSelectedTerritoryBranchIds(nextBranchIds);
    if (nextBranchIds.length === 0) {
      clearTerritoryVisualization();
      return;
    }
    void loadTerritoryVisualization(territoryMode, nextBranchIds, territoryCustomerView, {
      showLoader: false
    });
  };

  const resetBranchEmployeeForm = () => {
    setEmployeeFormState(createEmptyBranchEmployeeFormState());
    setEmployeeFormError(null);
  };

  const handleEditBranchEmployee = (employee: BranchEmployee) => {
    setEmployeeFormState({
      id: employee.id,
      employeeCode: employee.employeeCode,
      name: employee.name,
      colorCode: normalizeHexColor(employee.colorCode, DEFAULT_EMPLOYEE_COLOR_PALETTE[0]),
      maxCapacity: employee.maxCapacity === null ? '' : String(employee.maxCapacity),
      isActive: employee.isActive
    });
    setEmployeeFormError(null);
    setManageTeamExpanded(true);
  };

  const handleSaveBranchEmployee = async () => {
    const branchId = String(employeeContextBranchId || '').trim();
    if (!branchId) {
      setEmployeeFormError('Select a branch before managing employees.');
      return;
    }

    const employeeCode = String(employeeFormState.employeeCode || '').trim();
    const employeeName = String(employeeFormState.name || '').trim();
    const colorCode = normalizeHexColor(
      employeeFormState.colorCode,
      DEFAULT_EMPLOYEE_COLOR_PALETTE[0]
    );

    if (!employeeCode) {
      setEmployeeFormError('Employee ID is required.');
      return;
    }
    if (!employeeName) {
      setEmployeeFormError('Employee name is required.');
      return;
    }

    const maxCapacityValue = String(employeeFormState.maxCapacity || '').trim();
    const parsedMaxCapacity = maxCapacityValue === ''
      ? null
      : Number.parseInt(maxCapacityValue, 10);
    if (
      maxCapacityValue !== ''
      && (!Number.isInteger(parsedMaxCapacity) || Number(parsedMaxCapacity) < 0)
    ) {
      setEmployeeFormError('Max Capacity must be a non-negative integer.');
      return;
    }

    setEmployeeFormSaving(true);
    setEmployeeFormError(null);
    try {
      if (employeeFormState.id) {
        await api.updateEmployee(employeeFormState.id, {
          employee_id: employeeCode,
          name: employeeName,
          color_code: colorCode,
          max_capacity: parsedMaxCapacity,
          is_active: employeeFormState.isActive
        });
      } else {
        await api.createEmployee({
          branch_id: branchId,
          employee_id: employeeCode,
          name: employeeName,
          color_code: colorCode,
          max_capacity: parsedMaxCapacity,
          is_active: employeeFormState.isActive
        });
      }

      await loadBranchEmployees(branchId);
      resetBranchEmployeeForm();
    } catch (error) {
      setEmployeeFormError(
        error instanceof Error ? error.message : 'Failed to save employee.'
      );
    } finally {
      setEmployeeFormSaving(false);
    }
  };

  const handleDeactivateBranchEmployee = async (employeeId: string) => {
    const normalizedEmployeeId = String(employeeId || '').trim();
    const branchId = String(employeeContextBranchId || '').trim();
    if (!normalizedEmployeeId || !branchId || employeeRowActionId) {
      return;
    }

    setEmployeeRowActionId(normalizedEmployeeId);
    setEmployeeFormError(null);
    try {
      await api.deleteEmployee(normalizedEmployeeId);
      await loadBranchEmployees(branchId);
      if (employeeFormState.id === normalizedEmployeeId) {
        resetBranchEmployeeForm();
      }
    } catch (error) {
      setEmployeeFormError(
        error instanceof Error ? error.message : 'Failed to deactivate employee.'
      );
    } finally {
      setEmployeeRowActionId('');
    }
  };

  const handleReactivateBranchEmployee = async (employee: BranchEmployee) => {
    const branchId = String(employeeContextBranchId || '').trim();
    if (!employee.id || !branchId || employeeRowActionId) {
      return;
    }

    setEmployeeRowActionId(employee.id);
    setEmployeeFormError(null);
    try {
      await api.updateEmployee(employee.id, {
        is_active: true
      });
      await loadBranchEmployees(branchId);
    } catch (error) {
      setEmployeeFormError(
        error instanceof Error ? error.message : 'Failed to activate employee.'
      );
    } finally {
      setEmployeeRowActionId('');
    }
  };

  // Placeholder for nearest branch lookup.
  // Called from map click handler to preserve expected interaction path.
  const findNearestBranch = useCallback((lat: number, lng: number) => {
    // TODO: wire this to backend nearest branch API in next phase.
    console.debug('Nearest branch lookup pending API integration:', { lat, lng });
  }, []);

  useEffect(() => {
    if (!mapContainer.current) return;

    map.current = new Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {},
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: {
              'background-color': '#0F172A'
            }
          }
        ]
      },
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      maxBounds: DEFAULT_BOUNDS,
      maxZoom: 18,
      minZoom: 3
    });

    map.current.addControl(new NavigationControl(), 'bottom-right');
    map.current.addControl(new ScaleControl(), 'bottom-left');

    const handleMapResize = () => {
      if (!map.current) return;
      map.current.resize();
    };

    window.addEventListener('resize', handleMapResize);
    window.addEventListener('dashboard-layout-resize', handleMapResize);
    window.setTimeout(handleMapResize, 0);

    map.current.on('error', (event) => {
      if (!map.current) return;

      const typedEvent = event as {
        error?: unknown;
        sourceId?: string;
        sourceType?: string;
        tile?: unknown;
      };

      const statusMessage = buildMapStatusMessage(
        'Map rendering error',
        map.current,
        {
          styleLoaded: map.current.isStyleLoaded(),
          sourceId: typedEvent.sourceId,
          sourceType: typedEvent.sourceType,
          tile: typedEvent.tile
        },
        typedEvent.error ?? event
      );

      console.error('Map render error:', typedEvent.error ?? event);
      setMapLoaded(false);
      setMapError(statusMessage);
    });

    const updateGridOverlay = () => {
      if (!map.current || !map.current.isStyleLoaded()) return;

      const zoom = map.current.getZoom();
      const selectedGridLevelIds = selectedGridLevelsRef.current;
      const activeLevelMeters = Math.round(Number(activeAllocationLevelMetersRef.current || 0));
      const activeBranchId = String(activeAssignmentBranchIdRef.current || '').trim();
      const hasAuthoritativeOperationalGrid = Boolean(
        showPocketLayoutRef.current
        && activeBranchId
        && authoritativePocketCountRef.current > 0
        && (activeLevelMeters === 5000 || activeLevelMeters === 1000)
      );
      const bounds = map.current.getBounds();
      const viewportBounds = [
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth()
      ] as [number, number, number, number];
      const visibleGridLabels: string[] = [];

      // --- ORIGINAL BACKUP ---
      // KM_GRID_LEVELS.forEach(async (gridLevel) => {
      //   const sourceId = getGridSourceId(gridLevel.id);
      //   const layerId = getGridLayerId(gridLevel.id);
      //   const source = map.current?.getSource(sourceId) as {
      //     setData: (data: GeoJSON.FeatureCollection<GeoJSON.LineString>) => void;
      //   } | undefined;
      //
      //   const gridLevelMeters = Math.round(gridLevel.stepKm * 1000);
      //   const isFinerThanActiveAllocation =
      //     activeLevelMeters > 0 && gridLevelMeters < activeLevelMeters;
      //   const shouldRender = (
      //     !hideReferenceGrid
      //     && !isFinerThanActiveAllocation
      //     && selectedGridLevelIds.includes(gridLevel.id)
      //     && zoom >= gridLevel.minZoom
      //   );
      //
      //   if (shouldRender && source?.setData) {
      //     try {
      //       const params = new URLSearchParams({
      //         minLon: minLon.toString(),
      //         maxLon: maxLon.toString(),
      //         minLat: minLat.toString(),
      //         maxLat: maxLat.toString(),
      //         level_m: gridLevelMeters.toString(),
      //         branch_id: activeBranchId
      //       });
      //
      //       const response = await fetch(`/api/v1/pockets?${params}`);
      //       if (response.ok) {
      //         const data = await response.json();
      //         
      //         // If this is the active allocation level, update the main interaction source too
      //         if (activeLevelMeters > 0 && gridLevelMeters === activeLevelMeters) {
      //           setAssignedGridPockets(data);
      //         } else {
      //           source.setData(data);
      //         }
      //       }
      //     } catch (error) {
      //       console.warn(`Failed to fetch grid cells for level ${gridLevel.id}`, error);
      //     }
      //
      //     if (map.current?.getLayer(layerId)) {
      //       map.current.setLayoutProperty(layerId, 'visibility', 'visible');
      //     }
      //     visibleGridLabels.push(gridLevel.label);
      //   } else {
      //     if (source?.setData) {
      //       source.setData(EMPTY_GRID_FEATURE_COLLECTION);
      //     }
      //     if (map.current?.getLayer(layerId)) {
      //       map.current.setLayoutProperty(layerId, 'visibility', 'none');
      //     }
      //   }
      // });

      // --- ORIGINAL BACKUP ---
      // if (hideReferenceGrid) {
      //   const activeLevelLabel = formatGridLevelMetersLabel(activeLevelMeters);
      //   setCurrentGridLabel(
      //     activeLevelLabel
      //       ? `Allocation ${activeLevelLabel} (authoritative)`
      //       : 'Allocation grid (authoritative)'
      //   );
      //   return;
      // }
      //
      // setCurrentGridLabel(
      //   visibleGridLabels.length > 0
      //     ? visibleGridLabels.join(', ')
      //     : buildGridOverlayLabel(selectedGridLevelIds, zoom)
      // );
      KM_GRID_LEVELS.forEach((gridLevel) => {
        const sourceId = getGridSourceId(gridLevel.id);
        const layerId = getGridLayerId(gridLevel.id);
        const source = map.current?.getSource(sourceId) as {
          setData: (data: GeoJSON.FeatureCollection<GeoJSON.LineString>) => void;
        } | undefined;
        const gridLevelMeters = Math.round(gridLevel.stepKm * 1000);
        const isMacroLevel = gridLevelMeters === 500000
          || gridLevelMeters === 100000
          || gridLevelMeters === 20000;
        const isSelected = selectedGridLevelIds.includes(gridLevel.id);
        const isVisibleAtCurrentZoom = zoom >= gridLevel.minZoom;
        const isOperationalLevel = !isMacroLevel;
        const isActiveOperationalLevel = isOperationalLevel
          && activeLevelMeters > 0
          && gridLevelMeters === activeLevelMeters;
        const shouldRenderMacroGrid = isMacroLevel && isSelected && isVisibleAtCurrentZoom;
        const shouldRenderOperationalReferenceGrid = isOperationalLevel
          && isSelected
          && isVisibleAtCurrentZoom
          && (
            !hasAuthoritativeOperationalGrid
            || !isActiveOperationalLevel
          );
        const shouldRenderGrid = shouldRenderMacroGrid || shouldRenderOperationalReferenceGrid;

        if (shouldRenderGrid && source?.setData) {
          source.setData(buildGridGeoJsonKm(viewportBounds, gridLevel.stepKm));
          if (map.current?.getLayer(layerId)) {
            map.current.setLayoutProperty(layerId, 'visibility', 'visible');
          }
          visibleGridLabels.push(gridLevel.label);
          return;
        }

        if (source?.setData) {
          source.setData(EMPTY_GRID_FEATURE_COLLECTION);
        }
        if (map.current?.getLayer(layerId)) {
          map.current.setLayoutProperty(layerId, 'visibility', 'none');
        }
      });

      if (hasAuthoritativeOperationalGrid) {
        const activeLevelLabel = formatGridLevelMetersLabel(activeLevelMeters);
        const authoritativeLabel = activeLevelLabel
          ? `Allocation ${activeLevelLabel} (authoritative)`
          : 'Allocation grid (authoritative)';
        setCurrentGridLabel(
          visibleGridLabels.length > 0
            ? `${authoritativeLabel}, ${visibleGridLabels.join(', ')}`
            : authoritativeLabel
        );
        return;
      }

      setCurrentGridLabel(
        visibleGridLabels.length > 0
          ? visibleGridLabels.join(', ')
          : buildGridOverlayLabel(selectedGridLevelIds, zoom)
      );
    };
    updateGridOverlayRef.current = updateGridOverlay;

    map.current.on('load', () => {
      if (!map.current) return;

      try {
        // Add India GeoJSON source
        map.current.addSource('officialIndia', {
          type: 'geojson',
          data: OFFICIAL_INDIA_GEOJSON_URL
        });

        // Add India fill layer with bright color
        map.current.addLayer({
          id: 'india-bg',
          type: 'fill',
          source: 'officialIndia',
          paint: {
            'fill-color': '#93C5FD',
            'fill-opacity': 0.6
          }
        });

        map.current.addSource(STATE_BORDERS_SOURCE_ID, {
          type: 'geojson',
          data: STATE_BORDERS_GEOJSON_URL
        });

        KM_GRID_LEVELS.forEach((gridLevel) => {
          const sourceId = getGridSourceId(gridLevel.id);
          const layerId = getGridLayerId(gridLevel.id);

          map.current?.addSource(sourceId, {
            type: 'geojson',
            data: EMPTY_GRID_FEATURE_COLLECTION
          });

          map.current?.addLayer({
            id: layerId,
            type: 'line',
            source: sourceId,
            layout: {
              visibility: 'none'
            },
            paint: {
              'line-color': dashboardGridLevelColorsRef.current[gridLevel.id] || gridLevel.color,
              'line-width': gridLevel.width,
              'line-opacity': resolveGridLayerOpacity(gridLevel.id, gridLevel.opacity)
            }
          });
        });

        map.current.addLayer({
          id: STATE_BORDERS_LAYER_ID,
          type: 'line',
          source: STATE_BORDERS_SOURCE_ID,
          layout: {
            'line-join': 'round',
            'line-cap': 'round'
          },
          paint: {
            'line-color': '#E2E8F0',
            'line-width': 1.3,
            'line-opacity': 0.9
          }
        });

        // Add India borders layer with bright contrasting color
        map.current.addLayer({
          id: 'india-borders',
          type: 'line',
          source: 'officialIndia',
          paint: {
            'line-color': '#FDE047',
            'line-width': 4,
            'line-opacity': 1
          }
        });

        void addBranchMarkers();
        ensureTerritoryLayers(map.current);
        void loadTerritoryBranchCatalog();

        // Fit map to India bounds
        const bounds = [
          [68.176645, 7.965535],
          [97.402561, 35.49401]
        ] as [[number, number], [number, number]];

        map.current.fitBounds(bounds, {
          padding: 50,
          duration: 1000
        });

        map.current.once('idle', () => {
          if (!map.current) return;

          const hasIndiaLayers =
            Boolean(map.current.getLayer('india-bg')) &&
            Boolean(map.current.getLayer('india-borders'));
          const hasStateBordersLayer = Boolean(map.current.getLayer(STATE_BORDERS_LAYER_ID));
          const hasGridLayers = KM_GRID_LEVELS.every(
            (gridLevel) => Boolean(map.current?.getLayer(getGridLayerId(gridLevel.id)))
          );

          if (!hasIndiaLayers || !hasStateBordersLayer || !hasGridLayers) {
            setMapLoaded(false);
            setMapError(buildMapStatusMessage(
              'Required map layers not available',
              map.current,
              {
                styleLoaded: map.current.isStyleLoaded(),
                hasIndiaSource: Boolean(map.current.getSource('officialIndia')),
                hasIndiaFillLayer: Boolean(map.current.getLayer('india-bg')),
                hasIndiaBorderLayer: Boolean(map.current.getLayer('india-borders')),
                hasStateBorderSource: Boolean(map.current.getSource(STATE_BORDERS_SOURCE_ID)),
                hasStateBorderLayer: hasStateBordersLayer,
                hasGridLayers,
                selectedGridLevels: selectedGridLevelsRef.current
              }
            ));
            return;
          }

          const visibleIndia = map.current.queryRenderedFeatures(undefined, {
            layers: ['india-bg']
          });

          let sourceFeatureCount: number | 'unavailable' = 'unavailable';
          try {
            sourceFeatureCount = map.current.querySourceFeatures('officialIndia').length;
          } catch {
            sourceFeatureCount = 'unavailable';
          }

          if (visibleIndia.length === 0) {
            setMapLoaded(false);
            setMapError(buildMapStatusMessage(
              'India polygon not visible in current view',
              map.current,
              {
                styleLoaded: map.current.isStyleLoaded(),
                renderedFeatureCount: visibleIndia.length,
                sourceFeatureCount,
                hasIndiaSource: Boolean(map.current.getSource('officialIndia')),
                hasIndiaFillLayer: Boolean(map.current.getLayer('india-bg')),
                hasIndiaBorderLayer: Boolean(map.current.getLayer('india-borders')),
                hasStateBorderLayer: Boolean(map.current.getLayer(STATE_BORDERS_LAYER_ID)),
                hasGridLayers,
                selectedGridLevels: selectedGridLevelsRef.current
              }
            ));
          }
        });
        setMapError(null);
        setMapLoaded(true);
        updateGridOverlay();
      } catch (error) {
        console.error('Error adding India map layers:', error);
        setMapLoaded(false);
        setMapError(buildMapStatusMessage('India layer failed to render', map.current, undefined, error));
      }
    });

    map.current.on('move', () => {
      if (!map.current) return;
      setCurrentZoom(map.current.getZoom());
      const center = map.current.getCenter();
      setCurrentCenter([center.lng, center.lat]);
    });
    map.current.on('moveend', updateGridOverlay);

    return () => {
      window.removeEventListener('resize', handleMapResize);
      window.removeEventListener('dashboard-layout-resize', handleMapResize);
      updateGridOverlayRef.current = () => undefined;
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const mapInstance = map.current;
    const canvas = mapInstance.getCanvas();
    canvas.style.cursor = managerOverrideEnabled ? 'crosshair' : '';

    if (managerOverrideEnabled && selectionMode === 'lasso') {
      mapInstance.doubleClickZoom.disable();
    } else {
      mapInstance.doubleClickZoom.enable();
    }

    const handleMouseDown = (event: MapMouseEvent) => {
      if (!managerOverrideEnabledRef.current || selectionModeRef.current !== 'box') {
        return;
      }

      const nativeEvent = event.originalEvent as MouseEvent;
      if (nativeEvent.button !== 0) {
        return;
      }

      setTerritoryError(null);
      boxSelectionStartRef.current = [event.lngLat.lng, event.lngLat.lat];
      isBoxSelectingRef.current = true;
      skipNextMapClickRef.current = false;
      mapInstance.dragPan.disable();
    };

    const handleMouseMove = (event: MapMouseEvent) => {
      if (!managerOverrideEnabledRef.current) {
        return;
      }

      if (selectionModeRef.current === 'box' && isBoxSelectingRef.current) {
        const start = boxSelectionStartRef.current;
        if (!start) {
          return;
        }

        const end: [number, number] = [event.lngLat.lng, event.lngLat.lat];
        const boxCoordinates = buildRectangleSelectionCoordinates(start, end);
        setSelectionPreviewData({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'Polygon',
                coordinates: [boxCoordinates]
              }
            }
          ]
        });
      }

      if (selectionModeRef.current === 'lasso' && lassoDraftCoordinates.length > 0) {
        setLassoCursorCoordinate([event.lngLat.lng, event.lngLat.lat]);
      }
    };

    const handleMouseUp = (event: MapMouseEvent) => {
      if (!managerOverrideEnabledRef.current || selectionModeRef.current !== 'box') {
        return;
      }

      if (!isBoxSelectingRef.current) {
        return;
      }

      const start = boxSelectionStartRef.current;
      const end: [number, number] = [event.lngLat.lng, event.lngLat.lat];

      isBoxSelectingRef.current = false;
      boxSelectionStartRef.current = null;
      mapInstance.dragPan.enable();

      if (!start) {
        resetSelectionPreview();
        return;
      }

      const appendToSelection = (() => {
        const native = event.originalEvent as MouseEvent;
        return native.shiftKey || native.ctrlKey || native.metaKey;
      })();

      const minDeltaThreshold = 0.000001;
      if (
        Math.abs(start[0] - end[0]) <= minDeltaThreshold
        && Math.abs(start[1] - end[1]) <= minDeltaThreshold
      ) {
        resetSelectionPreview();
        return;
      }

      const boxCoordinates = buildRectangleSelectionCoordinates(start, end);
      selectPocketsWithinPolygon(boxCoordinates, appendToSelection);
      skipNextMapClickRef.current = true;
      resetSelectionPreview();
    };

    const handleMouseLeave = () => {
      if (selectionModeRef.current === 'box' && isBoxSelectingRef.current) {
        isBoxSelectingRef.current = false;
        boxSelectionStartRef.current = null;
        if (mapInstance.dragPan) {
          mapInstance.dragPan.enable();
        }
      }
      if (selectionModeRef.current === 'lasso') {
        setLassoCursorCoordinate(null);
      }
      resetSelectionPreview();
    };

    const handleGridPocketLayerClick = (event: MapMouseEvent) => {
      const clickedFeatures = mapInstance.queryRenderedFeatures(event.point, {
        layers: [GRID1_FILL_LAYER_ID]
      });
      const clickedPocketKey = clickedFeatures
        .map((feature) => {
          const properties = feature.properties || {};
          return String(properties.pocket_id || properties.grid_cell_id || '').trim();
        })
        .find((identifier) => identifier.length > 0);
      if (!clickedPocketKey) {
        return;
      }

      const pocketFeature = assignedGridPocketsRef.current.features.find(
        (feature) => {
          const gridCellId = getPocketGridCellId(feature);
          const pocketId = getPocketId(feature);
          return gridCellId === clickedPocketKey || pocketId === clickedPocketKey;
        }
      );

      if (managerOverrideEnabledRef.current && selectionModeRef.current === 'box') {
        const appendToSelection = (() => {
          const native = event.originalEvent as MouseEvent;
          return native.shiftKey || native.ctrlKey || native.metaKey;
        })();
        const targetSelectionKey = pocketFeature
          ? getPocketSelectionKey(pocketFeature)
          : clickedPocketKey;

        if (targetSelectionKey) {
          setSelectedPocketIds((previousIds) => {
            if (!appendToSelection) {
              return [targetSelectionKey];
            }
            return Array.from(new Set([...previousIds, targetSelectionKey]));
          });
        }
      }

      if (pocketFeature) {
        setSelectedPocket(buildSelectedPocketPayload(pocketFeature));
        const selectedEmployeeId = getPocketEmployeeId(pocketFeature);
        setDrawerEmployeeId(selectedEmployeeId === 'unassigned' ? '' : selectedEmployeeId);
        setIsDrawerOpen(true);
        return;
      }

      const rawProperties = clickedFeatures[0]?.properties || {};
      const fallbackEmployeeId = String(rawProperties.employee_id || 'unassigned').trim() || 'unassigned';
      const fallbackColor = normalizeHexColor(
        fallbackEmployeeId !== 'unassigned'
          ? (branchEmployeeMap.get(fallbackEmployeeId)?.colorCode || '')
          : getRawPocketColor(rawProperties),
        GRID1_FALLBACK_COLOR
      );
      setSelectedPocket({
        branch_id: String(rawProperties.branch_id || activeAssignmentBranchId || '').trim(),
        grid_cell_id: String(rawProperties.grid_cell_id || clickedPocketKey).trim(),
        pocket_id: String(rawProperties.pocket_id || clickedPocketKey).trim(),
        employee_id: fallbackEmployeeId,
        color: fallbackColor,
        color_code: fallbackColor,
        customer_count: Number(rawProperties.customer_count ?? rawProperties.account_count ?? 0),
        selected_branch_customer_count: Number(
          rawProperties.selected_branch_customer_count ?? rawProperties.account_count ?? 0
        ),
        other_branch_customer_count: Number(rawProperties.other_branch_customer_count ?? 0)
      });
      setDrawerEmployeeId(fallbackEmployeeId === 'unassigned' ? '' : fallbackEmployeeId);
      setIsDrawerOpen(true);
    };

    const handleClick = (event: MapMouseEvent) => {
      if (skipNextMapClickRef.current) {
        skipNextMapClickRef.current = false;
        return;
      }

      const clickedPocketFeatures = mapInstance.queryRenderedFeatures(event.point, {
        layers: [GRID1_FILL_LAYER_ID]
      });
      const clickedGridCellId = clickedPocketFeatures
        .map((feature) => {
          const properties = feature.properties || {};
          return String(properties.pocket_id || properties.grid_cell_id || '').trim();
        })
        .find((gridCellId) => gridCellId.length > 0);

      if (!clickedGridCellId && !managerOverrideEnabledRef.current) {
        setSelectedPocket(null);
        setDrawerEmployeeId('');
      }

      if (!managerOverrideEnabledRef.current) {
        if (!clickedGridCellId) {
          findNearestBranch(event.lngLat.lat, event.lngLat.lng);
        }
        return;
      }

      if (selectionModeRef.current === 'lasso') {
        const native = event.originalEvent as MouseEvent;
        if (native.detail > 1) {
          return;
        }
        setTerritoryError(null);
        setLassoDraftCoordinates((previousCoordinates) => [
          ...previousCoordinates,
          [event.lngLat.lng, event.lngLat.lat]
        ]);
        return;
      }

      if (selectionModeRef.current === 'box' && !isBoxSelectingRef.current) {
        const clickedIds = clickedPocketFeatures
          .map((feature) => {
            const properties = feature.properties || {};
            return String(properties.pocket_id || properties.grid_cell_id || '').trim();
          })
          .filter((gridCellId) => gridCellId.length > 0);

        const appendToSelection = (() => {
          const native = event.originalEvent as MouseEvent;
          return native.shiftKey || native.ctrlKey || native.metaKey;
        })();

        setSelectedPocketIds((previousIds) => {
          if (!appendToSelection) {
            return Array.from(new Set(clickedIds));
          }
          return Array.from(new Set([...previousIds, ...clickedIds]));
        });
      }
    };

    const handleDoubleClick = (event: MapMouseEvent) => {
      if (!managerOverrideEnabledRef.current || selectionModeRef.current !== 'lasso') {
        return;
      }

      event.preventDefault();
      setTerritoryError(null);
      const appendToSelection = (() => {
        const native = event.originalEvent as MouseEvent;
        return native.shiftKey || native.ctrlKey || native.metaKey;
      })();

      setLassoDraftCoordinates((previousCoordinates) => {
        const nextCoordinates: [number, number][] = [
          ...previousCoordinates,
          [event.lngLat.lng, event.lngLat.lat]
        ];

        if (nextCoordinates.length >= 3) {
          const closedCoordinates: [number, number][] = [...nextCoordinates, nextCoordinates[0]];
          selectPocketsWithinPolygon(closedCoordinates, appendToSelection);
          setLassoCursorCoordinate(null);
          resetSelectionPreview();
          return [];
        }

        return nextCoordinates;
      });
    };

    mapInstance.on('mousedown', handleMouseDown);
    mapInstance.on('mousemove', handleMouseMove);
    mapInstance.on('mouseup', handleMouseUp);
    mapInstance.on('mouseleave', handleMouseLeave);
    mapInstance.on('click', GRID1_FILL_LAYER_ID, handleGridPocketLayerClick);
    mapInstance.on('click', handleClick);
    mapInstance.on('dblclick', handleDoubleClick);

    return () => {
      mapInstance.off('mousedown', handleMouseDown);
      mapInstance.off('mousemove', handleMouseMove);
      mapInstance.off('mouseup', handleMouseUp);
      mapInstance.off('mouseleave', handleMouseLeave);
      if (mapInstance.getLayer(GRID1_FILL_LAYER_ID)) {
        mapInstance.off('click', GRID1_FILL_LAYER_ID, handleGridPocketLayerClick);
      }
      mapInstance.off('click', handleClick);
      mapInstance.off('dblclick', handleDoubleClick);
      if (mapInstance.dragPan) {
        mapInstance.dragPan.enable();
      }
      mapInstance.doubleClickZoom.enable();
      canvas.style.cursor = '';
    };
  }, [
    mapLoaded,
    managerOverrideEnabled,
    selectionMode,
    lassoDraftCoordinates,
    findNearestBranch,
    buildSelectedPocketPayload,
    branchEmployeeMap,
    activeAssignmentBranchId
  ]);

  useEffect(() => {
    selectedGridLevelsRef.current = selectedGridLevels;
    const zoomForLabel = map.current ? map.current.getZoom() : DEFAULT_ZOOM;
    setCurrentGridLabel(buildGridOverlayLabel(selectedGridLevels, zoomForLabel));
    updateGridOverlayRef.current();
  }, [selectedGridLevels]);

  useEffect(() => {
    showBranchesRef.current = showBranches;
    if (!map.current) return;

    if (map.current.getLayer(BRANCH_MARKERS_LAYER_ID)) {
      map.current.setLayoutProperty(
        BRANCH_MARKERS_LAYER_ID,
        'visibility',
        showBranches && showOtherBranches ? 'visible' : 'none'
      );
    }

    if (showBranches && showOtherBranches) {
      void addBranchMarkers();
    }
  }, [showBranches, showOtherBranches, addBranchMarkers]);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    if (!showBranches || !showOtherBranches) return;

    const mapInstance = map.current;
    const handleMoveEnd = () => {
      void addBranchMarkers();
    };

    mapInstance.on('moveend', handleMoveEnd);
    return () => {
      mapInstance.off('moveend', handleMoveEnd);
    };
  }, [mapLoaded, showBranches, showOtherBranches, addBranchMarkers]);

  useEffect(() => {
    dashboardGridLevelColorsRef.current = dashboardGridLevelColors;
    applyConfiguredGridLayerColors(dashboardGridLevelColors);
  }, [dashboardGridLevelColors, mapLoaded, applyConfiguredGridLayerColors]);

  useEffect(() => {
    if (!mapLoaded) {
      return;
    }
    void loadSystemConfig();
  }, [mapLoaded, loadSystemConfig]);

  useEffect(() => {
    if (!mapLoaded) return;
    if (territoryBranchOptions.length > 0 || branchOptionsLoading) return;
    void loadTerritoryBranchCatalog();
  }, [
    mapLoaded,
    territoryBranchOptions.length,
    branchOptionsLoading,
    loadTerritoryBranchCatalog
  ]);

  useEffect(() => {
    if (!map.current || !map.current.getLayer(TERRITORY_CUSTOMERS_LAYER_ID)) return;
    map.current.setLayoutProperty(
      TERRITORY_CUSTOMERS_LAYER_ID,
      'visibility',
      showTerritoryCustomers ? 'visible' : 'none'
    );
  }, [showTerritoryCustomers, mapLoaded]);

  const employeeContextBranchId = String(
    selectedTerritoryBranchIds[0] || activeAssignmentBranchId || ''
  ).trim();
  const hasAuthoritativePocketLayout = Boolean(
    showPocketLayout
    && activeAssignmentBranchId
    && assignedGridPockets.features.length > 0
  );
  const activeAllocationLevelLabel = formatGridLevelMetersLabel(activeAllocationLevelMeters);
  const showAssignmentEmptyState = Boolean(
    employeeTerritoryEmptyState
    && !employeeTerritoryLoading
    && String(selectedTerritoryBranchIds[0] || activeAssignmentBranchId || '').trim()
  );
  const emptyStateCompactLevelLabel = formatGridLevelMetersCompactLabel(
    Number(employeeTerritoryEmptyState?.levelMeters || allocationLevel || 5000)
  );
  const assignmentLoadingLevelLabel = formatGridLevelMetersLabel(allocationLevel)
    || `${Math.round(Number(allocationLevel) || 0)} m`;
  const assignmentEmptyStateLevelLabel = emptyStateCompactLevelLabel
    || `${Math.round(Number(employeeTerritoryEmptyState?.levelMeters || allocationLevel || 5000))}m`;
  const assignmentEmptyStateMessage = `No ${assignmentEmptyStateLevelLabel} territories exist for this branch. Please navigate to the 'Batch Processing' tab and run Auto-Allocation at the ${assignmentEmptyStateLevelLabel} precision to generate them.`;

  useEffect(() => {
    if (!map.current || !mapLoaded || !map.current.isStyleLoaded()) {
      return;
    }

    // Avoid double-surface rendering: show either merged territory polygons OR authoritative pockets.
    applyTerritoryPolygonVisibility(map.current, !hasAuthoritativePocketLayout);
  }, [mapLoaded, hasAuthoritativePocketLayout]);

  useEffect(() => {
    if (!employeeContextBranchId) {
      setBranchEmployees([]);
      setBranchTeamEmployees([]);
      setEmployeeFormState(createEmptyBranchEmployeeFormState());
      setEmployeeFormError(null);
      return;
    }
    setEmployeeFormState(createEmptyBranchEmployeeFormState());
    setEmployeeFormError(null);
    void loadBranchEmployees(employeeContextBranchId);
  }, [employeeContextBranchId, loadBranchEmployees]);

  useEffect(() => {
    setEmployeeMetrics(buildEmployeeMetrics(assignedGridPockets, assignmentTolerance));
  }, [assignedGridPockets, assignmentTolerance]);

  useEffect(() => {
    if (!map.current || !mapLoaded || !map.current.isStyleLoaded()) return;

    const mapInstance = map.current;
    const renderPockets = applyEmployeeColorOverridesToPockets(assignedGridPockets);
    setGeoJsonSourceData(mapInstance, GRID1_SOURCE_ID, renderPockets);
    if (mapInstance.getLayer(GRID1_FILL_LAYER_ID)) {
      mapInstance.setPaintProperty(
        GRID1_FILL_LAYER_ID,
        'fill-color',
        buildEmployeeColorMatchExpression(employeeColors)
      );
      mapInstance.setFilter(GRID1_FILL_LAYER_ID, null);
    }
    applyPocketLayoutVisibility(mapInstance, showPocketLayout);
  }, [assignedGridPockets, employeeColors, mapLoaded, showPocketLayout]);

  useEffect(() => {
    if (!map.current || !mapLoaded || !map.current.isStyleLoaded()) return;
    if (!map.current.getLayer(GRID1_FILL_LAYER_ID)) return;
    map.current.setPaintProperty(
      GRID1_FILL_LAYER_ID,
      'fill-color',
      buildEmployeeColorMatchExpression(employeeColors)
    );
    map.current.setFilter(GRID1_FILL_LAYER_ID, null);
    applyPocketLayoutVisibility(map.current, showPocketLayout);
  }, [employeeColors, mapLoaded, showPocketLayout]);

  useEffect(() => {
    if (!map.current || !mapLoaded || !map.current.isStyleLoaded()) return;
    if (!map.current.getLayer(GRID1_HIGHLIGHT_LAYER_ID)) return;

    const highlightPocketId = String(
      hoveredPocketId
      || selectedPocket?.pocket_id
      || selectedPocket?.grid_cell_id
      || ''
    ).trim();

    map.current.setFilter(GRID1_HIGHLIGHT_LAYER_ID, [
      '==',
      ['coalesce', ['get', 'pocket_id'], ['get', 'grid_cell_id']],
      highlightPocketId
    ]);
  }, [selectedPocket, hoveredPocketId, mapLoaded]);

  useEffect(() => {
    if (!selectedPocket) {
      setDrawerEmployeeId('');
      return;
    }

    const currentEmployeeId = String(selectedPocket.employee_id || '').trim();
    if (!currentEmployeeId || currentEmployeeId === 'unassigned') {
      setDrawerEmployeeId('');
      return;
    }

    setDrawerEmployeeId(currentEmployeeId);
  }, [selectedPocket]);

  useEffect(() => {
    if (!map.current || !mapLoaded || !map.current.isStyleLoaded()) return;

    const selectedIdSet = new Set(selectedPocketIds);
    const selectedFeatures = assignedGridPockets.features.filter((feature) =>
      selectedIdSet.has(getPocketSelectionKey(feature))
    );

    setGeoJsonSourceData(map.current, GRID1_SELECTED_SOURCE_ID, {
      type: 'FeatureCollection',
      features: selectedFeatures
    } as GridPocketCollection);
  }, [assignedGridPockets, selectedPocketIds, mapLoaded]);

  useEffect(() => {
    if (!managerOverrideEnabled || selectionMode !== 'lasso' || lassoDraftCoordinates.length === 0) {
      resetSelectionPreview();
      return;
    }

    const effectiveCoordinates = lassoCursorCoordinate
      ? [...lassoDraftCoordinates, lassoCursorCoordinate]
      : [...lassoDraftCoordinates];

    if (effectiveCoordinates.length < 3) {
      resetSelectionPreview();
      return;
    }

    const closedCoordinates: [number, number][] = [...effectiveCoordinates, effectiveCoordinates[0]];
    setSelectionPreviewData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [closedCoordinates]
          }
        }
      ]
    });
  }, [
    managerOverrideEnabled,
    selectionMode,
    lassoDraftCoordinates,
    lassoCursorCoordinate
  ]);

  useEffect(() => {
    if (!managerOverrideEnabled) {
      clearManagerSelection();
    }
  }, [managerOverrideEnabled]);

  useEffect(() => {
    if (!allocationFallbackApplied) {
      return;
    }

    setManagerOverrideEnabled(false);
    setSelectionMode('box');
    setReassignEmployeeId('');
    clearManagerSelection();
  }, [allocationFallbackApplied, clearManagerSelection]);

  useEffect(() => {
    if (!map.current || !mapLoaded || !map.current.isStyleLoaded()) {
      return;
    }

    applyPocketLayoutVisibility(map.current, showPocketLayout);
    if (!showPocketLayout) {
      setManagerOverrideEnabled(false);
      setSelectedPocketIds([]);
      setLassoDraftCoordinates([]);
      setLassoCursorCoordinate(null);
      setSelectedPocket(null);
      setDrawerEmployeeId('');
      resetSelectionPreview();
    }
  }, [showPocketLayout, mapLoaded]);

  useEffect(() => {
    managerOverrideEnabledRef.current = managerOverrideEnabled;
  }, [managerOverrideEnabled]);

  useEffect(() => {
    selectionModeRef.current = selectionMode;
  }, [selectionMode]);

  useEffect(() => {
    assignedGridPocketsRef.current = assignedGridPockets;
  }, [assignedGridPockets]);

  useEffect(() => {
    activeAssignmentBranchIdRef.current = activeAssignmentBranchId;
    activeAllocationLevelMetersRef.current = activeAllocationLevelMeters;
    showPocketLayoutRef.current = showPocketLayout;
    authoritativePocketCountRef.current = assignedGridPockets.features.length;
    if (mapLoaded) {
      updateGridOverlayRef.current();
    }
  }, [
    activeAssignmentBranchId,
    activeAllocationLevelMeters,
    showPocketLayout,
    assignedGridPockets.features.length,
    mapLoaded,
    systemOrigin
  ]);

  useEffect(() => {
    setDashboardMapPanel({
      zoomLevel: currentZoom,
      center: currentCenter,
      gridOverlay: currentGridLabel,
      mapLoaded,
      mapError
    });
  }, [currentZoom, currentCenter, currentGridLabel, mapLoaded, mapError, setDashboardMapPanel]);

  useEffect(() => () => {
    resetDashboardMapPanel();
  }, [resetDashboardMapPanel]);

  const reassignableEmployeeIds = branchEmployees.map((employee) => employee.id);
  const hasActiveBranchEmployees = branchEmployees.length > 0;
  const allocationFallbackLocked = allocationFallbackApplied;

  const pocketAllocationRows = useMemo<PocketAllocationRow[]>(() => {
    const rowMap = new globalThis.Map<string, PocketAllocationRow>();

    assignedGridPockets.features.forEach((feature) => {
      const pocketId = getPocketId(feature);
      if (!pocketId) return;

      const current = rowMap.get(pocketId) || {
        pocketId,
        totalCustomers: 0,
        employeeId: getPocketEmployeeId(feature),
        color: normalizeHexColor(String(feature.properties?.color || ''), GRID1_FALLBACK_COLOR)
      };
      current.totalCustomers += getPocketCustomerCount(feature);
      if (!current.employeeId || current.employeeId === 'unassigned') {
        current.employeeId = getPocketEmployeeId(feature);
      }
      rowMap.set(pocketId, current);
    });

    return Array.from(rowMap.values()).sort((a, b) => a.pocketId.localeCompare(b.pocketId));
  }, [assignedGridPockets]);

  const handleTablePocketAssignment = async (pocketId: string, nextEmployeeId: string) => {
    const normalizedPocketId = String(pocketId || '').trim();
    const normalizedEmployeeId = String(nextEmployeeId || '').trim();
    // --- ORIGINAL BACKUP ---
    // if (
    //   !normalizedPocketId
    //   || !normalizedEmployeeId
    //   || !activeAssignmentBranchId
    //   || tableAssignLoadingPocketId
    // ) {
    if (
      allocationFallbackLocked
      || !normalizedPocketId
      || !normalizedEmployeeId
      || !activeAssignmentBranchId
      || tableAssignLoadingPocketId
    ) {
      return;
    }

    const targetColor = normalizeHexColor(
      branchEmployeeMap.get(normalizedEmployeeId)?.colorCode || '',
      GRID1_FALLBACK_COLOR
    );
    const optimisticPockets: GridPocketCollection = {
      type: 'FeatureCollection',
      features: assignedGridPockets.features.map((feature) => {
        if (getPocketId(feature) !== normalizedPocketId) {
          return feature;
        }
        // --- ORIGINAL BACKUP ---
        // return {
        //   ...feature,
        //   properties: {
        //     ...(feature.properties || {}),
        //     employee_id: normalizedEmployeeId,
        //     color: targetColor
        //   }
        // } as GridPocketFeature;
        return {
          ...feature,
          properties: withPocketColorCode(
            {
              ...(feature.properties || {}),
              employee_id: normalizedEmployeeId
            },
            targetColor
          )
        } as GridPocketFeature;
      })
    };
    setAssignedGridPockets(optimisticPockets);
    if (String(selectedPocket?.pocket_id || selectedPocket?.grid_cell_id || '').trim() === normalizedPocketId) {
      // --- ORIGINAL BACKUP ---
      // setSelectedPocket((previous: any) => previous ? ({
      //   ...previous,
      //   employee_id: normalizedEmployeeId,
      //   color: targetColor
      // }) : previous);
      setSelectedPocket((previous: any) => previous ? ({
        ...previous,
        employee_id: normalizedEmployeeId,
        color: targetColor,
        color_code: targetColor
      }) : previous);
    }
    setTableAssignLoadingPocketId(normalizedPocketId);
    setTerritoryError(null);

    try {
      await api.assignManualPocket({
        branchId: activeAssignmentBranchId,
        pocketId: normalizedPocketId,
        newEmployeeId: normalizedEmployeeId,
        level_m: allocationLevel
      });

      const response = await api.getBranchTerritories(activeAssignmentBranchId, {
        useExistingTerritoriesOnly: true,
        level_m: allocationLevel
      }) as EmployeeTerritoryAssignmentResponse;
      const fallbackApplied = Boolean(response.fallbackApplied);
      const fallbackReason = fallbackApplied
        ? String(response.fallbackReason || 'Persisted branch territories are invalid or missing. Operational preview is shown.')
        : null;
      const refreshedPockets = normalizePocketFeatureCollection(
        response.pockets || EMPTY_TERRITORY_FEATURE_COLLECTION
      );
      const refreshedTerritories = response.territories || EMPTY_TERRITORY_FEATURE_COLLECTION;
      setAssignedGridPockets(refreshedPockets);
      setAllocationFallbackApplied(fallbackApplied);
      setAllocationFallbackReason(fallbackReason);
      if (map.current && map.current.isStyleLoaded()) {
        setGeoJsonSourceData(
          map.current,
          TERRITORY_SOURCE_ID,
          refreshedTerritories as GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>
        );
      }
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Failed to persist manual assignment.';
      setTerritoryError(message);
      void loadEmployeeTerritoryAssignment(activeAssignmentBranchId, allocationLevel);
    } finally {
      setTableAssignLoadingPocketId('');
    }
  };

  const handleRepairBranchTerritories = async () => {
    const branchId = String(activeAssignmentBranchId || '').trim();
    if (!branchId || allocationRepairLoading) {
      return;
    }

    setAllocationRepairLoading(true);
    setTerritoryError(null);
    try {
      // --- ORIGINAL BACKUP ---
      // await api.runBranchTerritoryAllocation(branchId, {
      //   useExistingTerritoriesOnly: true,
      //   level_m: allocationLevel,
      //   tolerance: assignmentTolerance
      // });
      await api.runBranchTerritoryAllocation(branchId, {
        useExistingTerritoriesOnly: true,
        forceRepair: true,
        level_m: allocationLevel,
        tolerance: assignmentTolerance
      });
      await loadEmployeeTerritoryAssignment(branchId, allocationLevel);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Failed to repair persisted branch territories.';
      setTerritoryError(message);
    } finally {
      setAllocationRepairLoading(false);
    }
  };

  return (
    <Box sx={{ width: '100%', height: '100%', minHeight: 0, position: 'relative' }}>
      <Box
        ref={mapContainer}
        sx={{
          width: '100%',
          height: '100%',
          minHeight: 0,
          position: 'relative',
          '& .maplibregl-ctrl-attrib': {
            display: 'none'
          }
        }}
      />
      {employeeTerritoryLoading && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(15, 23, 42, 0.38)',
            backdropFilter: 'blur(2px)'
          }}
        >
          <Paper
            elevation={8}
            sx={{
              px: 2.25,
              py: 1.5,
              borderRadius: 2,
              backgroundColor: 'rgba(15, 23, 42, 0.92)',
              border: '1px solid rgba(56, 189, 248, 0.45)',
              color: '#E2E8F0'
            }}
          >
            <Stack direction="row" spacing={1.2} alignItems="center">
              <CircularProgress size={20} sx={{ color: '#38BDF8' }} />
              <Stack spacing={0.2}>
                <Typography sx={{ fontSize: 12, fontWeight: 700 }}>
                  {`Loading ${assignmentLoadingLevelLabel} territories...`}
                </Typography>
                <Typography sx={{ fontSize: 11, color: '#CBD5E1' }}>
                  Fetching authoritative pockets for the selected branch.
                </Typography>
              </Stack>
            </Stack>
          </Paper>
        </Box>
      )}
      {showAssignmentEmptyState && (
        <Paper
          elevation={8}
          sx={{
            position: 'absolute',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            width: { xs: 'calc(100% - 32px)', sm: 720 },
            p: 1.5,
            zIndex: 5,
            borderRadius: 2,
            backgroundColor: 'rgba(120, 53, 15, 0.94)',
            border: '1px solid rgba(251, 191, 36, 0.65)',
            color: '#FEF3C7',
            backdropFilter: 'blur(6px)'
          }}
        >
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'flex-start', sm: 'center' }}>
            <Typography sx={{ fontSize: 12, lineHeight: 1.5 }}>
              {assignmentEmptyStateMessage}
            </Typography>
            <Button
              size="small"
              variant="contained"
              onClick={() => navigate('/batch?tab=mapping')}
              sx={{
                textTransform: 'none',
                backgroundColor: '#F59E0B',
                color: '#111827',
                fontWeight: 700,
                '&:hover': { backgroundColor: '#D97706' }
              }}
            >
              Go to Batch Processing
            </Button>
          </Stack>
        </Paper>
      )}
      <Paper
        elevation={6}
        sx={{
          position: 'absolute',
          top: 16,
          right: 16,
          width: { xs: 'calc(100% - 32px)', sm: 360 },
          maxHeight: 'calc(100% - 32px)',
          overflowY: 'auto',
          p: 1.5,
          zIndex: 3,
          borderRadius: 2,
          backgroundColor: 'rgba(15, 23, 42, 0.9)',
          border: '1px solid rgba(148, 163, 184, 0.35)',
          color: '#E2E8F0',
          backdropFilter: 'blur(6px)'
        }}
      >
        <Stack spacing={1.25}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
              Voronoi Territory View
            </Typography>
            <IconButton
              size="small"
              onClick={() => setIsDrawerOpen(true)}
              sx={{ color: '#E2E8F0', border: '1px solid rgba(148, 163, 184, 0.45)' }}
              aria-label="Open Pocket Inspector"
            >
              <MenuIcon fontSize="small" />
            </IconButton>
          </Stack>

          <FormControl fullWidth size="small">
            <InputLabel id="territory-mode-label" sx={{ color: '#CBD5E1' }}>
              Mode
            </InputLabel>
            <Select
              labelId="territory-mode-label"
              value={territoryMode}
              label="Mode"
              onChange={(event) => handleTerritoryModeChange(event.target.value as TerritoryMode)}
              disabled={territoryLoading || !mapLoaded}
              sx={{
                color: '#E2E8F0',
                '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(148, 163, 184, 0.5)' },
                '& .MuiSvgIcon-root': { color: '#CBD5E1' }
              }}
            >
              {TERRITORY_MODE_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth size="small">
            <InputLabel id="territory-branch-label" sx={{ color: '#CBD5E1' }}>
              Branch
            </InputLabel>
            <Select
              labelId="territory-branch-label"
              value={selectedTerritoryBranchIds[0] || ''}
              onChange={(event) => {
                const nextBranchId = String(event.target.value || '').trim();
                handleTerritoryBranchChange(nextBranchId ? [nextBranchId] : []);
              }}
              input={<OutlinedInput label="Branch" />}
              disabled={
                territoryLoading
                || branchOptionsLoading
                || territoryBranchOptions.length === 0
                || !mapLoaded
              }
              sx={{
                color: '#E2E8F0',
                '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(148, 163, 184, 0.5)' },
                '& .MuiSvgIcon-root': { color: '#CBD5E1' }
              }}
            >
              {territoryBranchOptions.map((branch) => (
                <MenuItem key={branch.id} value={branch.id}>
                  {`${branch.id} (${branch.customerCount}) - ${branch.city}`}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {branchOptionsLoading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={14} sx={{ color: '#38BDF8' }} />
              <Typography sx={{ fontSize: 11, color: '#94A3B8' }}>Loading branches...</Typography>
            </Box>
          )}

          <FormControl fullWidth size="small">
            <InputLabel id="territory-customer-view-label" sx={{ color: '#CBD5E1' }}>
              Customer View
            </InputLabel>
            <Select
              labelId="territory-customer-view-label"
              value={territoryCustomerView}
              label="Customer View"
              onChange={(event) => handleTerritoryCustomerViewChange(event.target.value as TerritoryCustomerView)}
              disabled={territoryLoading || !mapLoaded}
              sx={{
                color: '#E2E8F0',
                '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(148, 163, 184, 0.5)' },
                '& .MuiSvgIcon-root': { color: '#CBD5E1' }
              }}
            >
              {TERRITORY_CUSTOMER_VIEW_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth size="small">
            <InputLabel id="allocation-level-label" sx={{ color: '#CBD5E1' }}>
              Allocation Precision
            </InputLabel>
            <Select
              labelId="allocation-level-label"
              value={String(allocationLevel)}
              label="Allocation Precision"
              onChange={(event) => {
                const nextLevel = Number(event.target.value);
                if (!Number.isFinite(nextLevel) || nextLevel <= 0) {
                  return;
                }
                const normalizedLevel = Math.round(nextLevel);
                setAllocationLevel(normalizedLevel);
                const branchId = String(
                  selectedTerritoryBranchIds[0] || activeAssignmentBranchId || ''
                ).trim();
                if (branchId) {
                  setTerritoryError(null);
                  void loadEmployeeTerritoryAssignment(branchId, normalizedLevel);
                }
              }}
              disabled={territoryLoading || !mapLoaded}
              sx={{
                color: '#E2E8F0',
                '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(148, 163, 184, 0.5)' },
                '& .MuiSvgIcon-root': { color: '#CBD5E1' }
              }}
            >
              {ALLOCATION_LEVEL_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={String(option.value)}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {allocationFallbackLocked && (
            <Alert
              severity="warning"
              sx={{
                py: 0.15,
                '& .MuiAlert-message': { fontSize: 11 }
              }}
            >
              {allocationFallbackReason || 'Persisted branch layout is invalid or missing. Operational preview is shown.'}
            </Alert>
          )}

          {activeAssignmentBranchId && activeAllocationLevelMeters > 0 && (
            <Alert
              severity="info"
              sx={{
                py: 0.15,
                '& .MuiAlert-message': { fontSize: 11 }
              }}
            >
              {hasAuthoritativePocketLayout
                ? `Managing authoritative ${activeAllocationLevelLabel || 'pocket'} blocks.`
                : `Active allocation resolution: ${activeAllocationLevelLabel || `${activeAllocationLevelMeters} m`}. Finer reference grids are hidden.`}
            </Alert>
          )}

          <Divider sx={{ borderColor: 'rgba(148, 163, 184, 0.35)' }} />

          <Stack spacing={1}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#F8FAFC' }}>
                Manage Branch Team
              </Typography>
              <Button
                size="small"
                variant="text"
                onClick={() => setManageTeamExpanded((previous) => !previous)}
                sx={{ textTransform: 'none', color: '#7DD3FC', minWidth: 0, p: 0.4 }}
              >
                {manageTeamExpanded ? 'Hide' : 'Open'}
              </Button>
            </Stack>

            {!branchEmployeesLoading && !hasActiveBranchEmployees && employeeContextBranchId && (
              <Alert severity="warning" sx={{ py: 0.2, '& .MuiAlert-message': { fontSize: 11 } }}>
                Please add active employees to this branch to manage pocket assignments.
              </Alert>
            )}

            {manageTeamExpanded && (
              <>
                {!employeeContextBranchId && (
                  <Typography sx={{ fontSize: 11, color: '#94A3B8' }}>
                    Select a branch to manage employees.
                  </Typography>
                )}

                {employeeContextBranchId && (
                  <>
                    {employeeFormError && (
                      <Alert severity="error" sx={{ py: 0.2, '& .MuiAlert-message': { fontSize: 11 } }}>
                        {employeeFormError}
                      </Alert>
                    )}

                    <Stack spacing={1}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Employee ID"
                        value={employeeFormState.employeeCode}
                        onChange={(event) => setEmployeeFormState((previous) => ({
                          ...previous,
                          employeeCode: event.target.value
                        }))}
                        disabled={employeeFormSaving}
                        sx={{
                          '& .MuiInputBase-input': { color: '#E2E8F0', fontSize: 12 },
                          '& .MuiInputLabel-root': { color: '#CBD5E1', fontSize: 12 },
                          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(148, 163, 184, 0.5)' }
                        }}
                      />

                      <TextField
                        fullWidth
                        size="small"
                        label="Name"
                        value={employeeFormState.name}
                        onChange={(event) => setEmployeeFormState((previous) => ({
                          ...previous,
                          name: event.target.value
                        }))}
                        disabled={employeeFormSaving}
                        sx={{
                          '& .MuiInputBase-input': { color: '#E2E8F0', fontSize: 12 },
                          '& .MuiInputLabel-root': { color: '#CBD5E1', fontSize: 12 },
                          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(148, 163, 184, 0.5)' }
                        }}
                      />

                      <Stack direction="row" spacing={1} alignItems="center">
                        <Box
                          component="label"
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.8,
                            color: '#CBD5E1',
                            fontSize: 11
                          }}
                        >
                          Color
                          <input
                            type="color"
                            value={normalizeHexColor(employeeFormState.colorCode, DEFAULT_EMPLOYEE_COLOR_PALETTE[0])}
                            disabled={employeeFormSaving}
                            onChange={(event) => setEmployeeFormState((previous) => ({
                              ...previous,
                              colorCode: normalizeHexColor(event.target.value, DEFAULT_EMPLOYEE_COLOR_PALETTE[0])
                            }))}
                            style={{
                              width: 34,
                              height: 28,
                              padding: 0,
                              border: '1px solid rgba(148, 163, 184, 0.55)',
                              borderRadius: 6,
                              background: 'transparent'
                            }}
                          />
                        </Box>

                        <TextField
                          fullWidth
                          size="small"
                          type="number"
                          label="Max Capacity"
                          value={employeeFormState.maxCapacity}
                          onChange={(event) => setEmployeeFormState((previous) => ({
                            ...previous,
                            maxCapacity: event.target.value
                          }))}
                          disabled={employeeFormSaving}
                          inputProps={{ min: 0, step: 1 }}
                          sx={{
                            '& .MuiInputBase-input': { color: '#E2E8F0', fontSize: 12 },
                            '& .MuiInputLabel-root': { color: '#CBD5E1', fontSize: 12 },
                            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(148, 163, 184, 0.5)' }
                          }}
                        />
                      </Stack>

                      <FormControlLabel
                        control={(
                          <Checkbox
                            size="small"
                            checked={employeeFormState.isActive}
                            onChange={(event) => setEmployeeFormState((previous) => ({
                              ...previous,
                              isActive: event.target.checked
                            }))}
                            disabled={employeeFormSaving}
                          />
                        )}
                        label="Active"
                        sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: 11, color: '#CBD5E1' } }}
                      />

                      <Stack direction="row" spacing={1}>
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => void handleSaveBranchEmployee()}
                          disabled={employeeFormSaving || branchEmployeesLoading}
                          sx={{
                            textTransform: 'none',
                            backgroundColor: '#0EA5E9',
                            '&:hover': { backgroundColor: '#0284C7' }
                          }}
                        >
                          {employeeFormSaving
                            ? 'Saving...'
                            : employeeFormState.id ? 'Update Employee' : 'Add Employee'}
                        </Button>
                        <Button
                          size="small"
                          variant="text"
                          onClick={resetBranchEmployeeForm}
                          disabled={employeeFormSaving}
                          sx={{ textTransform: 'none', color: '#94A3B8' }}
                        >
                          Reset
                        </Button>
                      </Stack>
                    </Stack>

                    <TableContainer sx={{ maxHeight: 190, overflowY: 'auto', border: '1px solid rgba(148, 163, 184, 0.2)', borderRadius: 1 }}>
                      <Table stickyHeader size="small" aria-label="Manage branch team">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ backgroundColor: '#0F172A', color: '#CBD5E1', fontSize: 11 }}>Employee</TableCell>
                            <TableCell sx={{ backgroundColor: '#0F172A', color: '#CBD5E1', fontSize: 11 }} align="right">Pockets</TableCell>
                            <TableCell sx={{ backgroundColor: '#0F172A', color: '#CBD5E1', fontSize: 11 }} align="right">Customers</TableCell>
                            <TableCell sx={{ backgroundColor: '#0F172A', color: '#CBD5E1', fontSize: 11 }}>Status</TableCell>
                            <TableCell sx={{ backgroundColor: '#0F172A', color: '#CBD5E1', fontSize: 11 }}>Actions</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {branchTeamEmployees.map((employee) => (
                            <TableRow key={employee.id} sx={{ '& td': { color: '#E2E8F0', borderColor: 'rgba(148, 163, 184, 0.12)' } }}>
                              <TableCell sx={{ fontSize: 11 }}>
                                <Stack direction="row" spacing={0.8} alignItems="center">
                                  <Box
                                    sx={{
                                      width: 11,
                                      height: 11,
                                      borderRadius: 0.6,
                                      border: '1px solid rgba(255, 255, 255, 0.4)',
                                      backgroundColor: normalizeHexColor(employee.colorCode, GRID1_FALLBACK_COLOR)
                                    }}
                                  />
                                  <Box>
                                    <Typography sx={{ fontSize: 11 }}>{employee.name}</Typography>
                                    <Typography sx={{ fontSize: 10, color: '#94A3B8' }}>{employee.employeeCode}</Typography>
                                  </Box>
                                </Stack>
                              </TableCell>
                              <TableCell sx={{ fontSize: 11 }} align="right">
                                {Number(employee.allocatedPocketsCount || 0)}
                              </TableCell>
                              <TableCell sx={{ fontSize: 11 }} align="right">
                                {Number(employee.allocatedCustomerCount || 0)}
                              </TableCell>
                              <TableCell sx={{ fontSize: 11 }}>
                                {employee.isActive ? 'Active' : 'Inactive'}
                              </TableCell>
                              <TableCell sx={{ fontSize: 11 }}>
                                <Stack direction="row" spacing={0.6}>
                                  <Button
                                    size="small"
                                    variant="text"
                                    onClick={() => handleEditBranchEmployee(employee)}
                                    disabled={employeeFormSaving || employeeRowActionId === employee.id}
                                    sx={{ textTransform: 'none', minWidth: 0, px: 0.6, color: '#7DD3FC' }}
                                  >
                                    Edit
                                  </Button>
                                  {employee.isActive ? (
                                    <Button
                                      size="small"
                                      variant="text"
                                      onClick={() => void handleDeactivateBranchEmployee(employee.id)}
                                      disabled={employeeFormSaving || employeeRowActionId === employee.id}
                                      sx={{ textTransform: 'none', minWidth: 0, px: 0.6, color: '#FCA5A5' }}
                                    >
                                      Deactivate
                                    </Button>
                                  ) : (
                                    <Button
                                      size="small"
                                      variant="text"
                                      onClick={() => void handleReactivateBranchEmployee(employee)}
                                      disabled={employeeFormSaving || employeeRowActionId === employee.id}
                                      sx={{ textTransform: 'none', minWidth: 0, px: 0.6, color: '#86EFAC' }}
                                    >
                                      Activate
                                    </Button>
                                  )}
                                </Stack>
                              </TableCell>
                            </TableRow>
                          ))}
                          {branchTeamEmployees.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={5} sx={{ color: '#94A3B8', fontSize: 11 }}>
                                No employees found for this branch.
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </>
                )}
              </>
            )}
          </Stack>

          <FormControlLabel
            control={(
              <Checkbox
                size="small"
                checked={showTerritoryCustomers}
                onChange={(event) => setShowTerritoryCustomers(event.target.checked)}
                disabled={!mapLoaded}
              />
            )}
            label="Show Customers (Selected Branches)"
            sx={{
              m: 0,
              '& .MuiFormControlLabel-label': { fontSize: 12, color: '#CBD5E1' }
            }}
          />

          <FormControlLabel
            control={(
              <Checkbox
                size="small"
                checked={showOtherBranches}
                onChange={(event) => setShowOtherBranches(event.target.checked)}
                disabled={!mapLoaded || !showBranches}
              />
            )}
            label="Show Other Branches"
            sx={{
              m: 0,
              '& .MuiFormControlLabel-label': { fontSize: 12, color: '#CBD5E1' }
            }}
          />

          <Divider sx={{ borderColor: 'rgba(148, 163, 184, 0.35)' }} />

          <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#F8FAFC' }}>
            Manager Override
          </Typography>

          <Stack direction="row" spacing={1} sx={{ mb: 0.2 }}>
            <Button
              size="small"
              variant={showPocketLayout ? 'contained' : 'outlined'}
              onClick={() => {
                const nextVisible = !showPocketLayout;
                setShowPocketLayout(nextVisible);
                if (
                  nextVisible
                  && employeeContextBranchId
                  && assignedGridPockets.features.length === 0
                ) {
                  setTerritoryError(null);
                  void loadEmployeeTerritoryAssignment(employeeContextBranchId, allocationLevel);
                }
              }}
              disabled={!mapLoaded || !employeeContextBranchId}
              sx={{
                textTransform: 'none',
                minWidth: 0,
                ...(showPocketLayout
                  ? {
                      backgroundColor: '#0EA5E9',
                      '&:hover': { backgroundColor: '#0284C7' }
                    }
                  : {
                      color: '#CBD5E1',
                      borderColor: 'rgba(148, 163, 184, 0.5)'
                    })
              }}
            >
              {showPocketLayout ? 'Hide Pocket Layout' : 'Show Pocket Layout'}
            </Button>
            <Button
              size="small"
              variant="text"
              disabled={!mapLoaded || !employeeContextBranchId}
              onClick={() => {
                setTerritoryError(null);
                void loadEmployeeTerritoryAssignment(employeeContextBranchId, allocationLevel);
              }}
              sx={{ textTransform: 'none', minWidth: 0, color: '#7DD3FC' }}
            >
              Reload Pocket Layout
            </Button>
            <Button
              size="small"
              variant="text"
              disabled={!mapLoaded || !employeeContextBranchId || allocationRepairLoading}
              onClick={() => void handleRepairBranchTerritories()}
              sx={{ textTransform: 'none', minWidth: 0, color: '#FCD34D' }}
            >
              {allocationRepairLoading ? 'Repairing...' : 'Repair Branch Territories'}
            </Button>
          </Stack>

          <FormControlLabel
            control={(
              <Checkbox
                size="small"
                checked={managerOverrideEnabled}
                onChange={(event) => setManagerOverrideEnabled(event.target.checked)}
                // --- ORIGINAL BACKUP ---
                // disabled={!mapLoaded || assignedGridPockets.features.length === 0 || !showPocketLayout}
                disabled={
                  !mapLoaded
                  || assignedGridPockets.features.length === 0
                  || !showPocketLayout
                  || allocationFallbackLocked
                }
              />
            )}
            label="Enable Manual Reassignment"
            sx={{
              m: 0,
              '& .MuiFormControlLabel-label': { fontSize: 12, color: '#CBD5E1' }
            }}
          />

          <FormControl fullWidth size="small">
            <InputLabel id="selection-mode-label" sx={{ color: '#CBD5E1' }}>
              Selection Tool
            </InputLabel>
            <Select
              labelId="selection-mode-label"
              value={selectionMode}
              label="Selection Tool"
              onChange={(event) => {
                setSelectionMode(event.target.value as SelectionMode);
                setLassoDraftCoordinates([]);
                setLassoCursorCoordinate(null);
                resetSelectionPreview();
              }}
              // --- ORIGINAL BACKUP ---
              // disabled={!managerOverrideEnabled || !mapLoaded}
              disabled={!managerOverrideEnabled || !mapLoaded || allocationFallbackLocked}
              sx={{
                color: '#E2E8F0',
                '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(148, 163, 184, 0.5)' },
                '& .MuiSvgIcon-root': { color: '#CBD5E1' }
              }}
            >
              <MenuItem value="box">Box Drag</MenuItem>
              <MenuItem value="lasso">Polygon Lasso</MenuItem>
            </Select>
          </FormControl>

          {managerOverrideEnabled && selectionMode === 'lasso' && (
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant="outlined"
                onClick={() => finishLassoSelection(false)}
                disabled={lassoDraftCoordinates.length < 3}
                sx={{
                  borderColor: 'rgba(125, 211, 252, 0.65)',
                  color: '#BAE6FD',
                  textTransform: 'none',
                  fontSize: 11
                }}
              >
                Close Lasso
              </Button>
              <Button
                size="small"
                variant="text"
                onClick={clearManagerSelection}
                sx={{ color: '#94A3B8', textTransform: 'none', fontSize: 11 }}
              >
                Clear
              </Button>
            </Stack>
          )}

          {managerOverrideEnabled && (
            <Typography sx={{ fontSize: 11, color: '#94A3B8' }}>
              {selectionMode === 'box'
                ? 'Drag on the map to multi-select pockets. Click a pocket to select one.'
                : 'Click to trace a lasso polygon. Double-click or "Close Lasso" to select.'}
            </Typography>
          )}

          <Typography sx={{ fontSize: 11, color: '#CBD5E1' }}>
            Selected Pockets: {selectedPocketIds.length}
          </Typography>

          {activeAssignmentBranchId && (
            <Button
              size="small"
              variant="outlined"
              onClick={() => setShowPocketAllocationsPanel((previous) => !previous)}
              sx={{
                textTransform: 'none',
                borderColor: 'rgba(148, 163, 184, 0.5)',
                color: '#CBD5E1'
              }}
            >
              {showPocketAllocationsPanel ? 'Hide Pocket Allocations' : 'Show Pocket Allocations'}
            </Button>
          )}

          {territoryLoading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={16} sx={{ color: '#38BDF8' }} />
              <Typography sx={{ fontSize: 12, color: '#CBD5E1' }}>Refreshing territory view...</Typography>
            </Box>
          )}

          {territorySummary && (
            <Stack spacing={0.3}>
              <Typography sx={{ fontSize: 11, color: '#94A3B8' }}>
                Territories: {territorySummary.territories}
              </Typography>
              <Typography sx={{ fontSize: 11, color: '#94A3B8' }}>
                Source Points: {territorySummary.points} ({territorySummary.sourceType})
              </Typography>
              <Typography sx={{ fontSize: 11, color: '#94A3B8' }}>
                Visible Customers: {territorySummary.customersVisible}
              </Typography>
              <Typography sx={{ fontSize: 11, color: '#94A3B8' }}>
                Customer View: {territoryCustomerView === 'original_customers' ? 'Original Customers' : 'Selected Pockets'}
              </Typography>
              <Typography sx={{ fontSize: 11, color: '#94A3B8' }}>
                Selected Branch: {selectedTerritoryBranchIds.length}/{MAX_TERRITORY_BRANCHES}
              </Typography>
              <Typography sx={{ fontSize: 11, color: '#94A3B8' }}>
                Other Branches: {showOtherBranches ? 'Visible' : 'Hidden'}
              </Typography>
            </Stack>
          )}

          {territoryError && (
            <Alert severity="error" sx={{ py: 0.3, '& .MuiAlert-message': { fontSize: 12 } }}>
              {territoryError}
            </Alert>
          )}
        </Stack>
      </Paper>

      {managerOverrideEnabled && employeeMetrics.length > 0 && (
        <Paper
          elevation={6}
          sx={{
            position: 'absolute',
            top: 16,
            left: 16,
            width: { xs: 'calc(100% - 32px)', sm: 320 },
            maxHeight: { xs: '42%', sm: 'calc(100% - 32px)' },
            overflowY: 'auto',
            p: 1.5,
            zIndex: 3,
            borderRadius: 2,
            backgroundColor: 'rgba(15, 23, 42, 0.9)',
            border: '1px solid rgba(148, 163, 184, 0.35)',
            color: '#E2E8F0',
            backdropFilter: 'blur(6px)'
          }}
        >
          <Stack spacing={1.1}>
            <Typography sx={{ fontSize: 12, fontWeight: 700 }}>
              Live Workload Metrics
            </Typography>
            <Typography sx={{ fontSize: 11, color: '#94A3B8' }}>
              Target tolerance: +/-{Math.round(assignmentTolerance * 100)}%
            </Typography>

            {employeeMetrics.map((metric) => {
              const denominator = metric.targetAccounts > 0 ? metric.targetAccounts : 1;
              const progressValue = Math.min((metric.accountTotal / denominator) * 100, 180);
              const barColor = metric.status === 'over'
                ? '#F87171'
                : metric.status === 'under'
                  ? '#FBBF24'
                  : '#34D399';

              return (
                <Box
                  key={metric.employeeId}
                  sx={{ p: 1, border: '1px solid rgba(148, 163, 184, 0.25)', borderRadius: 1.2 }}
                >
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Stack direction="row" spacing={0.8} alignItems="center">
                      {metric.employeeId !== 'unassigned' && (
                        <Box
                          aria-label={`Color for ${metric.employeeId}`}
                          sx={{
                            width: 12,
                            height: 12,
                            p: 0.2,
                            border: '1px solid rgba(148, 163, 184, 0.55)',
                            borderRadius: 0.8,
                            backgroundColor: normalizeHexColor(
                              branchEmployeeMap.get(metric.employeeId)?.colorCode
                                || employeeColors[metric.employeeId],
                              GRID1_FALLBACK_COLOR
                            )
                          }}
                        />
                      )}
                      <Typography sx={{ fontSize: 11, fontWeight: 700 }}>
                        {metric.employeeId}
                      </Typography>
                    </Stack>
                    <Typography
                      sx={{
                        fontSize: 10,
                        color: metric.status === 'over'
                          ? '#FCA5A5'
                          : metric.status === 'under'
                            ? '#FCD34D'
                            : '#86EFAC'
                      }}
                    >
                      {metric.status === 'over'
                        ? 'Over Limit'
                        : metric.status === 'under'
                          ? 'Below Target'
                          : 'Within Range'}
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={Number.isFinite(progressValue) ? progressValue : 0}
                    sx={{
                      mt: 0.6,
                      height: 8,
                      borderRadius: 1,
                      backgroundColor: 'rgba(148, 163, 184, 0.25)',
                      '& .MuiLinearProgress-bar': {
                        backgroundColor: barColor
                      }
                    }}
                  />
                  <Typography sx={{ mt: 0.4, fontSize: 10, color: '#CBD5E1' }}>
                    Accounts: {metric.accountTotal.toFixed(0)} | Pockets: {metric.pocketCount} (non-empty: {metric.nonEmptyPocketCount})
                  </Typography>
                </Box>
              );
            })}
          </Stack>
        </Paper>
      )}

      {managerOverrideEnabled && selectedPocketIds.length > 0 && (
        <Paper
          elevation={8}
          sx={{
            position: 'absolute',
            left: '50%',
            bottom: 20,
            transform: 'translateX(-50%)',
            width: { xs: 'calc(100% - 32px)', sm: 440 },
            p: 1.4,
            zIndex: 4,
            borderRadius: 2,
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid rgba(125, 211, 252, 0.55)',
            color: '#E2E8F0',
            backdropFilter: 'blur(8px)'
          }}
        >
          <Stack spacing={1}>
            <Typography sx={{ fontSize: 12, fontWeight: 700 }}>
              Reassign {selectedPocketIds.length} Selected Pockets
            </Typography>

            <FormControl fullWidth size="small">
              <InputLabel id="reassign-employee-label" sx={{ color: '#CBD5E1' }}>
                Assign To
              </InputLabel>
              <Select
                labelId="reassign-employee-label"
                value={reassignEmployeeId}
                label="Assign To"
                onChange={(event) => setReassignEmployeeId(String(event.target.value || ''))}
                sx={{
                  color: '#E2E8F0',
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(148, 163, 184, 0.5)' },
                  '& .MuiSvgIcon-root': { color: '#CBD5E1' }
                }}
              >
                {reassignableEmployeeIds.map((employeeId) => (
                  <MenuItem key={employeeId} value={employeeId}>
                    {employeeId}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant="contained"
                onClick={() => void applyPocketReassignment()}
                // --- ORIGINAL BACKUP ---
                // disabled={!reassignEmployeeId}
                disabled={!reassignEmployeeId || allocationFallbackLocked}
                sx={{
                  textTransform: 'none',
                  backgroundColor: '#0EA5E9',
                  '&:hover': { backgroundColor: '#0284C7' }
                }}
              >
                Apply Reassignment
              </Button>
              <Button
                size="small"
                variant="text"
                onClick={clearManagerSelection}
                sx={{ textTransform: 'none', color: '#94A3B8' }}
              >
                Clear Selection
              </Button>
            </Stack>
          </Stack>
        </Paper>
      )}

      {activeAssignmentBranchId && showPocketAllocationsPanel && (
        <Paper
          elevation={8}
          sx={{
            position: 'absolute',
            left: 16,
            right: { xs: 16, md: 392 },
            bottom: 16,
            maxHeight: { xs: '34%', md: '38%' },
            p: 1.3,
            zIndex: 4,
            borderRadius: 2,
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid rgba(148, 163, 184, 0.35)',
            color: '#E2E8F0',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            flexDirection: 'column',
            gap: 1
          }}
        >
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography sx={{ fontSize: 12, fontWeight: 700 }}>
              Pocket Allocations
            </Typography>
            <IconButton
              size="small"
              onClick={() => setShowPocketAllocationsPanel(false)}
              sx={{
                color: '#CBD5E1',
                border: '1px solid rgba(148, 163, 184, 0.45)'
              }}
              aria-label="Close Pocket Allocations"
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
          <Typography sx={{ fontSize: 11, color: '#94A3B8' }}>
            Customers to Pockets to Branches to Employees (Pocket-level reassignment only).
          </Typography>

          {branchEmployeesLoading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={14} sx={{ color: '#38BDF8' }} />
              <Typography sx={{ fontSize: 11, color: '#CBD5E1' }}>
                Loading employee master...
              </Typography>
            </Box>
          )}

          <TableContainer sx={{ overflowY: 'auto', border: '1px solid rgba(148, 163, 184, 0.2)', borderRadius: 1 }}>
            <Table stickyHeader size="small" aria-label="Pocket allocation table">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ backgroundColor: '#0F172A', color: '#CBD5E1', fontSize: 11 }}>Pocket ID</TableCell>
                  <TableCell sx={{ backgroundColor: '#0F172A', color: '#CBD5E1', fontSize: 11 }}>Total Customers</TableCell>
                  <TableCell sx={{ backgroundColor: '#0F172A', color: '#CBD5E1', fontSize: 11 }}>Assigned Employee</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pocketAllocationRows.map((row) => (
                  <TableRow
                    key={row.pocketId}
                    hover
                    onMouseEnter={() => setHoveredPocketId(row.pocketId)}
                    onMouseLeave={() => setHoveredPocketId('')}
                    sx={{
                      '& td': { color: '#E2E8F0', borderColor: 'rgba(148, 163, 184, 0.15)' },
                      backgroundColor: hoveredPocketId === row.pocketId
                        ? 'rgba(56, 189, 248, 0.12)'
                        : 'transparent'
                    }}
                  >
                    <TableCell sx={{ fontSize: 11 }}>
                      {row.pocketId}
                    </TableCell>
                    <TableCell sx={{ fontSize: 11 }}>
                      {row.totalCustomers}
                    </TableCell>
                    <TableCell sx={{ minWidth: 190 }}>
                      <FormControl fullWidth size="small">
                        <Select
                          value={
                            reassignableEmployeeIds.includes(String(row.employeeId || ''))
                              ? String(row.employeeId || '')
                              : ''
                          }
                          onChange={(event) => {
                            const nextEmployeeId = String(event.target.value || '').trim();
                            if (nextEmployeeId) {
                              void handleTablePocketAssignment(row.pocketId, nextEmployeeId);
                            }
                          }}
                          // --- ORIGINAL BACKUP ---
                          // disabled={tableAssignLoadingPocketId === row.pocketId || reassignableEmployeeIds.length === 0}
                          disabled={
                            tableAssignLoadingPocketId === row.pocketId
                            || reassignableEmployeeIds.length === 0
                            || allocationFallbackLocked
                          }
                          sx={{
                            color: '#E2E8F0',
                            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(148, 163, 184, 0.4)' },
                            '& .MuiSvgIcon-root': { color: '#CBD5E1' },
                            fontSize: 11
                          }}
                        >
                          <MenuItem value="" disabled>
                            Select employee
                          </MenuItem>
                          {branchEmployees.map((employee) => (
                            <MenuItem key={employee.id} value={employee.id}>
                              {employee.name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </TableCell>
                  </TableRow>
                ))}
                {pocketAllocationRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} sx={{ color: '#94A3B8', fontSize: 11 }}>
                      No pockets available for selected branch.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      <Drawer
        anchor="right"
        open={isDrawerOpen}
        onClose={() => {
          setSelectedPocket(null);
          setDrawerEmployeeId('');
          setIsDrawerOpen(false);
        }}
        PaperProps={{
          sx: {
            width: { xs: '100%', sm: 360 },
            backgroundColor: 'rgba(15, 23, 42, 0.98)',
            color: '#E2E8F0',
            borderLeft: '1px solid rgba(148, 163, 184, 0.35)'
          }
        }}
      >
        <Box sx={{ p: 2, height: '100%', overflowY: 'auto' }}>
          <Stack spacing={1.4}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography sx={{ fontSize: 14, fontWeight: 700 }}>
                Pocket Inspector
              </Typography>
              <IconButton
                size="small"
                onClick={() => {
                  setSelectedPocket(null);
                  setDrawerEmployeeId('');
                  setIsDrawerOpen(false);
                }}
                sx={{ color: '#CBD5E1' }}
                aria-label="Close Pocket Inspector"
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>

            {!selectedPocket ? (
              <Typography sx={{ fontSize: 12, color: '#94A3B8' }}>
                Select a pocket on the map to view and reallocate.
              </Typography>
            ) : (
              <>
                <Typography sx={{ fontSize: 12, color: '#CBD5E1', fontWeight: 700 }}>
                  Pocket ID: {String(selectedPocket.pocket_id || selectedPocket.grid_cell_id || '-')}
                </Typography>

                <Typography sx={{ fontSize: 12, color: '#CBD5E1' }}>
                  Total Customers: {Number(selectedPocket.customer_count || 0)}
                </Typography>

                <Typography sx={{ fontSize: 11, color: '#94A3B8' }}>
                  Selected Branch ({activeAssignmentBranchId || selectedPocket.branch_id || '-'}):{' '}
                  {Number(selectedPocket.selected_branch_customer_count || 0)}
                </Typography>
                <Typography sx={{ fontSize: 11, color: '#94A3B8' }}>
                  Other Branches: {Number(selectedPocket.other_branch_customer_count || 0)}
                </Typography>

                <Stack direction="row" spacing={0.8} alignItems="center">
                  <Box
                    sx={{
                      width: 12,
                      height: 12,
                      borderRadius: 0.6,
                      backgroundColor: normalizeHexColor(selectedPocket.color, GRID1_FALLBACK_COLOR),
                      border: '1px solid rgba(255, 255, 255, 0.4)'
                    }}
                  />
                  <Typography sx={{ fontSize: 11, color: '#CBD5E1' }}>
                    Current Owner:{' '}
                    {branchEmployeeMap.get(String(selectedPocket.employee_id || '').trim())?.name || 'Unassigned'}
                  </Typography>
                </Stack>
              </>
            )}
          </Stack>
        </Box>
      </Drawer>
    </Box>
  );
}
