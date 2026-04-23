import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store/useStore';
import Dashboard from '../Dashboard';

const mockGetBranches = vi.hoisted(() => vi.fn());
const mockGetTerritoryVisualization = vi.hoisted(() => vi.fn());
const mockLoadBranchMarkers = vi.hoisted(() => vi.fn());
const mockSetBranchLayerVisibility = vi.hoisted(() => vi.fn());
const mockSetCustomerLayerVisibility = vi.hoisted(() => vi.fn());
const mockApplyTerritoryVisualization = vi.hoisted(() => vi.fn());
const mockClearTerritoryVisualization = vi.hoisted(() => vi.fn());
const mockEnsureTerritoryLayers = vi.hoisted(() => vi.fn());
const mockMapRef = vi.hoisted(() => ({
  current: {
    isStyleLoaded: vi.fn(() => true),
  },
}));

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual<typeof import('../../services/api')>('../../services/api');

  return {
    ...actual,
    default: {
      getBranches: mockGetBranches,
      getTerritoryVisualization: mockGetTerritoryVisualization,
    },
  };
});

vi.mock('../../features/dashboard/components/MapContainer', () => ({
  MapContainer: () => <div data-testid="map-container">map-container</div>,
}));

vi.mock('../../features/dashboard/components/MapControls', () => ({
  MapControls: (props: {
    mapLoaded: boolean;
    territoryBranchOptions: Array<{ id: string }>;
    selectedTerritoryBranchIds: string[];
    territorySummary: { territories: number; customersVisible: number } | null;
    territoryError: string | null;
    territoryLoading: boolean;
    onShowOtherBranchesChange: (value: boolean) => void;
    onShowTerritoryCustomersChange: (value: boolean) => void;
    onTerritoryBranchChange: (nextBranchIds: string[]) => void;
  }) => (
    <div>
      <div data-testid="map-loaded">{String(props.mapLoaded)}</div>
      <div data-testid="territory-loading">{String(props.territoryLoading)}</div>
      <div data-testid="branch-options">{props.territoryBranchOptions.map((branch) => branch.id).join(',') || 'none'}</div>
      <div data-testid="selected-branches">{props.selectedTerritoryBranchIds.join(',') || 'none'}</div>
      <div data-testid="territory-summary">
        {props.territorySummary
          ? `${props.territorySummary.territories}:${props.territorySummary.customersVisible}`
          : 'none'}
      </div>
      <div data-testid="territory-error">{props.territoryError || 'none'}</div>
      <button type="button" onClick={() => props.onShowOtherBranchesChange(true)}>
        Show Other Branches
      </button>
      <button type="button" onClick={() => props.onShowTerritoryCustomersChange(false)}>
        Hide Territory Customers
      </button>
      <button type="button" onClick={() => props.onTerritoryBranchChange(['branch-1', 'branch-2'])}>
        Select Too Many Branches
      </button>
    </div>
  ),
}));

vi.mock('../../features/dashboard/hooks/useMapInstance', () => ({
  useMapInstance: () => ({
    mapContainerRef: { current: null },
    mapRef: mockMapRef,
    mapLoaded: true,
    mapError: null,
    currentZoom: 8.2,
    currentCenter: [77.1025, 28.7041] as [number, number],
    currentGridLabel: '20 km',
  }),
}));

vi.mock('../../features/dashboard/layers/BranchLayer', () => ({
  loadBranchMarkers: mockLoadBranchMarkers,
  setBranchLayerVisibility: mockSetBranchLayerVisibility,
}));

vi.mock('../../features/dashboard/layers/CustomerLayer', () => ({
  setCustomerLayerVisibility: mockSetCustomerLayerVisibility,
}));

vi.mock('../../features/dashboard/layers/TerritoryLayer', () => ({
  applyTerritoryVisualization: mockApplyTerritoryVisualization,
  clearTerritoryVisualization: mockClearTerritoryVisualization,
  ensureTerritoryLayers: mockEnsureTerritoryLayers,
}));

const defaultDashboardMapPanel = {
  zoomLevel: 4.5,
  center: [78.9629, 20.5937] as [number, number],
  gridOverlay: '500 km, 100 km, 20 km',
  mapLoaded: false,
  mapError: null,
};

const resetStore = () => {
  useStore.setState({
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

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('Dashboard', () => {
  beforeEach(() => {
    resetStore();
    mockGetBranches.mockReset();
    mockGetTerritoryVisualization.mockReset();
    mockLoadBranchMarkers.mockReset();
    mockSetBranchLayerVisibility.mockReset();
    mockSetCustomerLayerVisibility.mockReset();
    mockApplyTerritoryVisualization.mockReset();
    mockClearTerritoryVisualization.mockReset();
    mockEnsureTerritoryLayers.mockReset();

    mockGetBranches.mockResolvedValue({
      branches: [{ id: 'branch-1', city: 'Mumbai' }],
    });
    mockGetTerritoryVisualization.mockResolvedValue({
      mode: 'existing_customers',
      modeLabel: 'Existing Customer Mapped',
      customerView: 'selected_pockets',
      selectedBranchIds: ['branch-1'],
      maxSelectableBranches: 1,
      availableBranches: [{ id: 'branch-1', city: 'Mumbai', customerCount: 12 }],
      summary: {
        territories: 1,
        branches: 1,
        points: 12,
        customers: 12,
        customersVisible: 10,
        sourceType: 'existing_customers',
      },
      territories: { type: 'FeatureCollection', features: [] },
      branches: { type: 'FeatureCollection', features: [] },
      points: { type: 'FeatureCollection', features: [] },
      customers: { type: 'FeatureCollection', features: [] },
    });
  });

  it('composes territory data into the map controls and updates dashboard store state', async () => {
    const { unmount } = render(<Dashboard />, { wrapper: createWrapper() });

    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.getByTestId('map-loaded')).toHaveTextContent('true');

    await waitFor(() => {
      expect(mockApplyTerritoryVisualization).toHaveBeenCalledWith(
        mockMapRef.current,
        expect.objectContaining({
          selectedBranchIds: ['branch-1'],
        }),
        true
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('branch-options')).toHaveTextContent('branch-1');
    });
    await waitFor(() => {
      expect(screen.getByTestId('selected-branches')).toHaveTextContent('branch-1');
    });
    expect(screen.getByTestId('territory-summary')).toHaveTextContent('1:10');

    expect(useStore.getState().dashboardMapPanel).toEqual({
      zoomLevel: 8.2,
      center: [77.1025, 28.7041],
      gridOverlay: '20 km',
      mapLoaded: true,
      mapError: null,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Hide Territory Customers' }));
    await waitFor(() => {
      expect(mockSetCustomerLayerVisibility).toHaveBeenLastCalledWith(mockMapRef.current, false);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Show Other Branches' }));
    await waitFor(() => {
      expect(mockGetBranches).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockSetBranchLayerVisibility).toHaveBeenLastCalledWith(mockMapRef.current, true);
    });
    await waitFor(() => {
      expect(mockLoadBranchMarkers).toHaveBeenCalledWith(
        mockMapRef.current,
        true,
        true,
        { branches: [{ id: 'branch-1', city: 'Mumbai' }] }
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Select Too Many Branches' }));
    await waitFor(() => {
      expect(screen.getByTestId('territory-error')).toHaveTextContent('Select up to 1 branches only.');
    });

    unmount();
    expect(useStore.getState().dashboardMapPanel).toEqual(defaultDashboardMapPanel);
  });
});
