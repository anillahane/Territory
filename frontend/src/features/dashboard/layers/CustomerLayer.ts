import type { Map } from 'maplibre-gl';
import {
  EMPTY_TERRITORY_POINT_FEATURE_COLLECTION,
  TERRITORY_CUSTOMERS_LAYER_ID,
  TERRITORY_CUSTOMERS_SOURCE_ID,
} from '../constants';

export const ensureCustomerLayer = (mapInstance: Map, visible: boolean) => {
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
        visibility: visible ? 'visible' : 'none'
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

  setCustomerLayerVisibility(mapInstance, visible);
};

export const setCustomerLayerVisibility = (mapInstance: Map, visible: boolean) => {
  if (mapInstance.getLayer(TERRITORY_CUSTOMERS_LAYER_ID)) {
    mapInstance.setLayoutProperty(
      TERRITORY_CUSTOMERS_LAYER_ID,
      'visibility',
      visible ? 'visible' : 'none'
    );
  }
};
