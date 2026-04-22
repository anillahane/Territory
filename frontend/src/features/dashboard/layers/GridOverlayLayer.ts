import type { Map } from 'maplibre-gl';
import type { DashboardGridLevelId } from '../../../store/useStore';
import {
  DEFAULT_BOUNDS,
  EMPTY_GRID_FEATURE_COLLECTION,
  GRID_LAYER_PREFIX,
  GRID_SOURCE_PREFIX,
  KM_GRID_LEVELS,
} from '../constants';

export const getGridSourceId = (id: DashboardGridLevelId) => `${GRID_SOURCE_PREFIX}-${id}`;
export const getGridLayerId = (id: DashboardGridLevelId) => `${GRID_LAYER_PREFIX}-${id}`;

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

export const buildGridOverlayLabel = (selectedGridLevels: DashboardGridLevelId[], zoom: number): string => {
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

export const addGridOverlaySources = (mapInstance: Map) => {
  KM_GRID_LEVELS.forEach((gridLevel) => {
    const sourceId = getGridSourceId(gridLevel.id);
    const layerId = getGridLayerId(gridLevel.id);

    if (!mapInstance.getSource(sourceId)) {
      mapInstance.addSource(sourceId, {
        type: 'geojson',
        data: EMPTY_GRID_FEATURE_COLLECTION
      });
    }

    if (!mapInstance.getLayer(layerId)) {
      mapInstance.addLayer({
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
    }
  });
};

export const syncGridOverlay = (mapInstance: Map, selectedGridLevelIds: DashboardGridLevelId[]) => {
  const zoom = mapInstance.getZoom();
  const bounds = mapInstance.getBounds();
  const minLon = Math.max(DEFAULT_BOUNDS[0], bounds.getWest());
  const maxLon = Math.min(DEFAULT_BOUNDS[2], bounds.getEast());
  const minLat = Math.max(DEFAULT_BOUNDS[1], bounds.getSouth());
  const maxLat = Math.min(DEFAULT_BOUNDS[3], bounds.getNorth());
  const referenceLat = Math.max(minLat, Math.min(maxLat, mapInstance.getCenter().lat));
  const visibleGridLabels: string[] = [];

  KM_GRID_LEVELS.forEach((gridLevel) => {
    const sourceId = getGridSourceId(gridLevel.id);
    const layerId = getGridLayerId(gridLevel.id);
    const source = mapInstance.getSource(sourceId) as {
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
      if (mapInstance.getLayer(layerId)) {
        mapInstance.setLayoutProperty(layerId, 'visibility', 'visible');
      }
      visibleGridLabels.push(gridLevel.label);
    } else {
      if (source?.setData) {
        source.setData(EMPTY_GRID_FEATURE_COLLECTION);
      }
      if (mapInstance.getLayer(layerId)) {
        mapInstance.setLayoutProperty(layerId, 'visibility', 'none');
      }
    }
  });

  return visibleGridLabels.length > 0
    ? visibleGridLabels.join(', ')
    : buildGridOverlayLabel(selectedGridLevelIds, zoom);
};
