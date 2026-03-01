import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Checkbox,
  CircularProgress,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Typography,
} from '@mui/material';
import maplibregl, { LngLatBoundsLike, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import indiaStateBounds from '../data/indiaStateBounds.json';
import 'maplibre-gl/dist/maplibre-gl.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';
const ALL_STATES = '__all__';
const LOCAL_INDIA_TOPO_SVG_URL = '/maps/india-topo-basemap.svg';
const FIT_PADDING = 0;

type GridBounds = [number, number, number, number];

type GridVisibility = {
  show500: boolean;
  show100: boolean;
  show10: boolean;
  show5: boolean;
  show1: boolean;
};

type ManifestResponse = {
  bounds?: GridBounds;
  center?: [number, number];
  levelsKm?: number[];
  configVersion?: number;
};

type StateBoundsEntry = {
  name: string;
  slug: string;
  bounds: GridBounds;
};

const DEFAULT_BOUNDS: GridBounds = [68.0, 6.5, 97.5, 37.5];
const DEFAULT_CENTER: [number, number] = [79.0, 22.5];
const STATE_BOUNDS = indiaStateBounds as StateBoundsEntry[];
const SORTED_STATES = [...STATE_BOUNDS].sort((a, b) => a.name.localeCompare(b.name));

function toLngLatBounds(bounds: GridBounds): LngLatBoundsLike {
  return [
    [bounds[0], bounds[1]],
    [bounds[2], bounds[3]],
  ];
}

function setLayerVisibility(map: MapLibreMap, layerId: string, visible: boolean) {
  if (!map.getLayer(layerId)) {
    return;
  }

  map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
}

function setGridLayerGroupVisibility(map: MapLibreMap, prefix: string, visible: boolean) {
  setLayerVisibility(map, `${prefix}-fill`, visible);
  setLayerVisibility(map, `${prefix}-line`, visible);
  setLayerVisibility(map, `${prefix}-label`, visible);
}

function getGridVisibilityForZoom(zoom: number): GridVisibility {
  if (zoom < 5) {
    return { show500: true, show100: true, show10: false, show5: false, show1: false };
  }

  if (zoom < 6) {
    return { show500: false, show100: true, show10: true, show5: false, show1: false };
  }

  if (zoom < 8) {
    return { show500: false, show100: false, show10: true, show5: true, show1: false };
  }

  return { show500: false, show100: false, show10: false, show5: true, show1: true };
}

export default function Dashboard() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [show500KmGrid, setShow500KmGrid] = useState(true);
  const [show100KmGrid, setShow100KmGrid] = useState(false);
  const [show10KmGrid, setShow10KmGrid] = useState(false);
  const [show5KmGrid, setShow5KmGrid] = useState(false);
  const [show1KmGrid, setShow1KmGrid] = useState(false);
  const [autoGridByZoom, setAutoGridByZoom] = useState(false);
  const [selectedState, setSelectedState] = useState(ALL_STATES);
  const [selectedZoom, setSelectedZoom] = useState('4');
  const [currentZoom, setCurrentZoom] = useState(4);
  const [manifest, setManifest] = useState<ManifestResponse | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const noGridSelected = !show500KmGrid && !show100KmGrid && !show10KmGrid && !show5KmGrid && !show1KmGrid;

  const mapBounds = useMemo<LngLatBoundsLike>(
    () => toLngLatBounds(manifest?.bounds || DEFAULT_BOUNDS),
    [manifest?.bounds]
  );

  const stateBoundsBySlug = useMemo(() => {
    const lookup = new Map<string, GridBounds>();
    for (const state of SORTED_STATES) {
      lookup.set(state.slug, state.bounds);
    }
    return lookup;
  }, []);

  const applyGridVisibilityPreset = (zoom: number) => {
    const next = getGridVisibilityForZoom(zoom);
    setShow500KmGrid(next.show500);
    setShow100KmGrid(next.show100);
    setShow10KmGrid(next.show10);
    setShow5KmGrid(next.show5);
    setShow1KmGrid(next.show1);
  };

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      setMapError(null);

      try {
        const manifestResponse = await fetch(`${API_URL}/grids/manifest`);
        if (!manifestResponse.ok) {
          throw new Error(`Grid manifest request failed (${manifestResponse.status})`);
        }

        const manifestData = (await manifestResponse.json()) as ManifestResponse;
        setManifest(manifestData);
      } catch (error: any) {
        console.error('Failed to load grid manifest:', error);
        setMapError(error.message || 'Failed to load grid manifest');
      } finally {
        setLoading(false);
      }
    };

    bootstrap();
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    const style: StyleSpecification = {
      version: 8,
      glyphs: '/glyphs/{fontstack}/{range}.pbf',
      sources: {
        indiaTopoSvg: {
          type: 'image',
          url: LOCAL_INDIA_TOPO_SVG_URL,
          coordinates: [
            [DEFAULT_BOUNDS[0], DEFAULT_BOUNDS[3]],
            [DEFAULT_BOUNDS[2], DEFAULT_BOUNDS[3]],
            [DEFAULT_BOUNDS[2], DEFAULT_BOUNDS[1]],
            [DEFAULT_BOUNDS[0], DEFAULT_BOUNDS[1]],
          ],
        },
        grid500: {
          type: 'vector',
          tiles: [`${API_URL}/grids/tiles/500/{z}/{x}/{y}.pbf`],
          minzoom: 0,
          maxzoom: 14,
        },
        grid100: {
          type: 'vector',
          tiles: [`${API_URL}/grids/tiles/100/{z}/{x}/{y}.pbf`],
          minzoom: 0,
          maxzoom: 14,
        },
        grid10: {
          type: 'vector',
          tiles: [`${API_URL}/grids/tiles/10/{z}/{x}/{y}.pbf`],
          minzoom: 5,
          maxzoom: 14,
        },
        grid5: {
          type: 'vector',
          tiles: [`${API_URL}/grids/tiles/5/{z}/{x}/{y}.pbf`],
          minzoom: 6,
          maxzoom: 14,
        },
        grid1: {
          type: 'vector',
          tiles: [`${API_URL}/grids/tiles/1/{z}/{x}/{y}.pbf`],
          minzoom: 8,
          maxzoom: 14,
        },
      },
      layers: [
        {
          id: 'background',
          type: 'background',
          paint: {
            'background-color': '#BFD2E6',
          },
        },
        {
          id: 'india-topo-svg',
          type: 'raster',
          source: 'indiaTopoSvg',
          paint: {
            'raster-opacity': 1,
          },
        },
        {
          id: 'grid500-fill',
          type: 'fill',
          source: 'grid500',
          'source-layer': 'grid_cells',
          paint: {
            'fill-color': '#14B8A6',
            'fill-opacity': 0.08,
          },
        },
        {
          id: 'grid500-line',
          type: 'line',
          source: 'grid500',
          'source-layer': 'grid_cells',
          paint: {
            'line-color': '#0F766E',
            'line-width': 1,
          },
        },
        {
          id: 'grid500-label',
          type: 'symbol',
          source: 'grid500',
          'source-layer': 'grid_labels',
          layout: {
            'text-field': ['get', 'code'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 11,
            'text-anchor': 'top-left',
            'text-offset': [0.18, 0.2],
            'text-allow-overlap': true,
          },
          paint: {
            'text-color': '#0F172A',
            'text-halo-color': '#FFFFFF',
            'text-halo-width': 0.9,
          },
        },
        {
          id: 'grid100-fill',
          type: 'fill',
          source: 'grid100',
          'source-layer': 'grid_cells',
          paint: {
            'fill-color': '#38BDF8',
            'fill-opacity': 0.03,
          },
        },
        {
          id: 'grid100-line',
          type: 'line',
          source: 'grid100',
          'source-layer': 'grid_cells',
          paint: {
            'line-color': '#0369A1',
            'line-width': 0.8,
          },
        },
        {
          id: 'grid100-label',
          type: 'symbol',
          source: 'grid100',
          'source-layer': 'grid_labels',
          minzoom: 5,
          layout: {
            'text-field': ['get', 'code'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 9,
            'text-anchor': 'top-left',
            'text-offset': [0.16, 0.18],
            'text-allow-overlap': true,
          },
          paint: {
            'text-color': '#0C4A6E',
            'text-halo-color': '#FFFFFF',
            'text-halo-width': 0.7,
          },
        },
        {
          id: 'grid10-fill',
          type: 'fill',
          source: 'grid10',
          'source-layer': 'grid_cells',
          minzoom: 5,
          paint: {
            'fill-color': '#0284C7',
            'fill-opacity': 0.02,
          },
        },
        {
          id: 'grid10-line',
          type: 'line',
          source: 'grid10',
          'source-layer': 'grid_cells',
          minzoom: 5,
          paint: {
            'line-color': '#0EA5E9',
            'line-width': 0.7,
          },
        },
        {
          id: 'grid10-label',
          type: 'symbol',
          source: 'grid10',
          'source-layer': 'grid_labels',
          minzoom: 6,
          layout: {
            'text-field': ['get', 'code'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 8,
            'text-anchor': 'top-left',
            'text-offset': [0.14, 0.16],
            'text-allow-overlap': true,
          },
          paint: {
            'text-color': '#075985',
            'text-halo-color': '#FFFFFF',
            'text-halo-width': 0.6,
          },
        },
        {
          id: 'grid5-fill',
          type: 'fill',
          source: 'grid5',
          'source-layer': 'grid_cells',
          minzoom: 6,
          paint: {
            'fill-color': '#2563EB',
            'fill-opacity': 0.015,
          },
        },
        {
          id: 'grid5-line',
          type: 'line',
          source: 'grid5',
          'source-layer': 'grid_cells',
          minzoom: 6,
          paint: {
            'line-color': '#1D4ED8',
            'line-width': 0.55,
          },
        },
        {
          id: 'grid5-label',
          type: 'symbol',
          source: 'grid5',
          'source-layer': 'grid_labels',
          minzoom: 7,
          layout: {
            'text-field': ['get', 'code'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 7,
            'text-anchor': 'top-left',
            'text-offset': [0.12, 0.14],
            'text-allow-overlap': true,
          },
          paint: {
            'text-color': '#1E3A8A',
            'text-halo-color': '#FFFFFF',
            'text-halo-width': 0.55,
          },
        },
        {
          id: 'grid1-fill',
          type: 'fill',
          source: 'grid1',
          'source-layer': 'grid_cells',
          minzoom: 8,
          paint: {
            'fill-color': '#4F46E5',
            'fill-opacity': 0.01,
          },
        },
        {
          id: 'grid1-line',
          type: 'line',
          source: 'grid1',
          'source-layer': 'grid_cells',
          minzoom: 8,
          paint: {
            'line-color': '#4338CA',
            'line-width': 0.4,
          },
        },
        {
          id: 'grid1-label',
          type: 'symbol',
          source: 'grid1',
          'source-layer': 'grid_labels',
          minzoom: 9,
          layout: {
            'text-field': ['get', 'code'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 6,
            'text-anchor': 'top-left',
            'text-offset': [0.1, 0.12],
            'text-allow-overlap': true,
          },
          paint: {
            'text-color': '#312E81',
            'text-halo-color': '#FFFFFF',
            'text-halo-width': 0.5,
          },
        },
      ],
    };

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style,
      center: DEFAULT_CENTER,
      zoom: 4,
      bearing: 0,
      pitch: 0,
      minZoom: 3,
      maxZoom: 11,
      maxBounds: toLngLatBounds(DEFAULT_BOUNDS),
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
      })
    );

    const onZoomEnd = () => {
      const zoom = map.getZoom();
      setCurrentZoom(Number(zoom.toFixed(2)));
      setSelectedZoom(String(Math.round(zoom)));
      if (autoGridByZoom) {
        applyGridVisibilityPreset(zoom);
      }
    };

    map.on('load', () => {
      setMapReady(true);
      setSelectedState(ALL_STATES);
      map.fitBounds(toLngLatBounds(DEFAULT_BOUNDS), { padding: FIT_PADDING, duration: 0 });
      map.touchZoomRotate.disableRotation();
      const zoom = map.getZoom();
      setCurrentZoom(Number(zoom.toFixed(2)));
      setSelectedZoom(String(Math.round(zoom)));
      if (autoGridByZoom) {
        applyGridVisibilityPreset(zoom);
      }
    });

    map.on('zoomend', onZoomEnd);

    map.on('error', (event) => {
      const error = event.error as Error;
      console.error('MapLibre error:', error);
    });

    mapRef.current = map;

    return () => {
      setMapReady(false);
      map.off('zoomend', onZoomEnd);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }

    const bounds = toLngLatBounds(manifest?.bounds || DEFAULT_BOUNDS);
    map.setMaxBounds(bounds);
  }, [manifest?.bounds, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }

    setGridLayerGroupVisibility(map, 'grid500', show500KmGrid);
    setGridLayerGroupVisibility(map, 'grid100', show100KmGrid);
    setGridLayerGroupVisibility(map, 'grid10', show10KmGrid);
    setGridLayerGroupVisibility(map, 'grid5', show5KmGrid);
    setGridLayerGroupVisibility(map, 'grid1', show1KmGrid);
  }, [mapReady, show1KmGrid, show5KmGrid, show10KmGrid, show100KmGrid, show500KmGrid]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }

    if (selectedState === ALL_STATES) {
      map.fitBounds(mapBounds, { padding: FIT_PADDING, duration: 0 });
      return;
    }

    const stateBounds = stateBoundsBySlug.get(selectedState);
    if (!stateBounds) {
      return;
    }
    map.fitBounds(toLngLatBounds(stateBounds), { padding: FIT_PADDING, duration: 400 });
  }, [mapBounds, mapReady, selectedState, stateBoundsBySlug]);

  useEffect(() => {
    if (!autoGridByZoom) {
      return;
    }

    const map = mapRef.current;
    if (!map) {
      return;
    }
    applyGridVisibilityPreset(map.getZoom());
  }, [autoGridByZoom]);

  const onStateChange = (value: string) => {
    setSelectedState(value);
  };

  const onZoomSelect = (value: string) => {
    setSelectedZoom(value);
    const map = mapRef.current;
    if (!map) {
      return;
    }

    map.flyTo({
      zoom: Number(value),
      duration: 500,
    });
  };

  return (
    <Box sx={{ width: '100%', minHeight: '100%', p: 3, bgcolor: '#F8FAFC' }}>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h4" gutterBottom sx={{ fontWeight: 700, color: '#0F172A' }}>
          Dashboard
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Local India boundary + vector-tile grid overlays (500, 100, 10, 5, 1 km).
        </Typography>
      </Box>

      {mapError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setMapError(null)}>
          {mapError}
        </Alert>
      )}

      <Paper
        sx={{
          p: 2,
          mb: 2,
          borderRadius: 2,
          boxShadow: 2,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 2,
          alignItems: 'center',
        }}
      >
        <FormControl size="small" sx={{ minWidth: 170 }}>
          <InputLabel id="state-select-label">State View</InputLabel>
          <Select
            labelId="state-select-label"
            label="State View"
            value={selectedState}
            onChange={(event) => onStateChange(String(event.target.value))}
          >
            <MenuItem value={ALL_STATES}>All India</MenuItem>
            {SORTED_STATES.map((state) => (
              <MenuItem key={state.slug} value={state.slug}>
                {state.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel id="zoom-select-label">Zoom</InputLabel>
          <Select
            labelId="zoom-select-label"
            label="Zoom"
            value={selectedZoom}
            onChange={(event) => onZoomSelect(String(event.target.value))}
          >
            <MenuItem value="4">4</MenuItem>
            <MenuItem value="5">5</MenuItem>
            <MenuItem value="6">6</MenuItem>
            <MenuItem value="7">7</MenuItem>
            <MenuItem value="8">8</MenuItem>
            <MenuItem value="9">9</MenuItem>
            <MenuItem value="10">10</MenuItem>
            <MenuItem value="11">11</MenuItem>
          </Select>
        </FormControl>

        <FormControlLabel
          control={
            <Checkbox
              checked={autoGridByZoom}
              onChange={(event) => setAutoGridByZoom(event.target.checked)}
            />
          }
          label="Auto Grid by Zoom"
        />

        <FormControlLabel
          control={
            <Checkbox
              checked={show500KmGrid}
              onChange={(event) => setShow500KmGrid(event.target.checked)}
              disabled={autoGridByZoom}
            />
          }
          label="500 km"
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={show100KmGrid}
              onChange={(event) => setShow100KmGrid(event.target.checked)}
              disabled={autoGridByZoom}
            />
          }
          label="100 km"
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={show10KmGrid}
              onChange={(event) => setShow10KmGrid(event.target.checked)}
              disabled={autoGridByZoom}
            />
          }
          label="10 km"
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={show5KmGrid}
              onChange={(event) => setShow5KmGrid(event.target.checked)}
              disabled={autoGridByZoom}
            />
          }
          label="5 km"
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={show1KmGrid}
              onChange={(event) => setShow1KmGrid(event.target.checked)}
              disabled={autoGridByZoom}
            />
          }
          label="1 km"
        />

        <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
          Zoom: {currentZoom}
        </Typography>
        {loading && <CircularProgress size={18} />}
      </Paper>

      {noGridSelected && (
        <Alert severity="info" sx={{ mb: 2 }}>
          SVG basemap is visible. Enable one or more grid layers (500/100/10/5/1 km) to see overlays.
        </Alert>
      )}

      <Paper sx={{ borderRadius: 2, boxShadow: 2, overflow: 'hidden' }}>
        <Box ref={mapContainerRef} sx={{ height: { xs: '55vh', md: '70vh' }, width: '100%' }} />
      </Paper>
    </Box>
  );
}
