import { useEffect, useRef, useState } from 'react';
import { Map, NavigationControl, ScaleControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreCspWorkerUrl from 'maplibre-gl/dist/maplibre-gl-csp-worker.js?url';
import type { DashboardGridLevelId } from '../../../store/useStore';
import {
  DEFAULT_BOUNDS,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  KM_GRID_LEVELS,
  OFFICIAL_INDIA_GEOJSON_URL,
  STATE_BORDERS_GEOJSON_URL,
  STATE_BORDERS_LAYER_ID,
  STATE_BORDERS_SOURCE_ID,
} from '../constants';
import { addGridOverlaySources, buildGridOverlayLabel, syncGridOverlay } from '../layers/GridOverlayLayer';
import { buildMapStatusMessage } from '../mapDiagnostics';
import logger from '../../../utils/logger';

setWorkerUrl(maplibreCspWorkerUrl);

type UseMapInstanceOptions = {
  selectedGridLevels: DashboardGridLevelId[];
  onMapClick: (lat: number, lng: number) => void;
  onMapReady: (mapInstance: Map) => void;
};

export const useMapInstance = ({
  selectedGridLevels,
  onMapClick,
  onMapReady,
}: UseMapInstanceOptions) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const selectedGridLevelsRef = useRef(selectedGridLevels);
  const mapReadyHandlerRef = useRef(onMapReady);
  const mapClickHandlerRef = useRef(onMapClick);
  const gridUpdateDebounceRef = useRef<number | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [currentZoom, setCurrentZoom] = useState(DEFAULT_ZOOM);
  const [currentCenter, setCurrentCenter] = useState(DEFAULT_CENTER);
  const [currentGridLabel, setCurrentGridLabel] = useState(
    buildGridOverlayLabel(selectedGridLevels, DEFAULT_ZOOM)
  );

  useEffect(() => {
    selectedGridLevelsRef.current = selectedGridLevels;
    mapReadyHandlerRef.current = onMapReady;
    mapClickHandlerRef.current = onMapClick;
  }, [selectedGridLevels, onMapReady, onMapClick]);

  const queueGridOverlayUpdate = () => {
    if (gridUpdateDebounceRef.current !== null) {
      clearTimeout(gridUpdateDebounceRef.current);
    }

    gridUpdateDebounceRef.current = window.setTimeout(() => {
      if (!mapRef.current || !mapRef.current.isStyleLoaded()) return;
      setCurrentGridLabel(syncGridOverlay(mapRef.current, selectedGridLevelsRef.current));
    }, 120);
  };

  useEffect(() => {
    if (!mapContainerRef.current) return;

    mapRef.current = new Map({
      container: mapContainerRef.current,
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

    mapRef.current.addControl(new NavigationControl(), 'bottom-right');
    mapRef.current.addControl(new ScaleControl(), 'bottom-left');

    const parentElement = mapContainerRef.current.parentElement;
    const resizeObserver = parentElement
      ? new ResizeObserver(() => {
        window.requestAnimationFrame(() => {
          mapRef.current?.resize();
        });
      })
      : null;
    const initialResizeFrame = window.requestAnimationFrame(() => {
      mapRef.current?.resize();
    });

    if (resizeObserver && parentElement) {
      resizeObserver.observe(parentElement);
    }

    mapRef.current.on('error', (event) => {
      if (!mapRef.current) return;

      const typedEvent = event as {
        error?: unknown;
        sourceId?: string;
        sourceType?: string;
        tile?: unknown;
      };

      const statusMessage = buildMapStatusMessage(
        'Map rendering error',
        mapRef.current,
        {
          styleLoaded: mapRef.current.isStyleLoaded(),
          sourceId: typedEvent.sourceId,
          sourceType: typedEvent.sourceType,
          tile: typedEvent.tile
        },
        typedEvent.error ?? event
      );

      logger.error('Map render error', typedEvent.error ?? event);
      setMapLoaded(false);
      setMapError(statusMessage);
    });

    mapRef.current.on('load', () => {
      if (!mapRef.current) return;

      try {
        mapRef.current.addSource('officialIndia', {
          type: 'geojson',
          data: OFFICIAL_INDIA_GEOJSON_URL
        });

        mapRef.current.addLayer({
          id: 'india-bg',
          type: 'fill',
          source: 'officialIndia',
          paint: {
            'fill-color': '#93C5FD',
            'fill-opacity': 0.6
          }
        });

        mapRef.current.addSource(STATE_BORDERS_SOURCE_ID, {
          type: 'geojson',
          data: STATE_BORDERS_GEOJSON_URL
        });

        addGridOverlaySources(mapRef.current);

        mapRef.current.addLayer({
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

        mapRef.current.addLayer({
          id: 'india-borders',
          type: 'line',
          source: 'officialIndia',
          paint: {
            'line-color': '#FDE047',
            'line-width': 4,
            'line-opacity': 1
          }
        });

        mapReadyHandlerRef.current(mapRef.current);

        mapRef.current.fitBounds(
          [
            [68.176645, 7.965535],
            [97.402561, 35.49401]
          ] as [[number, number], [number, number]],
          {
            padding: 50,
            duration: 1000
          }
        );

        mapRef.current.once('idle', () => {
          if (!mapRef.current) return;

          const hasIndiaLayers =
            Boolean(mapRef.current.getLayer('india-bg')) &&
            Boolean(mapRef.current.getLayer('india-borders'));
          const hasStateBordersLayer = Boolean(mapRef.current.getLayer(STATE_BORDERS_LAYER_ID));
          const hasGridLayers = KM_GRID_LEVELS.every(
            (gridLevel) => Boolean(mapRef.current?.getLayer(`dashboard-grid-lines-${gridLevel.id}`))
          );

          if (!hasIndiaLayers || !hasStateBordersLayer || !hasGridLayers) {
            setMapLoaded(false);
            setMapError(buildMapStatusMessage(
              'Required map layers not available',
              mapRef.current,
              {
                styleLoaded: mapRef.current.isStyleLoaded(),
                hasIndiaSource: Boolean(mapRef.current.getSource('officialIndia')),
                hasIndiaFillLayer: Boolean(mapRef.current.getLayer('india-bg')),
                hasIndiaBorderLayer: Boolean(mapRef.current.getLayer('india-borders')),
                hasStateBorderSource: Boolean(mapRef.current.getSource(STATE_BORDERS_SOURCE_ID)),
                hasStateBorderLayer: hasStateBordersLayer,
                hasGridLayers,
                selectedGridLevels: selectedGridLevelsRef.current
              }
            ));
            return;
          }

          const visibleIndia = mapRef.current.queryRenderedFeatures(undefined, {
            layers: ['india-bg']
          });

          let sourceFeatureCount: number | 'unavailable' = 'unavailable';
          try {
            sourceFeatureCount = mapRef.current.querySourceFeatures('officialIndia').length;
          } catch {
            sourceFeatureCount = 'unavailable';
          }

          if (visibleIndia.length === 0) {
            setMapLoaded(false);
            setMapError(buildMapStatusMessage(
              'India polygon not visible in current view',
              mapRef.current,
              {
                styleLoaded: mapRef.current.isStyleLoaded(),
                renderedFeatureCount: visibleIndia.length,
                sourceFeatureCount,
                hasIndiaSource: Boolean(mapRef.current.getSource('officialIndia')),
                hasIndiaFillLayer: Boolean(mapRef.current.getLayer('india-bg')),
                hasIndiaBorderLayer: Boolean(mapRef.current.getLayer('india-borders')),
                hasStateBorderLayer: Boolean(mapRef.current.getLayer(STATE_BORDERS_LAYER_ID)),
                hasGridLayers,
                selectedGridLevels: selectedGridLevelsRef.current
              }
            ));
          }
        });

        setMapError(null);
        setMapLoaded(true);
        queueGridOverlayUpdate();
      } catch (error) {
        logger.error('Error adding India map layers', error);
        setMapLoaded(false);
        setMapError(buildMapStatusMessage('India layer failed to render', mapRef.current, undefined, error));
      }
    });

    mapRef.current.on('move', () => {
      if (!mapRef.current) return;
      setCurrentZoom(mapRef.current.getZoom());
      const center = mapRef.current.getCenter();
      setCurrentCenter([center.lng, center.lat]);
      queueGridOverlayUpdate();
    });
    mapRef.current.on('moveend', queueGridOverlayUpdate);
    mapRef.current.on('zoomend', queueGridOverlayUpdate);
    mapRef.current.on('click', (event) => {
      mapClickHandlerRef.current(event.lngLat.lat, event.lngLat.lng);
    });

    return () => {
      window.cancelAnimationFrame(initialResizeFrame);
      resizeObserver?.disconnect();
      if (gridUpdateDebounceRef.current !== null) {
        clearTimeout(gridUpdateDebounceRef.current);
        gridUpdateDebounceRef.current = null;
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    selectedGridLevelsRef.current = selectedGridLevels;
    const zoomForLabel = mapRef.current ? mapRef.current.getZoom() : DEFAULT_ZOOM;
    setCurrentGridLabel(buildGridOverlayLabel(selectedGridLevels, zoomForLabel));
    queueGridOverlayUpdate();
  }, [selectedGridLevels]);

  return {
    mapContainerRef,
    mapRef,
    mapLoaded,
    mapError,
    currentZoom,
    currentCenter,
    currentGridLabel,
  };
};
