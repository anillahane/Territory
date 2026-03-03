import { Outlet, Link, useLocation } from 'react-router-dom';
import { useState } from 'react';
import {
  Box,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Divider,
  IconButton,
  Checkbox,
  Tooltip,
  Collapse,
} from '@mui/material';
import {
  Dashboard as DashboardIcon,
  Settings as SettingsIcon,
  Business as BusinessIcon,
  Calculate as CalculateIcon,
  CloudUpload as CloudUploadIcon,
  TableChart as TableChartIcon,
  Menu as MenuIcon,
  ChevronLeft as ChevronLeftIcon,
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';
import { DASHBOARD_GRID_LEVELS, useStore } from '../store/useStore';

const drawerWidth = 240;
const drawerWidthCollapsed = 64;

export default function Layout() {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mapLegendExpanded, setMapLegendExpanded] = useState(true);
  const dashboardMapPanel = useStore((state) => state.dashboardMapPanel);
  const selectedGridLevels = useStore((state) => state.dashboardSelectedGridLevels);
  const toggleDashboardGridLevel = useStore((state) => state.toggleDashboardGridLevel);
  const showBranches = useStore((state) => state.showBranches);
  const setShowBranches = useStore((state) => state.setShowBranches);
  const isDashboardRoute = location.pathname === '/';

  const navItems = [
    { path: '/', label: 'Dashboard', icon: <DashboardIcon /> },
    { path: '/branches', label: 'Branches', icon: <BusinessIcon /> },
    { path: '/batch', label: 'Batch Processing', icon: <CloudUploadIcon /> },
    { path: '/mappings', label: 'Customer Pocket Mappings', icon: <TableChartIcon /> },
  ];

  const adminItems = [
    { path: '/calculator', label: 'Pocket ID Calculator', icon: <CalculateIcon /> },
    { path: '/config', label: 'System Configuration', icon: <SettingsIcon /> },
  ];

  const toggleSidebar = () => {
    setSidebarOpen((prev) => !prev);
    window.setTimeout(() => {
      window.dispatchEvent(new Event('dashboard-layout-resize'));
    }, 220);
  };

  const mapStatusLabel = dashboardMapPanel.mapError || (dashboardMapPanel.mapLoaded ? 'Ready' : 'Loading...');
  const mapStatusColor = dashboardMapPanel.mapError
    ? '#DC2626'
    : (dashboardMapPanel.mapLoaded ? '#059669' : '#D97706');

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#F8FAFC' }}>
      {/* Sidebar */}
      <Drawer
        variant="permanent"
        sx={{
          width: sidebarOpen ? drawerWidth : drawerWidthCollapsed,
          flexShrink: 0,
          transition: 'width 0.2s',
          '& .MuiDrawer-paper': {
            width: sidebarOpen ? drawerWidth : drawerWidthCollapsed,
            boxSizing: 'border-box',
            borderRight: '1px solid #E2E8F0',
            background: '#FFFFFF',
            transition: 'width 0.2s',
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          },
        }}
      >
        {/* Logo/Brand */}
        <Box
          sx={{
            p: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
            borderBottom: '1px solid #F1F5F9',
            minHeight: 68,
          }}
        >
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #1E40AF, #059669)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '16px',
              fontWeight: 800,
              color: '#FFFFFF',
              flexShrink: 0,
            }}
          >
            LP
          </Box>
          {sidebarOpen && (
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                sx={{
                  fontSize: '15px',
                  fontWeight: 700,
                  color: '#0F172A',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                Location Pockets
              </Typography>
              <Typography
                sx={{
                  fontSize: '9px',
                  color: '#94A3B8',
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                Territory Management
              </Typography>
            </Box>
          )}
          <IconButton
            onClick={toggleSidebar}
            size="small"
            sx={{
              color: '#64748B',
              flexShrink: 0,
              ml: sidebarOpen ? 0 : -1,
            }}
          >
            {sidebarOpen ? <ChevronLeftIcon /> : <MenuIcon />}
          </IconButton>
        </Box>

        {/* Navigation */}
        <List sx={{ px: 1, py: 1.5, flex: 1 }}>
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <ListItem key={item.path} disablePadding sx={{ mb: 0.5 }}>
                <Tooltip title={!sidebarOpen ? item.label : ''} placement="right">
                  <ListItemButton
                    component={Link}
                    to={item.path}
                    sx={{
                      borderRadius: '8px',
                      py: 1.125,
                      px: 1.5,
                      transition: '0.15s',
                      color: isActive ? '#1E40AF' : '#64748B',
                      background: isActive ? 'rgba(37, 99, 235, 0.08)' : 'transparent',
                      fontWeight: isActive ? 600 : 400,
                      justifyContent: sidebarOpen ? 'flex-start' : 'center',
                      '&:hover': {
                        background: isActive ? 'rgba(37, 99, 235, 0.12)' : 'rgba(0, 0, 0, 0.04)',
                      },
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        minWidth: sidebarOpen ? 36 : 'auto',
                        color: 'inherit',
                        fontSize: '20px',
                        justifyContent: 'center',
                      }}
                    >
                      {item.icon}
                    </ListItemIcon>
                    {sidebarOpen && (
                      <ListItemText
                        primary={item.label}
                        primaryTypographyProps={{
                          fontSize: '13px',
                          fontWeight: 'inherit',
                        }}
                      />
                    )}
                  </ListItemButton>
                </Tooltip>
              </ListItem>
            );
          })}

          {isDashboardRoute && sidebarOpen && (
            <Box
              sx={{
                mt: 1.25,
                mb: 1,
                p: 1.25,
                border: '1px solid #E2E8F0',
                borderRadius: '10px',
                background: '#F8FAFC',
              }}
            >
              <Box
                onClick={() => setMapLegendExpanded((prev) => !prev)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  mb: mapLegendExpanded ? 0.75 : 0
                }}
              >
                <Typography sx={{ fontSize: '11px', fontWeight: 700, color: '#0F172A' }}>
                  Map Legend
                </Typography>
                <IconButton size="small" sx={{ p: 0.2, color: '#64748B' }}>
                  {mapLegendExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                </IconButton>
              </Box>
              <Collapse in={mapLegendExpanded} timeout="auto" unmountOnExit>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.6 }}>
                <Box
                  sx={{
                    width: 18,
                    height: 12,
                    backgroundColor: '#93C5FD',
                    opacity: 0.6,
                    border: '2px solid #FDE047',
                    borderRadius: '4px',
                    flexShrink: 0,
                  }}
                />
                <Typography sx={{ fontSize: '10px', color: '#334155' }}>
                  India (Light blue fill, Yellow border)
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.8 }}>
                <Box sx={{ width: 18, height: 0, borderTop: '2px solid #E2E8F0', flexShrink: 0 }} />
                <Typography sx={{ fontSize: '10px', color: '#334155' }}>State borders</Typography>
              </Box>
              <Divider sx={{ my: 0.8, borderColor: '#E2E8F0' }} />
              <Typography sx={{ fontSize: '10px', color: '#64748B', mb: 0.25 }}>Zoom Level</Typography>
              <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#0F172A', mb: 0.75 }}>
                {dashboardMapPanel.zoomLevel.toFixed(2)}
              </Typography>
              <Typography sx={{ fontSize: '10px', color: '#64748B', mb: 0.25 }}>Center</Typography>
              <Typography sx={{ fontSize: '11px', color: '#0F172A', mb: 0.75 }}>
                {dashboardMapPanel.center[1].toFixed(4)}degN, {dashboardMapPanel.center[0].toFixed(4)}degE
              </Typography>
              <Typography sx={{ fontSize: '10px', color: '#64748B', mb: 0.25 }}>Grid Overlay</Typography>
              <Typography sx={{ fontSize: '11px', color: '#0F172A', mb: 0.75 }}>
                {dashboardMapPanel.gridOverlay}
              </Typography>
              <Typography sx={{ fontSize: '10px', color: '#64748B', mb: 0.2 }}>Grid Layers</Typography>
              <Box sx={{ mb: 0.7 }}>
                {DASHBOARD_GRID_LEVELS.map((gridLevel) => {
                  const isSelected = selectedGridLevels.includes(gridLevel.id);
                  const zoomEligible = dashboardMapPanel.zoomLevel >= gridLevel.minZoom;

                  return (
                    <Box
                      key={gridLevel.id}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        mb: 0.1,
                        mr: -0.25
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                        <Checkbox
                          size="small"
                          checked={isSelected}
                          onChange={() => toggleDashboardGridLevel(gridLevel.id)}
                          sx={{ p: 0.3, mr: 0.4 }}
                        />
                        <Typography sx={{ fontSize: '10px', color: '#334155' }}>{gridLevel.label}</Typography>
                      </Box>
                      {gridLevel.minZoom >= 6 && (
                        <Typography sx={{ fontSize: '9px', color: zoomEligible ? '#059669' : '#94A3B8' }}>
                          z6+
                        </Typography>
                      )}
                    </Box>
                  );
                })}
              </Box>
              <Typography sx={{ fontSize: '10px', color: '#64748B', mb: 0.2 }}>Overlays</Typography>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  mb: 0.7,
                  mr: -0.25
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                  <Checkbox
                    size="small"
                    checked={showBranches}
                    onChange={(event) => setShowBranches(event.target.checked)}
                    sx={{ p: 0.3, mr: 0.4 }}
                  />
                  <Typography sx={{ fontSize: '10px', color: '#334155' }}>Branches (red dots)</Typography>
                </Box>
              </Box>
              <Typography sx={{ fontSize: '10px', color: '#64748B', mb: 0.25 }}>Map Status</Typography>
              <Typography
                sx={{
                  fontSize: '10px',
                  color: mapStatusColor,
                  lineHeight: 1.3,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 96,
                  overflowY: 'auto',
                }}
              >
                {mapStatusLabel}
              </Typography>
              </Collapse>
            </Box>
          )}

          {/* Admin Section */}
          {sidebarOpen && (
            <Box sx={{ mt: 2, mb: 1, px: 1.5 }}>
              <Typography
                variant="caption"
                sx={{
                  color: '#94A3B8',
                  fontWeight: 600,
                  letterSpacing: '0.5px',
                  textTransform: 'uppercase',
                  fontSize: '10px',
                }}
              >
                Administration
              </Typography>
            </Box>
          )}

          {adminItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <ListItem key={item.path} disablePadding sx={{ mb: 0.5 }}>
                <Tooltip title={!sidebarOpen ? item.label : ''} placement="right">
                  <ListItemButton
                    component={Link}
                    to={item.path}
                    sx={{
                      borderRadius: '8px',
                      py: 1.125,
                      px: 1.5,
                      transition: '0.15s',
                      color: isActive ? '#DC2626' : '#64748B',
                      background: isActive ? 'rgba(220, 38, 38, 0.08)' : 'transparent',
                      fontWeight: isActive ? 600 : 400,
                      justifyContent: sidebarOpen ? 'flex-start' : 'center',
                      '&:hover': {
                        background: isActive ? 'rgba(220, 38, 38, 0.12)' : 'rgba(0, 0, 0, 0.04)',
                      },
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        minWidth: sidebarOpen ? 36 : 'auto',
                        color: 'inherit',
                        fontSize: '20px',
                        justifyContent: 'center',
                      }}
                    >
                      {item.icon}
                    </ListItemIcon>
                    {sidebarOpen && (
                      <ListItemText
                        primary={item.label}
                        primaryTypographyProps={{
                          fontSize: '13px',
                          fontWeight: 'inherit',
                        }}
                      />
                    )}
                  </ListItemButton>
                </Tooltip>
              </ListItem>
            );
          })}
        </List>

        <Divider sx={{ borderColor: '#F1F5F9' }} />

        {/* Footer */}
        <Box sx={{ p: 1.5, borderTop: '1px solid #F1F5F9' }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
              px: sidebarOpen ? 1.5 : 0,
              py: 1,
              justifyContent: sidebarOpen ? 'flex-start' : 'center',
            }}
          >
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: '8px',
                background: '#EFF6FF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '13px',
                fontWeight: 700,
                color: '#1E40AF',
                flexShrink: 0,
              }}
            >
              U
            </Box>
            {sidebarOpen && (
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  sx={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#1E293B',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  User
                </Typography>
                <Typography
                  sx={{
                    fontSize: '10px',
                    color: '#94A3B8',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  Administrator
                </Typography>
              </Box>
            )}
          </Box>
        </Box>
      </Drawer>

      {/* Main Content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          overflowX: 'hidden',
          overflowY: isDashboardRoute ? 'hidden' : 'scroll',
          scrollbarGutter: isDashboardRoute ? 'auto' : 'stable',
          scrollbarWidth: 'thin',
          '&::-webkit-scrollbar': {
            width: '10px'
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: '#94A3B8',
            borderRadius: '8px'
          },
          '&::-webkit-scrollbar-track': {
            backgroundColor: '#E2E8F0'
          },
          minHeight: 0,
          minWidth: 0,
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
}
