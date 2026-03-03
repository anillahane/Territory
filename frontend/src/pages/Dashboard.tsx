import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Checkbox,
  CircularProgress,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  OutlinedInput,
  Paper,
  Select,
  Stack,
  Typography
} from '@mui/material';
import { Map, NavigationControl, ScaleControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreCspWorkerUrl from 'maplibre-gl/dist/maplibre-gl-csp-worker.js?url';
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
  { id: '500km', label: '500 km', stepKm: 500, minZoom: 0, color: '#93C5FD', width: 1.4, opacity: 0.25 },
  { id: '100km', label: '100 km', stepKm: 100, minZoom: 0, color: '#60A5FA', width: 1.1, opacity: 0.22 },
  { id: '20km', label: '20 km', stepKm: 20, minZoom: 0, color: '#38BDF8', width: 0.9, opacity: 0.2 },
  { id: '5km', label: '5 km', stepKm: 5, minZoom: 6, color: '#22D3EE', width: 0.75, opacity: 0.18 },
  { id: '1km', label: '1 km', stepKm: 1, minZoom: 6, color: '#06B6D4', width: 0.55, opacity: 0.16 }
];
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

const buildGridGeoJsonKm = (
  minLon: number,
  maxLon: number,
  minLat: number,
  maxLat: number,
  stepKm: number,
  referenceLat: number
) => {
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];

  const latStepDeg = stepKm / 110.574;
  const cosLat = Math.cos((referenceLat * Math.PI) / 180);
  const safeCosLat = Math.max(0.2, Math.abs(cosLat));
  const lonStepDeg = stepKm / (111.32 * safeCosLat);

  const estimatedLonLines = Math.ceil((maxLon - minLon) / lonStepDeg) + 1;
  const estimatedLatLines = Math.ceil((maxLat - minLat) / latStepDeg) + 1;
  if (estimatedLonLines + estimatedLatLines > 20000) {
    return EMPTY_GRID_FEATURE_COLLECTION;
  }

  const startLon = Math.floor(minLon / lonStepDeg) * lonStepDeg;
  const endLon = Math.ceil(maxLon / lonStepDeg) * lonStepDeg;
  for (let lon = startLon; lon <= endLon; lon += lonStepDeg) {
    const x = Number(lon.toFixed(6));
    features.push({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [[x, minLat], [x, maxLat]]
      }
    });
  }

  const startLat = Math.floor(minLat / latStepDeg) * latStepDeg;
  const endLat = Math.ceil(maxLat / latStepDeg) * latStepDeg;
  for (let lat = startLat; lat <= endLat; lat += latStepDeg) {
    const y = Number(lat.toFixed(6));
    features.push({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [[minLon, y], [maxLon, y]]
      }
    });
  }

  return {
    type: 'FeatureCollection',
    features
  } as GeoJSON.FeatureCollection<GeoJSON.LineString>;
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

const hasSameIds = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((value, index) => value === b[index]);
};

