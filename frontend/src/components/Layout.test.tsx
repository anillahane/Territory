import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import Layout from './Layout';
import theme from '../theme';
import { useStore } from '../store/useStore';
import type { AuthSession } from '../services/api';

const mockLogout = vi.hoisted(() => vi.fn());

vi.mock('../services/api', async () => {
  const actual = await vi.importActual<typeof import('../services/api')>('../services/api');

  return {
    ...actual,
    default: {
      ...actual.default,
      logout: mockLogout,
    },
  };
});

const defaultDashboardMapPanel = {
  zoomLevel: 4.5,
  center: [78.9629, 20.5937] as [number, number],
  gridOverlay: '500 km, 100 km, 20 km',
  mapLoaded: false,
  mapError: null,
};

const adminSession: AuthSession = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  user: {
    id: '1',
    email: 'admin@example.com',
    role: 'admin',
  },
};

const viewerSession: AuthSession = {
  accessToken: 'viewer-access-token',
  refreshToken: 'viewer-refresh-token',
  user: {
    id: '2',
    email: 'viewer@example.com',
    role: 'viewer',
  },
};

const resetStore = (session: AuthSession | null) => {
  useStore.setState({
    authSession: session,
    currentUser: session?.user ?? null,
    config: null,
    branches: [],
    customerDots: [],
    selectedGridLevel: 0,
    showGrid: true,
    showBranches: true,
    showCustomers: true,
    nearestBranches: [],
    queryLocation: null,
    loading: false,
    highlightedPocketId: null,
    error: null,
    success: null,
    dashboardMapPanel: defaultDashboardMapPanel,
    dashboardSelectedGridLevels: ['500km', '100km', '20km', '5km', '1km'],
  });
};

const renderLayout = (initialPath = '/') =>
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route path="/" element={<Layout />}>
            <Route index element={<div>Dashboard Content</div>} />
            <Route path="branches" element={<div>Branches Content</div>} />
            <Route path="batch" element={<div>Batch Content</div>} />
            <Route path="mappings" element={<div>Mappings Content</div>} />
            <Route path="calculator" element={<div>Calculator Content</div>} />
            <Route path="config" element={<div>Config Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  );

describe('Layout', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockLogout.mockReset();
    mockLogout.mockResolvedValue(undefined);
    resetStore(adminSession);
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('filters admin items for non-admin users', () => {
    resetStore(viewerSession);

    renderLayout('/branches');

    expect(screen.queryByRole('button', { name: /pocket id calculator/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /system configuration/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /branches/i })).toBeInTheDocument();
  });

  it('toggles the sidebar with the keyboard shortcut', async () => {
    renderLayout('/');

    expect(screen.getByText('Location Pockets')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });

    await waitFor(() => {
      expect(screen.queryByText('Location Pockets')).not.toBeInTheDocument();
    });
  });

  it('logs out through the user menu', async () => {
    renderLayout('/');

    fireEvent.click(screen.getAllByRole('button', { name: /open user menu/i })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: /logout/i }));

    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalledWith('refresh-token');
    });
    await waitFor(() => {
      expect(screen.getByText('Login Page')).toBeInTheDocument();
    });
  });

  it('has no accessibility violations in the desktop shell', async () => {
    const { container } = renderLayout('/branches');
    const results = await axe(container);

    expect(results.violations).toHaveLength(0);
  });
});
