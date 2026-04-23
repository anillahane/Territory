import { beforeEach, describe, expect, it } from 'vitest';
import { DASHBOARD_GRID_LEVELS, useStore } from '../useStore';

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
    dashboardSelectedGridLevels: DASHBOARD_GRID_LEVELS.map((level) => level.id),
  });
};

describe('useStore', () => {
  beforeEach(() => {
    resetStore();
  });

  it('manages branches, customer dots, and notifications through store actions', () => {
    const store = useStore.getState();

    store.addBranch({
      id: 'branch-1',
      city: 'Mumbai',
      lat: 19.076,
      lon: 72.8777,
      pocketId: 'P1',
    });
    store.updateBranch('branch-1', { city: 'Pune', pocketId: 'P2' });
    store.addCustomerDot({ id: 'dot-1', lat: 18.52, lon: 73.85, label: 'Customer 1' });
    store.setNearestBranches(useStore.getState().branches);
    store.setQueryLocation({ lat: 18.52, lon: 73.85 });
    store.setHighlightedPocketId('P2');
    store.setLoading(true);

    expect(useStore.getState().branches).toEqual([{
      id: 'branch-1',
      city: 'Pune',
      lat: 19.076,
      lon: 72.8777,
      pocketId: 'P2',
    }]);
    expect(useStore.getState().customerDots).toEqual([{
      id: 'dot-1',
      lat: 18.52,
      lon: 73.85,
      label: 'Customer 1',
    }]);
    expect(useStore.getState().nearestBranches).toHaveLength(1);
    expect(useStore.getState().queryLocation).toEqual({ lat: 18.52, lon: 73.85 });
    expect(useStore.getState().highlightedPocketId).toBe('P2');
    expect(useStore.getState().loading).toBe(true);

    store.setError('Upload failed');
    expect(useStore.getState().error).toBe('Upload failed');
    expect(useStore.getState().success).toBeNull();

    store.setSuccess('Upload complete');
    expect(useStore.getState().success).toBe('Upload complete');
    expect(useStore.getState().error).toBeNull();

    store.clearNotifications();
    store.removeCustomerDot('dot-1');
    store.removeBranch('branch-1');

    expect(useStore.getState().error).toBeNull();
    expect(useStore.getState().success).toBeNull();
    expect(useStore.getState().customerDots).toEqual([]);
    expect(useStore.getState().branches).toEqual([]);
  });

  it('updates dashboard panel state and toggles visible grid levels', () => {
    const store = useStore.getState();

    store.setDashboardMapPanel({
      zoomLevel: 8.2,
      center: [77.1025, 28.7041],
      gridOverlay: '20 km',
      mapLoaded: true,
    });
    store.toggleDashboardGridLevel('500km');
    store.toggleDashboardGridLevel('1km');

    expect(useStore.getState().dashboardMapPanel).toEqual({
      zoomLevel: 8.2,
      center: [77.1025, 28.7041],
      gridOverlay: '20 km',
      mapLoaded: true,
      mapError: null,
    });
    expect(useStore.getState().dashboardSelectedGridLevels).not.toContain('500km');
    expect(useStore.getState().dashboardSelectedGridLevels).not.toContain('1km');

    store.resetDashboardMapPanel();
    store.toggleDashboardGridLevel('500km');

    expect(useStore.getState().dashboardMapPanel).toEqual(defaultDashboardMapPanel);
    expect(useStore.getState().dashboardSelectedGridLevels).toContain('500km');
  });
});
