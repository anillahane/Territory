import { alpha, createTheme } from '@mui/material/styles';

type SidebarPalette = {
  activeBg: string;
  activeColor: string;
  activeAdminBg: string;
  activeAdminColor: string;
  hoverBg: string;
  iconColor: string;
};

declare module '@mui/material/styles' {
  interface Palette {
    sidebar: SidebarPalette;
  }

  interface PaletteOptions {
    sidebar?: SidebarPalette;
  }
}

const basePalette = {
  primary: {
    main: '#1E40AF',
    light: '#3B82F6',
    dark: '#1E3A8A',
  },
  secondary: {
    main: '#059669',
    light: '#10B981',
    dark: '#047857',
  },
  success: {
    main: '#059669',
  },
  error: {
    main: '#DC2626',
  },
  warning: {
    main: '#D97706',
    light: '#FACC15',
  },
  info: {
    main: '#0284C7',
    light: '#93C5FD',
  },
  background: {
    default: '#F8FAFC',
    paper: '#FFFFFF',
  },
  text: {
    primary: '#0F172A',
    secondary: '#64748B',
    disabled: '#94A3B8',
  },
  divider: '#E2E8F0',
};

const theme = createTheme({
  palette: {
    mode: 'light',
    ...basePalette,
    sidebar: {
      activeBg: alpha(basePalette.primary.main, 0.08),
      activeColor: basePalette.primary.main,
      activeAdminBg: alpha(basePalette.error.main, 0.08),
      activeAdminColor: basePalette.error.main,
      hoverBg: alpha(basePalette.primary.main, 0.04),
      iconColor: basePalette.text.secondary,
    },
  },
  typography: {
    fontFamily: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", sans-serif',
    h1: {
      fontSize: '2rem',
      fontWeight: 700,
      letterSpacing: '-0.3px',
    },
    h2: {
      fontSize: '1.5rem',
      fontWeight: 700,
    },
    h3: {
      fontSize: '1.25rem',
      fontWeight: 700,
    },
    h4: {
      fontSize: '1.125rem',
      fontWeight: 600,
    },
    h5: {
      fontSize: '1rem',
      fontWeight: 600,
    },
    h6: {
      fontSize: '0.875rem',
      fontWeight: 600,
    },
    body1: {
      fontSize: '0.875rem',
    },
    body2: {
      fontSize: '0.8125rem',
    },
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: '8px',
          fontWeight: 500,
          fontSize: '0.875rem',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          border: `1px solid ${alpha(basePalette.divider, 0.7)}`,
          borderRadius: '12px',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          border: `1px solid ${alpha(basePalette.divider, 0.7)}`,
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          borderBottom: `1px solid ${basePalette.divider}`,
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontSize: '0.8125rem',
          fontWeight: 400,
          '&.Mui-selected': {
            fontWeight: 600,
          },
        },
      },
    },
  },
});

export default theme;
