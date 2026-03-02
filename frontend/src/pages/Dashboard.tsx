import { useEffect, useRef, useState } from 'react';
import { Box, Typography, Paper, Card, CardContent, Grid } from '@mui/material';
import { Map, NavigationControl, ScaleControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import indiaStateBounds from '../data/indiaStateBounds.json';

// Constants for India bounds - padded for better aspect ratio rendering
const DEFAULT_BOUNDS = [63.0, 1.5, 102.5, 42.5] as [number, number, number, number];
const DEFAULT_CENTER = [78.9629, 20.5937] as [number, number]; // Center of India
const DEFAULT_ZOOM = 4.5;

// Grid levels configuration (for future implementation)
// const GRID_LEVELS = [
//   { name: '500km', size: 500, minZoom: 3, maxZoom: 6, opacity: 0.8, color: '#e74c3c', width: 2.5 },
//   { name: '100km', size: 100, minZoom: 5, maxZoom: 8, opacity: 0.7, color: '#f39c12', width: 2 },
//   { name: '20km', size: 20, minZoom: 7, maxZoom: 10, opacity: 0.6, color: '#3498db', width: 1.5 },
//   { name: '5km', size: 5, minZoom: 9, maxZoom: 12, opacity: 0.5, color: '#9b59b6', width: 1 },
//   { name: '1km', size: 1, minZoom: 11, maxZoom: 20, opacity: 0.4, color: '#27ae60', width: 0.5 }
// ];

// Vector tile server configuration (for future implementation)
// const VECTOR_TILE_URL = import.meta.env.VITE_VECTOR_TILE_URL || 'http://localhost:8080/grids/{z}/{x}/{y}.pbf';

export default function Dashboard() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const map = useRef<Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(DEFAULT_ZOOM);
  const [currentCenter, setCurrentCenter] = useState(DEFAULT_CENTER);

  useEffect(() => {
    if (!mapContainer.current) return;

    // Initialize map
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

    console.log('Map initialized with container:', mapContainer.current);

    // Add navigation controls
    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    // Add scale control
    map.current.addControl(new maplibregl.ScaleControl(), 'bottom-left');

    // Handle map load event
    map.current.on('load', () => {
      if (!map.current) return;

      try {
        console.log('Adding India GeoJSON source...');
        console.log('India data:', indiaStateBounds);

        // Add India GeoJSON source
        map.current.addSource('officialIndia', {
          type: 'geojson',
          data: indiaStateBounds as GeoJSON.FeatureCollection
        });

        console.log('India source added, adding fill layer...');

        // Add India fill layer with bright color
        map.current.addLayer({
          id: 'india-bg',
          type: 'fill',
          source: 'officialIndia',
          paint: {
            'fill-color': '#10B981',
            'fill-opacity': 0.3
          }
        });

        console.log('Fill layer added, adding border layer...');

        // Add India borders layer with bright contrasting color
        map.current.addLayer({
          id: 'india-borders',
          type: 'line',
          source: 'officialIndia',
          paint: {
            'line-color': '#FBBF24',
            'line-width': 3,
            'line-opacity': 1
          }
        });

        console.log('Border layer added, fitting bounds...');

        // Fit map to India bounds
        const bounds = [
          [68.176645, 7.965535], // Southwest coordinates (min lon, min lat)
          [97.402561, 35.494010]  // Northeast coordinates (max lon, max lat)
        ] as [[number, number], [number, number]];

        map.current.fitBounds(bounds, {
          padding: 50,
          duration: 1000
        });

        console.log('India map layers added successfully!');
        console.log('Map sources:', map.current.getStyle().sources);
        console.log('Map layers:', map.current.getStyle().layers);
      } catch (error) {
        console.error('Error adding India map layers:', error);
      }

      // TODO: Add vector tile grid overlays when tile server is configured
      // Grid overlays require a vector tile server running at VECTOR_TILE_URL
      // This will be implemented in a future phase

      setMapLoaded(true);
    });

    // Update zoom and center on move
    map.current.on('move', () => {
      if (!map.current) return;
      setCurrentZoom(map.current.getZoom());
      const center = map.current.getCenter();
      setCurrentCenter([center.lng, center.lat]);
    });

    // Clean up on unmount
    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  // Function to add branch markers (placeholder for future implementation)
  const addBranchMarkers = () => {
    // This will be implemented when branch data is available
    // Will use clustering for performance with many markers
  };

  // Function to handle nearest branch finding (placeholder)
  const findNearestBranch = (lat: number, lng: number) => {
    // This will be implemented to query backend API
    console.log(`Finding nearest branch to: ${lat}, ${lng}`);
  };

  return (
    <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="h5" component="h1" gutterBottom>
          Territory Dashboard
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Interactive map with hierarchical grid overlay and India boundaries
        </Typography>
      </Box>

      {/* Map Info Cards */}
      <Grid container spacing={2} sx={{ p: 2 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Zoom Level
              </Typography>
              <Typography variant="h6">
                {currentZoom.toFixed(2)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Center
              </Typography>
              <Typography variant="body2">
                {currentCenter[1].toFixed(4)}°N, {currentCenter[0].toFixed(4)}°E
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Grid Overlay
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Coming Soon
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Map Status
              </Typography>
              <Typography variant="body2" color={mapLoaded ? 'success.main' : 'warning.main'}>
                {mapLoaded ? 'Ready' : 'Loading...'}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Map Legend */}
      <Paper sx={{ p: 2, mx: 2, mb: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Map Legend
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box
              sx={{
                width: 24,
                height: 16,
                backgroundColor: '#10B981',
                opacity: 0.3,
                border: '3px solid #FBBF24',
                borderRadius: 1
              }}
            />
            <Typography variant="caption">India (Green fill, Yellow border)</Typography>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            Grid overlays will be added in future phase
          </Typography>
        </Box>
      </Paper>

      {/* Map Container */}
      <Box
        ref={mapContainer}
        sx={{
          flexGrow: 1,
          width: '100%',
          minHeight: 400,
          position: 'relative',
          '& .maplibregl-ctrl-attrib': {
            display: 'none'
          }
        }}
      />
    </Box>
  );
}