export default function Dashboard() {
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
  const [territorySummary, setTerritorySummary] = useState<TerritorySummary | null>(null);
  const [territoryLoading, setTerritoryLoading] = useState(false);
  const [territoryError, setTerritoryError] = useState<string | null>(null);
  const [showTerritoryCustomers, setShowTerritoryCustomers] = useState(true);
  const [showOtherBranches, setShowOtherBranches] = useState(false);
  const territoryRequestCounterRef = useRef(0);

  const addBranchMarkers = async () => {
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
      const response = await api.getBranches({ limit: 5000, offset: 0 });
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

      if (!map.current || map.current !== mapInstance) return;

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
  };

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

  const ensureTerritoryLayers = (mapInstance: Map) => {
    if (!mapInstance.getSource(TERRITORY_SOURCE_ID)) {
      mapInstance.addSource(TERRITORY_SOURCE_ID, {
        type: 'geojson',
        data: EMPTY_TERRITORY_FEATURE_COLLECTION
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

    if (!mapInstance.getLayer(TERRITORY_POINTS_LAYER_ID)) {
      mapInstance.addLayer({
        id: TERRITORY_POINTS_LAYER_ID,
        type: 'circle',
        source: TERRITORY_POINTS_SOURCE_ID,
        paint: {
          'circle-color': '#22D3EE',
          'circle-opacity': 0.85,
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            4, 1.8,
            8, 3,
            12, 4.6
          ]
        }
      });
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
          'circle-color': '#FB923C',
          'circle-opacity': 0.95,
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            4, 3.2,
            8, 4.8,
            12, 6.8
          ],
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': 1.2
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
    setGeoJsonSourceData(mapInstance, TERRITORY_SOURCE_ID, EMPTY_TERRITORY_FEATURE_COLLECTION);
    setGeoJsonSourceData(mapInstance, TERRITORY_POINTS_SOURCE_ID, EMPTY_TERRITORY_POINT_FEATURE_COLLECTION);
    setGeoJsonSourceData(mapInstance, TERRITORY_CUSTOMERS_SOURCE_ID, EMPTY_TERRITORY_POINT_FEATURE_COLLECTION);
    setGeoJsonSourceData(mapInstance, TERRITORY_SELECTED_BRANCHES_SOURCE_ID, EMPTY_BRANCH_FEATURE_COLLECTION);
  };

  const loadTerritoryVisualization = async (
    mode: TerritoryMode,
    branchIds: string[],
    customerView: TerritoryCustomerView
  ) => {
    if (!map.current || !map.current.isStyleLoaded()) return;

    const requestId = territoryRequestCounterRef.current + 1;
    territoryRequestCounterRef.current = requestId;

    setTerritoryLoading(true);
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
      const filteredCustomers: GeoJSON.FeatureCollection<GeoJSON.Point> = {
        type: 'FeatureCollection',
        features: (payload.customers?.features || []).filter((feature) =>
          selectedBranchIdSet.has(String(feature.properties?.branchId ?? ''))
        )
      };
      ensureTerritoryLayers(mapInstance);
      setGeoJsonSourceData(mapInstance, TERRITORY_SOURCE_ID, payload.territories);
      setGeoJsonSourceData(mapInstance, TERRITORY_POINTS_SOURCE_ID, payload.points);
      setGeoJsonSourceData(mapInstance, TERRITORY_CUSTOMERS_SOURCE_ID, filteredCustomers);
      setGeoJsonSourceData(mapInstance, TERRITORY_SELECTED_BRANCHES_SOURCE_ID, payload.branches as GeoJSON.FeatureCollection<GeoJSON.Point>);

      if (mapInstance.getLayer(TERRITORY_FILL_LAYER_ID)) {
        mapInstance.moveLayer(TERRITORY_FILL_LAYER_ID, STATE_BORDERS_LAYER_ID);
      }
      if (mapInstance.getLayer(TERRITORY_LINE_LAYER_ID)) {
        mapInstance.moveLayer(TERRITORY_LINE_LAYER_ID, STATE_BORDERS_LAYER_ID);
      }
      if (mapInstance.getLayer(TERRITORY_POINTS_LAYER_ID)) {
        mapInstance.moveLayer(TERRITORY_POINTS_LAYER_ID);
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

      setTerritoryBranchOptions(payload.availableBranches || []);
      setTerritorySummary(payload.summary || null);

      const responseSelectedIds = selectedIds.slice(0, MAX_TERRITORY_BRANCHES);
      if (!hasSameIds(responseSelectedIds, selectedTerritoryBranchIds)) {
        setSelectedTerritoryBranchIds(responseSelectedIds);
      }
    } catch (error) {
      if (territoryRequestCounterRef.current !== requestId) return;

      const message = error instanceof Error ? error.message : 'Failed to load territory visualization';
      setTerritoryError(message);
      setTerritorySummary(null);
      clearTerritoryVisualization();
    } finally {
      if (territoryRequestCounterRef.current === requestId) {
        setTerritoryLoading(false);
      }
    }
  };

  const handleTerritoryModeChange = (nextMode: TerritoryMode) => {
    setTerritoryMode(nextMode);
    setSelectedTerritoryBranchIds([]);
    void loadTerritoryVisualization(nextMode, [], territoryCustomerView);
  };

  const handleTerritoryCustomerViewChange = (nextCustomerView: TerritoryCustomerView) => {
    setTerritoryCustomerView(nextCustomerView);
    void loadTerritoryVisualization(territoryMode, selectedTerritoryBranchIds, nextCustomerView);
  };

  const handleTerritoryBranchChange = (nextBranchIds: string[]) => {
    if (nextBranchIds.length > MAX_TERRITORY_BRANCHES) {
      setTerritoryError(`Select up to ${MAX_TERRITORY_BRANCHES} branches only.`);
      return;
    }

    setTerritoryError(null);
    setSelectedTerritoryBranchIds(nextBranchIds);
    void loadTerritoryVisualization(territoryMode, nextBranchIds, territoryCustomerView);
  };

  // Placeholder for nearest branch lookup.
  // Called from map click handler to preserve expected interaction path.
  const findNearestBranch = (lat: number, lng: number) => {
    // TODO: wire this to backend nearest branch API in next phase.
    console.debug('Nearest branch lookup pending API integration:', { lat, lng });
  };

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
      const bounds = map.current.getBounds();
      const minLon = Math.max(DEFAULT_BOUNDS[0], bounds.getWest());
      const maxLon = Math.min(DEFAULT_BOUNDS[2], bounds.getEast());
      const minLat = Math.max(DEFAULT_BOUNDS[1], bounds.getSouth());
      const maxLat = Math.min(DEFAULT_BOUNDS[3], bounds.getNorth());
      const selectedGridLevelIds = selectedGridLevelsRef.current;
      const referenceLat = Math.max(minLat, Math.min(maxLat, map.current.getCenter().lat));
      const visibleGridLabels: string[] = [];

      KM_GRID_LEVELS.forEach((gridLevel) => {
        const sourceId = getGridSourceId(gridLevel.id);
        const layerId = getGridLayerId(gridLevel.id);
        const source = map.current?.getSource(sourceId) as {
          setData: (data: GeoJSON.FeatureCollection<GeoJSON.LineString>) => void;
        } | undefined;

        const shouldRender = selectedGridLevelIds.includes(gridLevel.id) && zoom >= gridLevel.minZoom;
        if (shouldRender && source?.setData) {
          source.setData(
            buildGridGeoJsonKm(
              minLon,
              maxLon,
              minLat,
              maxLat,
              gridLevel.stepKm,
              referenceLat
            )
          );
          if (map.current?.getLayer(layerId)) {
            map.current.setLayoutProperty(layerId, 'visibility', 'visible');
          }
          visibleGridLabels.push(gridLevel.label);
        } else {
          if (source?.setData) {
            source.setData(EMPTY_GRID_FEATURE_COLLECTION);
          }
          if (map.current?.getLayer(layerId)) {
            map.current.setLayoutProperty(layerId, 'visibility', 'none');
          }
        }
      });

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
              'line-color': gridLevel.color,
              'line-width': gridLevel.width,
              'line-opacity': gridLevel.opacity
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
        void loadTerritoryVisualization(territoryMode, selectedTerritoryBranchIds, territoryCustomerView);

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
    map.current.on('click', (event) => {
      findNearestBranch(event.lngLat.lat, event.lngLat.lng);
    });

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
  }, [showBranches, showOtherBranches]);

  useEffect(() => {
    if (!map.current || !map.current.getLayer(TERRITORY_CUSTOMERS_LAYER_ID)) return;
    map.current.setLayoutProperty(
      TERRITORY_CUSTOMERS_LAYER_ID,
      'visibility',
      showTerritoryCustomers ? 'visible' : 'none'
    );
  }, [showTerritoryCustomers, mapLoaded]);

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
          <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
            Voronoi Territory View
          </Typography>

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
              disabled={territoryLoading || territoryBranchOptions.length === 0 || !mapLoaded}
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
    </Box>
  );
}
