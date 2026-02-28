import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1E40AF', // rgb(30, 64, 175) - Vistaar blue
      light: '#3B82F6',
      dark: '#1E3A8A',
    },
    secondary: {
      main: '#059669', // rgb(5, 150, 105) - Vistaar green
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
    },
    info: {
      main: '#0284C7',
    },
    background: {
      default: '#F8FAFC', // rgb(248, 250, 252)
      paper: '#FFFFFF',
    },
    text: {
      primary: '#0F172A', // rgb(15, 23, 42)
      secondary: '#64748B', // rgb(100, 116, 139)
      disabled: '#94A3B8', // rgb(148, 163, 184)
    },
    divider: '#E2E8F0', // rgb(226, 232, 240)
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
          border: '1px solid #F1F5F9',
          borderRadius: '12px',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          border: '1px solid #F1F5F9',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          borderBottom: '1px solid #E2E8F0',
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
