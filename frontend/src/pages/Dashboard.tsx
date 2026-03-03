import { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { Map, NavigationControl, ScaleControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreCspWorkerUrl from 'maplibre-gl/dist/maplibre-gl-csp-worker.js?url';
import { type DashboardGridLevelId, useStore } from '../store/useStore';

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
const EMPTY_GRID_FEATURE_COLLECTION = {
  type: 'FeatureCollection',
  features: []
} as GeoJSON.FeatureCollection<GeoJSON.LineString>;

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

export default function Dashboard() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const map = useRef<Map | null>(null);
  const updateGridOverlayRef = useRef<() => void>(() => undefined);
  const setDashboardMapPanel = useStore((state) => state.setDashboardMapPanel);
  const resetDashboardMapPanel = useStore((state) => state.resetDashboardMapPanel);
  const selectedGridLevels = useStore((state) => state.dashboardSelectedGridLevels);
  const selectedGridLevelsRef = useRef<DashboardGridLevelId[]>(selectedGridLevels);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [currentZoom, setCurrentZoom] = useState(DEFAULT_ZOOM);
  const [currentCenter, setCurrentCenter] = useState(DEFAULT_CENTER);
  const [currentGridLabel, setCurrentGridLabel] = useState(
    buildGridOverlayLabel(selectedGridLevels, DEFAULT_ZOOM)
  );

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

    map.current.addControl(new NavigationControl(), 'top-right');
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
        map.current.addSource('officialIndia', {
          type: 'geojson',
          data: OFFICIAL_INDIA_GEOJSON_URL
        });

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
    selectedGridLevelsRef.current = selectedGridLevels;
    const zoomForLabel = map.current ? map.current.getZoom() : DEFAULT_ZOOM;
    setCurrentGridLabel(buildGridOverlayLabel(selectedGridLevels, zoomForLabel));
    updateGridOverlayRef.current();
  }, [selectedGridLevels]);

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
    <Box sx={{ width: '100%', height: '100%', minHeight: 0 }}>
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
    </Box>
  );
}
