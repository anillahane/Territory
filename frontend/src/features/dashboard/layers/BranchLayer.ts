import type { Map } from 'maplibre-gl';
import api from '../../../services/api';
import {
  BRANCH_MARKERS_LAYER_ID,
  BRANCH_MARKERS_SOURCE_ID,
  EMPTY_BRANCH_FEATURE_COLLECTION,
} from '../constants';

export const setBranchLayerVisibility = (mapInstance: Map, visible: boolean) => {
  if (mapInstance.getLayer(BRANCH_MARKERS_LAYER_ID)) {
    mapInstance.setLayoutProperty(
      BRANCH_MARKERS_LAYER_ID,
      'visibility',
      visible ? 'visible' : 'none'
    );
  }
};

const ensureBranchLayer = (mapInstance: Map, visible: boolean) => {
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
        visibility: visible ? 'visible' : 'none'
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

  mapInstance.moveLayer(BRANCH_MARKERS_LAYER_ID);
  setBranchLayerVisibility(mapInstance, visible);
};

export const loadBranchMarkers = async (
  mapInstance: Map,
  showBranches: boolean,
  showOtherBranches: boolean
) => {
  if (!mapInstance.isStyleLoaded()) return;

  const isVisible = showBranches && showOtherBranches;
  ensureBranchLayer(mapInstance, isVisible);

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

    const source = mapInstance.getSource(BRANCH_MARKERS_SOURCE_ID) as {
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
