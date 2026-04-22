import type { DashboardGridLevelId } from '../../store/useStore';
import type { TerritoryCustomerView, TerritoryMode } from './types';

export const DEFAULT_BOUNDS = [63.0, 1.5, 102.5, 42.5] as [number, number, number, number];
export const DEFAULT_CENTER = [78.9629, 20.5937] as [number, number];
export const DEFAULT_ZOOM = 4.5;

export const KM_GRID_LEVELS: Array<{
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

export const GRID_SOURCE_PREFIX = 'dashboard-grid';
export const GRID_LAYER_PREFIX = 'dashboard-grid-lines';
export const OFFICIAL_INDIA_GEOJSON_URL = '/data/indiaStateBounds_official.geojson';
export const STATE_BORDERS_SOURCE_ID = 'official-state-borders';
export const STATE_BORDERS_LAYER_ID = 'state-borders';
export const STATE_BORDERS_GEOJSON_URL = '/data/stateBorders_official.geojson';
export const BRANCH_MARKERS_SOURCE_ID = 'branch-markers';
export const BRANCH_MARKERS_LAYER_ID = 'branch-markers-layer';
export const TERRITORY_SOURCE_ID = 'territory-polygons';
export const TERRITORY_FILL_LAYER_ID = 'territory-polygons-fill';
export const TERRITORY_LINE_LAYER_ID = 'territory-polygons-line';
export const TERRITORY_POINTS_SOURCE_ID = 'territory-points';
export const TERRITORY_POINTS_LAYER_ID = 'territory-points-layer';
export const TERRITORY_CUSTOMERS_SOURCE_ID = 'territory-customers';
export const TERRITORY_CUSTOMERS_LAYER_ID = 'territory-customers-layer';
export const TERRITORY_SELECTED_BRANCHES_SOURCE_ID = 'territory-selected-branches';
export const TERRITORY_SELECTED_BRANCHES_LAYER_ID = 'territory-selected-branches-layer';
export const MAX_TERRITORY_BRANCHES = 1;

export const TERRITORY_MODE_OPTIONS: Array<{ value: TerritoryMode; label: string }> = [
  { value: 'existing_customers', label: 'Existing Customer Mapped' },
  { value: 'nearest_pockets', label: 'Branches -> Nearest Pockets' },
  { value: 'customer_availability', label: 'Branches -> Customer Availability' }
];

export const TERRITORY_CUSTOMER_VIEW_OPTIONS: Array<{
  value: TerritoryCustomerView;
  label: string;
}> = [
  { value: 'selected_pockets', label: 'Customers From Selected Pockets' },
  { value: 'original_customers', label: 'Original Customers' }
];

export const EMPTY_GRID_FEATURE_COLLECTION = {
  type: 'FeatureCollection',
  features: []
} as GeoJSON.FeatureCollection<GeoJSON.LineString>;

export const EMPTY_BRANCH_FEATURE_COLLECTION = {
  type: 'FeatureCollection',
  features: []
} as GeoJSON.FeatureCollection<GeoJSON.Point>;

export const EMPTY_TERRITORY_FEATURE_COLLECTION = {
  type: 'FeatureCollection',
  features: []
} as GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>;

export const EMPTY_TERRITORY_POINT_FEATURE_COLLECTION = {
  type: 'FeatureCollection',
  features: []
} as GeoJSON.FeatureCollection<GeoJSON.Point>;
