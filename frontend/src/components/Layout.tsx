import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AppBar,
  Avatar,
  Button,
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
  ChevronLeft as ChevronLeftIcon,
  Close as CloseIcon,
  Logout as LogoutIcon,
  Menu as MenuIcon,
  PersonOutline as PersonOutlineIcon,
  Search as SearchIcon,
  SettingsOutlined as SettingsOutlinedIcon,
} from '@mui/icons-material';
import { navigationSections } from '../config/navigation';
import api from '../services/api';
import { useStore } from '../store/useStore';

const drawerWidth = 276;
const drawerWidthCollapsed = 84;
const SIDEBAR_STORAGE_KEY = 'sidebar:open';

const readStoredSidebarOpen = () => {
  const storedValue = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
  if (storedValue === null) {
    return true;
  }

  return storedValue === 'true';
};

const isNavItemActive = (pathname: string, path: string) => (
  pathname === path || (path !== '/' && pathname.startsWith(`${path}/`))
);

const toRoleLabel = (role: string | undefined) => {
  if (!role) {
    return 'Guest';
  }

  return role.charAt(0).toUpperCase() + role.slice(1);
};

export default function Layout() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const location = useLocation();
  const navigate = useNavigate();
  const mainContentRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const currentUser = useStore((state) => state.currentUser);
  const authSession = useStore((state) => state.authSession);
  const clearAuthSession = useStore((state) => state.clearAuthSession);
  const setError = useStore((state) => state.setError);
  const [sidebarOpen, setSidebarOpen] = useState(readStoredSidebarOpen);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [userMenuAnchor, setUserMenuAnchor] = useState<HTMLElement | null>(null);

  const isMapRoute = location.pathname === '/';
  const effectiveSidebarOpen = isMobile ? true : sidebarOpen;
  const normalizedSearchValue = searchValue.trim().toLowerCase();

  const roleFilteredSections = useMemo(
    () =>
      navigationSections
        .map((section) => ({
          ...section,
          items: section.items.filter(
            (item) => !item.roles || (currentUser ? item.roles.includes(currentUser.role) : false)
          ),
        }))
        .filter((section) => section.items.length > 0),
    [currentUser]
  );

  const totalVisibleItems = useMemo(
    () => roleFilteredSections.reduce((count, section) => count + section.items.length, 0),
    [roleFilteredSections]
  );

  const shouldShowSearch = effectiveSidebarOpen && totalVisibleItems > 8;

  const visibleSections = useMemo(() => {
    if (!normalizedSearchValue) {
      return roleFilteredSections;
    }

    return roleFilteredSections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => item.label.toLowerCase().includes(normalizedSearchValue)),
      }))
      .filter((section) => section.items.length > 0);
  }, [normalizedSearchValue, roleFilteredSections]);

  const currentPage = useMemo(
    () =>
      roleFilteredSections
        .flatMap((section) => section.items)
        .find((item) => isNavItemActive(location.pathname, item.path)),
    [location.pathname, roleFilteredSections]
  );

  const userInitial = useMemo(() => {
    const email = currentUser?.email || '';
    const initial = email.trim().charAt(0);
    return initial ? initial.toUpperCase() : 'U';
  }, [currentUser?.email]);

  useEffect(() => {
    if (isMobile) {
      return;
    }

    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarOpen));
  }, [isMobile, sidebarOpen]);

  useEffect(() => {
    if (!shouldShowSearch && searchValue) {
      setSearchValue('');
    }
  }, [searchValue, shouldShowSearch]);

  useEffect(() => {
    if (mainContentRef.current) {
      mainContentRef.current.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
    }

    if (isMobile) {
      setMobileOpen(false);
    }
  }, [isMobile, location.pathname]);

  useEffect(() => {
    const focusSearchInput = () => {
      window.setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }, 0);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'b') {
        event.preventDefault();
        if (isMobile) {
          setMobileOpen((previous) => !previous);
          return;
        }

        setSidebarOpen((previous) => !previous);
      }

      if (key === 'k' && totalVisibleItems > 8) {
        event.preventDefault();
        if (isMobile) {
          setMobileOpen(true);
          focusSearchInput();
          return;
        }

        if (!sidebarOpen) {
          setSidebarOpen(true);
        }
        focusSearchInput();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMobile, sidebarOpen, totalVisibleItems]);

  const handleNavigate = (path: string) => {
    if (location.pathname !== path) {
      navigate(path);
    }

    if (isMobile) {
      setMobileOpen(false);
    }
  };

  const handleDesktopSidebarToggle = () => {
    setSidebarOpen((previous) => !previous);
  };

  const handleUserMenuOpen = (event: MouseEvent<HTMLElement>) => {
    setUserMenuAnchor(event.currentTarget);
  };

  const handleUserMenuClose = () => {
    setUserMenuAnchor(null);
  };

  const handleProfileOpen = () => {
    handleUserMenuClose();
    setProfileOpen(true);
  };

  const handleSettingsNavigate = () => {
    handleUserMenuClose();
    navigate('/config');
  };

  const handleLogout = async () => {
    handleUserMenuClose();

    try {
      await api.logout(authSession?.refreshToken);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to log out cleanly.');
    } finally {
      clearAuthSession();
      navigate('/login', { replace: true });
    }
  };

  const renderSection = (title: string, items: typeof visibleSections[number]['items']) => (
    <Box key={title} sx={{ mb: 1.5 }}>
      {effectiveSidebarOpen ? (
        <Typography
          component="h2"
          sx={{
            px: 2,
            mb: 0.75,
            fontSize: '0.7rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: 'text.disabled',
            textTransform: 'uppercase',
          }}
        >
          {title}
        </Typography>
      ) : null}

      <List disablePadding>
        {items.map((item) => {
          const selected = isNavItemActive(location.pathname, item.path);
          const isAdminItem = Boolean(item.roles?.includes('admin'));
          const selectedColor = isAdminItem
            ? theme.palette.sidebar.activeAdminColor
            : theme.palette.sidebar.activeColor;
          const selectedBackground = isAdminItem
            ? theme.palette.sidebar.activeAdminBg
            : theme.palette.sidebar.activeBg;
          const selectedBorderColor = isAdminItem ? theme.palette.error.main : theme.palette.primary.main;
          const tooltipTitle = !effectiveSidebarOpen ? item.label : '';

          return (
            <ListItem key={item.path} disablePadding sx={{ mb: 0.5 }}>
              <Tooltip title={tooltipTitle} placement="right">
                <ListItemButton
                  selected={selected}
                  aria-current={selected ? 'page' : undefined}
                  onClick={() => handleNavigate(item.path)}
                  sx={{
                    borderRadius: 2,
                    px: effectiveSidebarOpen ? 1.5 : 1,
                    py: 1.125,
                    minHeight: 46,
                    borderLeft: '3px solid transparent',
                    borderLeftColor: selected ? selectedBorderColor : 'transparent',
                    color: selected ? selectedColor : 'text.secondary',
                    backgroundColor: selected ? selectedBackground : 'transparent',
                    fontWeight: selected ? 600 : 500,
                    justifyContent: effectiveSidebarOpen ? 'flex-start' : 'center',
                    '&.Mui-selected': {
                      backgroundColor: selectedBackground,
                    },
                    '&.Mui-selected:hover': {
                      backgroundColor: selectedBackground,
                    },
                    '&:hover': {
                      backgroundColor: selected ? selectedBackground : theme.palette.sidebar.hoverBg,
                    },
                  }}
                >
                  <ListItemIcon
                    sx={{
                      minWidth: effectiveSidebarOpen ? 36 : 'auto',
                      color: 'inherit',
                      justifyContent: 'center',
                    }}
                  >
                    {item.icon}
                  </ListItemIcon>
                  {effectiveSidebarOpen ? (
                    <ListItemText
                      primary={item.label}
                      primaryTypographyProps={{
                        fontSize: '0.8125rem',
                        fontWeight: 'inherit',
                      }}
                    />
                  ) : null}
                </ListItemButton>
              </Tooltip>
            </ListItem>
          );
        })}
      </List>
    </Box>
  );

  const drawerContent = (
    <Box
      component="nav"
      aria-label="Primary navigation"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <Box
        sx={{
          px: 2,
          py: 1.75,
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          minHeight: 72,
          borderBottom: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: 2.5,
            background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.error.main})`,
            color: 'common.white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1rem',
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          LP
        </Box>
        {effectiveSidebarOpen ? (
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              sx={{
                fontSize: '0.9375rem',
                fontWeight: 700,
                color: 'text.primary',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              Location Pockets
            </Typography>
            <Typography
              sx={{
                fontSize: '0.625rem',
                color: 'text.disabled',
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              Territory Management
            </Typography>
          </Box>
        ) : null}
        <IconButton
          aria-label={
            isMobile
              ? 'Close navigation menu'
              : (sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar')
          }
          onClick={isMobile ? () => setMobileOpen(false) : handleDesktopSidebarToggle}
          size="small"
          sx={{ color: 'text.secondary', flexShrink: 0 }}
        >
          {isMobile ? <CloseIcon /> : (sidebarOpen ? <ChevronLeftIcon /> : <MenuIcon />)}
        </IconButton>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', px: 1.25, py: 1.5 }}>
        {shouldShowSearch ? (
          <TextField
            inputRef={searchInputRef}
            fullWidth
            size="small"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="Search navigation"
            aria-label="Search navigation"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                </InputAdornment>
              ),
            }}
            sx={{
              mb: 2,
              '& .MuiOutlinedInput-root': {
                backgroundColor: alpha(theme.palette.background.paper, 0.8),
              },
            }}
          />
        ) : null}

        {visibleSections.length > 0 ? (
          visibleSections.map((section) => renderSection(section.title, section.items))
        ) : (
          <Typography sx={{ px: 2, py: 1, color: 'text.secondary', fontSize: '0.8125rem' }}>
            No navigation items match “{searchValue}”.
          </Typography>
        )}
      </Box>

      <Divider />

      <Box sx={{ p: 1.5 }}>
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <IconButton
            aria-label="Open user menu"
            onClick={handleUserMenuOpen}
            sx={{
              p: 0,
              borderRadius: 2,
            }}
          >
            <Avatar
              sx={{
                width: 36,
                height: 36,
                bgcolor: alpha(theme.palette.primary.main, 0.12),
                color: 'primary.main',
                fontSize: '0.875rem',
                fontWeight: 700,
              }}
            >
              {userInitial}
            </Avatar>
          </IconButton>
          {effectiveSidebarOpen ? (
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography
                sx={{
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: 'text.primary',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {currentUser?.email || 'User'}
              </Typography>
              <Typography
                sx={{
                  fontSize: '0.75rem',
                  color: 'text.secondary',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {toRoleLabel(currentUser?.role)}
              </Typography>
            </Box>
          ) : null}
        </Stack>
      </Box>
    </Box>
  );

  return (
    <Box
      sx={{
        display: 'flex',
        minHeight: '100vh',
        backgroundColor: 'background.default',
        overflow: 'hidden',
      }}
    >
      {isMobile ? (
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', md: 'none' },
            '& .MuiDrawer-paper': {
              width: drawerWidth,
              boxSizing: 'border-box',
              borderRight: `1px solid ${theme.palette.divider}`,
              backgroundColor: 'background.paper',
            },
          }}
        >
          {drawerContent}
        </Drawer>
      ) : (
        <Drawer
          variant="permanent"
          open
          sx={{
            width: sidebarOpen ? drawerWidth : drawerWidthCollapsed,
            flexShrink: 0,
            transition: theme.transitions.create('width', {
              duration: theme.transitions.duration.shorter,
            }),
            '& .MuiDrawer-paper': {
              width: sidebarOpen ? drawerWidth : drawerWidthCollapsed,
              boxSizing: 'border-box',
              borderRight: `1px solid ${theme.palette.divider}`,
              backgroundColor: 'background.paper',
              overflowX: 'hidden',
              transition: theme.transitions.create('width', {
                duration: theme.transitions.duration.shorter,
              }),
            },
          }}
        >
          {drawerContent}
        </Drawer>
      )}

      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          minWidth: 0,
          minHeight: '100vh',
        }}
      >
        {isMobile ? (
          <AppBar
            position="static"
            color="inherit"
            sx={{
              display: { xs: 'block', md: 'none' },
              backgroundColor: 'background.paper',
            }}
          >
            <Toolbar sx={{ minHeight: 72, gap: 1.5 }}>
              <IconButton
                aria-label="Open navigation menu"
                edge="start"
                onClick={() => setMobileOpen(true)}
                sx={{ color: 'text.secondary' }}
              >
                <MenuIcon />
              </IconButton>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  sx={{
                    fontSize: '0.9375rem',
                    fontWeight: 700,
                    color: 'text.primary',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {currentPage?.label || 'Location Pockets'}
                </Typography>
                <Typography
                  sx={{
                    fontSize: '0.75rem',
                    color: 'text.secondary',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {toRoleLabel(currentUser?.role)}
                </Typography>
              </Box>
              <IconButton aria-label="Open user menu" onClick={handleUserMenuOpen} sx={{ p: 0 }}>
                <Avatar
                  sx={{
                    width: 34,
                    height: 34,
                    bgcolor: alpha(theme.palette.primary.main, 0.12),
                    color: 'primary.main',
                    fontSize: '0.875rem',
                    fontWeight: 700,
                  }}
                >
                  {userInitial}
                </Avatar>
              </IconButton>
            </Toolbar>
          </AppBar>
        ) : null}

        <Box
          component="main"
          ref={mainContentRef}
          sx={{
            flexGrow: 1,
            display: 'flex',
            flexDirection: 'column',
            overflowX: 'hidden',
            overflowY: isMapRoute ? 'hidden' : 'auto',
            scrollbarGutter: isMapRoute ? 'auto' : 'stable',
            scrollbarWidth: 'thin',
            '&::-webkit-scrollbar': {
              width: '10px',
            },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: theme.palette.text.disabled,
              borderRadius: '8px',
            },
            '&::-webkit-scrollbar-track': {
              backgroundColor: theme.palette.divider,
            },
            minHeight: 0,
            minWidth: 0,
          }}
        >
          <Outlet />
        </Box>
      </Box>

      <Menu
        anchorEl={userMenuAnchor}
        open={Boolean(userMenuAnchor)}
        onClose={handleUserMenuClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <MenuItem onClick={handleProfileOpen}>
          <ListItemIcon>
            <PersonOutlineIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Profile</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleSettingsNavigate} disabled={currentUser?.role !== 'admin'}>
          <ListItemIcon>
            <SettingsOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Settings</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleLogout}>
          <ListItemIcon>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Logout</ListItemText>
        </MenuItem>
      </Menu>

      <Dialog open={profileOpen} onClose={() => setProfileOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Profile</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Email
              </Typography>
              <Typography variant="body1" color="text.primary">
                {currentUser?.email || 'Unavailable'}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Role
              </Typography>
              <Typography variant="body1" color="text.primary">
                {toRoleLabel(currentUser?.role)}
              </Typography>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setProfileOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
