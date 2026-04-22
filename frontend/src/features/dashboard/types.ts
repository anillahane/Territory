export type TerritoryMode =
  | 'existing_customers'
  | 'nearest_pockets'
  | 'customer_availability';

export type TerritoryCustomerView =
  | 'selected_pockets'
  | 'original_customers';

export type TerritoryBranchOption = {
  id: string;
  city: string;
  customerCount: number;
};

export type TerritorySummary = {
  territories: number;
  branches: number;
  points: number;
  customers: number;
  customersVisible: number;
  selectedPocketCustomersVisible?: number;
  originalCustomersVisible?: number;
  sourceType: string;
};

export type TerritoryVisualizationResponse = {
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
