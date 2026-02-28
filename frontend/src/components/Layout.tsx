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
  Tooltip,
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
  AdminPanelSettings as AdminIcon,
} from '@mui/icons-material';

const drawerWidth = 240;
const drawerWidthCollapsed = 64;

export default function Layout() {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const navItems = [
    { path: '/', label: 'Dashboard', icon: <DashboardIcon /> },
    { path: '/branches', label: 'Branches', icon: <BusinessIcon /> },
    { path: '/batch', label: 'Batch Processing', icon: <CloudUploadIcon /> },
    { path: '/mappings', label: 'Customer Mappings', icon: <TableChartIcon /> },
  ];

  const adminItems = [
    { path: '/calculator', label: 'Pocket ID Calculator', icon: <CalculateIcon /> },
    { path: '/config', label: 'System Configuration', icon: <SettingsIcon /> },
  ];

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', background: '#F8FAFC' }}>
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
          overflow: 'hidden',
          minWidth: 0,
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
}
