import type { Map } from 'maplibre-gl';
import {
  BRANCH_MARKERS_LAYER_ID,
  EMPTY_BRANCH_FEATURE_COLLECTION,
  EMPTY_TERRITORY_FEATURE_COLLECTION,
  EMPTY_TERRITORY_POINT_FEATURE_COLLECTION,
  STATE_BORDERS_LAYER_ID,
  TERRITORY_CUSTOMERS_LAYER_ID,
  TERRITORY_FILL_LAYER_ID,
  TERRITORY_LINE_LAYER_ID,
  TERRITORY_POINTS_LAYER_ID,
  TERRITORY_POINTS_SOURCE_ID,
  TERRITORY_SELECTED_BRANCHES_LAYER_ID,
  TERRITORY_SELECTED_BRANCHES_SOURCE_ID,
  TERRITORY_SOURCE_ID,
} from '../constants';
import type { TerritoryVisualizationResponse } from '../types';
import { ensureCustomerLayer } from './CustomerLayer';

export const setGeoJsonSourceData = (
  mapInstance: Map,
  sourceId: string,
  data:
    | GeoJSON.FeatureCollection<GeoJSON.Point>
    | GeoJSON.FeatureCollection<GeoJSON.LineString>
    | GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>
) => {
  const source = mapInstance.getSource(sourceId) as {
    setData: (
      nextData:
        | GeoJSON.FeatureCollection<GeoJSON.Point>
        | GeoJSON.FeatureCollection<GeoJSON.LineString>
        | GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>
    ) => void;
  } | undefined;
  source?.setData(data);
};

export const ensureTerritoryLayers = (mapInstance: Map, showTerritoryCustomers: boolean) => {
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

  ensureCustomerLayer(mapInstance, showTerritoryCustomers);

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

export const clearTerritoryVisualization = (mapInstance: Map) => {
  setGeoJsonSourceData(mapInstance, TERRITORY_SOURCE_ID, EMPTY_TERRITORY_FEATURE_COLLECTION);
  setGeoJsonSourceData(mapInstance, TERRITORY_POINTS_SOURCE_ID, EMPTY_TERRITORY_POINT_FEATURE_COLLECTION);
  setGeoJsonSourceData(mapInstance, TERRITORY_CUSTOMERS_LAYER_ID, EMPTY_TERRITORY_POINT_FEATURE_COLLECTION);
  setGeoJsonSourceData(mapInstance, TERRITORY_SELECTED_BRANCHES_SOURCE_ID, EMPTY_BRANCH_FEATURE_COLLECTION);
};

export const applyTerritoryVisualization = (
  mapInstance: Map,
  payload: TerritoryVisualizationResponse,
  showTerritoryCustomers: boolean
) => {
  const selectedBranchIdSet = new Set((payload.selectedBranchIds || []).map((id) => String(id)));
  const filteredCustomers: GeoJSON.FeatureCollection<GeoJSON.Point> = {
    type: 'FeatureCollection',
    features: (payload.customers?.features || []).filter((feature) =>
      selectedBranchIdSet.has(String(feature.properties?.branchId ?? ''))
    )
  };

  ensureTerritoryLayers(mapInstance, showTerritoryCustomers);
  setGeoJsonSourceData(mapInstance, TERRITORY_SOURCE_ID, payload.territories);
  setGeoJsonSourceData(mapInstance, TERRITORY_POINTS_SOURCE_ID, payload.points);
  setGeoJsonSourceData(mapInstance, TERRITORY_CUSTOMERS_LAYER_ID, filteredCustomers);
  setGeoJsonSourceData(
    mapInstance,
    TERRITORY_SELECTED_BRANCHES_SOURCE_ID,
    payload.branches as GeoJSON.FeatureCollection<GeoJSON.Point>
  );

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
  }
  if (mapInstance.getLayer(TERRITORY_SELECTED_BRANCHES_LAYER_ID)) {
    mapInstance.moveLayer(TERRITORY_SELECTED_BRANCHES_LAYER_ID);
  }
  if (mapInstance.getLayer(BRANCH_MARKERS_LAYER_ID)) {
    mapInstance.moveLayer(BRANCH_MARKERS_LAYER_ID);
  }
};
