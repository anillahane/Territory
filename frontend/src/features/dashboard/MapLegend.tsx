import { useState } from 'react';
import {
  Box,
  Checkbox,
  Collapse,
  Divider,
  IconButton,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';
import { DASHBOARD_GRID_LEVELS, useStore } from '../../store/useStore';

export function MapLegend() {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(true);
  const dashboardMapPanel = useStore((state) => state.dashboardMapPanel);
  const selectedGridLevels = useStore((state) => state.dashboardSelectedGridLevels);
  const toggleDashboardGridLevel = useStore((state) => state.toggleDashboardGridLevel);
  const showBranches = useStore((state) => state.showBranches);
  const setShowBranches = useStore((state) => state.setShowBranches);

  const mapStatusLabel = dashboardMapPanel.mapError || (dashboardMapPanel.mapLoaded ? 'Ready' : 'Loading...');
  const mapStatusColor = dashboardMapPanel.mapError
    ? theme.palette.error.main
    : (dashboardMapPanel.mapLoaded ? theme.palette.success.main : theme.palette.warning.main);

  return (
    <Paper
      component="aside"
      aria-label="Map legend"
      sx={{
        position: 'absolute',
        right: { xs: 12, md: 16 },
        bottom: { xs: 12, md: 16 },
        width: { xs: 'calc(100% - 24px)', sm: 320 },
        maxWidth: 360,
        borderRadius: 3,
        backgroundColor: alpha(theme.palette.background.paper, 0.94),
        backdropFilter: 'blur(10px)',
        boxShadow: `0 18px 50px ${alpha(theme.palette.common.black, 0.12)}`,
        zIndex: 10,
      }}
    >
      <Box sx={{ px: 1.75, py: 1.25 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: 'text.primary' }}>
            Map Legend
          </Typography>
          <IconButton
            aria-controls="dashboard-map-legend-content"
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse map legend' : 'Expand map legend'}
            onClick={() => setExpanded((previous) => !previous)}
            size="small"
            sx={{ color: 'text.secondary' }}
          >
            {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
        </Stack>

        <Collapse id="dashboard-map-legend-content" in={expanded} timeout="auto" unmountOnExit>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1, mb: 0.6 }}>
            <Box
              sx={{
                width: 18,
                height: 12,
                backgroundColor: 'info.light',
                opacity: 0.6,
                border: `2px solid ${theme.palette.warning.light}`,
                borderRadius: 1,
                flexShrink: 0,
              }}
            />
            <Typography sx={{ fontSize: '0.6875rem', color: 'text.primary' }}>
              India (Light blue fill, yellow border)
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.8 }}>
            <Box
              sx={{
                width: 18,
                height: 0,
                borderTop: `2px solid ${theme.palette.divider}`,
                flexShrink: 0,
              }}
            />
            <Typography sx={{ fontSize: '0.6875rem', color: 'text.primary' }}>
              State borders
            </Typography>
          </Box>

          <Divider sx={{ my: 1 }} />

          <Typography sx={{ fontSize: '0.6875rem', color: 'text.secondary', mb: 0.25 }}>
            Zoom Level
          </Typography>
          <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: 'text.primary', mb: 0.75 }}>
            {dashboardMapPanel.zoomLevel.toFixed(2)}
          </Typography>

          <Typography sx={{ fontSize: '0.6875rem', color: 'text.secondary', mb: 0.25 }}>
            Center
          </Typography>
          <Typography sx={{ fontSize: '0.75rem', color: 'text.primary', mb: 0.75 }}>
            {dashboardMapPanel.center[1].toFixed(4)}degN, {dashboardMapPanel.center[0].toFixed(4)}degE
          </Typography>

          <Typography sx={{ fontSize: '0.6875rem', color: 'text.secondary', mb: 0.25 }}>
            Grid Overlay
          </Typography>
          <Typography sx={{ fontSize: '0.75rem', color: 'text.primary', mb: 0.75 }}>
            {dashboardMapPanel.gridOverlay}
          </Typography>

          <Typography sx={{ fontSize: '0.6875rem', color: 'text.secondary', mb: 0.3 }}>
            Grid Layers
          </Typography>
          <Box sx={{ mb: 0.75 }}>
            {DASHBOARD_GRID_LEVELS.map((gridLevel) => {
              const isSelected = selectedGridLevels.includes(gridLevel.id);
              const zoomEligible = dashboardMapPanel.zoomLevel >= gridLevel.minZoom;

              return (
                <Stack
                  key={gridLevel.id}
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  spacing={1}
                  sx={{ mb: 0.15 }}
                >
                  <Stack direction="row" alignItems="center" spacing={0.4} sx={{ minWidth: 0 }}>
                    <Checkbox
                      size="small"
                      checked={isSelected}
                      onChange={() => toggleDashboardGridLevel(gridLevel.id)}
                      sx={{ p: 0.3 }}
                    />
                    <Typography sx={{ fontSize: '0.6875rem', color: 'text.primary' }}>
                      {gridLevel.label}
                    </Typography>
                  </Stack>
                  {gridLevel.minZoom >= 6 ? (
                    <Typography
                      sx={{
                        fontSize: '0.625rem',
                        color: zoomEligible ? 'success.main' : 'text.disabled',
                      }}
                    >
                      z6+
                    </Typography>
                  ) : null}
                </Stack>
              );
            })}
          </Box>

          <Typography sx={{ fontSize: '0.6875rem', color: 'text.secondary', mb: 0.3 }}>
            Overlays
          </Typography>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 0.75 }}>
            <Stack direction="row" alignItems="center" spacing={0.4} sx={{ minWidth: 0 }}>
              <Checkbox
                size="small"
                checked={showBranches}
                onChange={(event) => setShowBranches(event.target.checked)}
                sx={{ p: 0.3 }}
              />
              <Typography sx={{ fontSize: '0.6875rem', color: 'text.primary' }}>
                Branches (red dots)
              </Typography>
            </Stack>
          </Stack>

          <Typography sx={{ fontSize: '0.6875rem', color: 'text.secondary', mb: 0.25 }}>
            Map Status
          </Typography>
          <Typography
            sx={{
              fontSize: '0.6875rem',
              color: mapStatusColor,
              lineHeight: 1.35,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 104,
              overflowY: 'auto',
            }}
          >
            {mapStatusLabel}
          </Typography>
        </Collapse>
      </Box>
    </Paper>
  );
}
