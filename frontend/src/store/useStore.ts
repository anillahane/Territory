import { create } from 'zustand';

export interface Config {
  id: number;
  originLat: number;
  originLon: number;
  alphabet: string;
  gridLevels: number[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Branch {
  id: string;
  city: string;
  lat: number;
  lon: number;
  pocketId: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CustomerDot {
  id: string;
  lat: number;
  lon: number;
  label?: string;
}

export interface DashboardMapPanel {
  zoomLevel: number;
  center: [number, number];
  gridOverlay: string;
  mapLoaded: boolean;
  mapError: string | null;
}

export type DashboardGridLevelId = '500km' | '100km' | '20km' | '5km' | '1km';

export const DASHBOARD_GRID_LEVELS: Array<{ id: DashboardGridLevelId; label: string; minZoom: number }> = [
  { id: '500km', label: '500 km', minZoom: 0 },
  { id: '100km', label: '100 km', minZoom: 0 },
  { id: '20km', label: '20 km', minZoom: 0 },
  { id: '5km', label: '5 km', minZoom: 6 },
  { id: '1km', label: '1 km', minZoom: 6 }
];

const defaultDashboardMapPanel: DashboardMapPanel = {
  zoomLevel: 4.5,
  center: [78.9629, 20.5937],
  gridOverlay: '500 km, 100 km, 20 km',
  mapLoaded: false,
  mapError: null
};

interface AppState {
  // Configuration
  config: Config | null;
  setConfig: (config: Config) => void;

  // Branches
  branches: Branch[];
  setBranches: (branches: Branch[]) => void;
  addBranch: (branch: Branch) => void;
  updateBranch: (id: string, branch: Partial<Branch>) => void;
  removeBranch: (id: string) => void;

  // Customer dots
  customerDots: CustomerDot[];
  setCustomerDots: (dots: CustomerDot[]) => void;
  addCustomerDot: (dot: CustomerDot) => void;
  removeCustomerDot: (id: string) => void;
  clearCustomerDots: () => void;

  // Map state
  selectedGridLevel: number;
  setSelectedGridLevel: (level: number) => void;
  showGrid: boolean;
  setShowGrid: (show: boolean) => void;
  showBranches: boolean;
  setShowBranches: (show: boolean) => void;
  showCustomers: boolean;
  setShowCustomers: (show: boolean) => void;

  // Nearest branches
  nearestBranches: Branch[];
  setNearestBranches: (branches: Branch[]) => void;
  queryLocation: { lat: number; lon: number } | null;
  setQueryLocation: (location: { lat: number; lon: number } | null) => void;

  // Loading states
  loading: boolean;
  setLoading: (loading: boolean) => void;

  // Highlighted Pocket ID
  highlightedPocketId: string | null;
  setHighlightedPocketId: (pocketId: string | null) => void;

  // Notifications
  error: string | null;
  success: string | null;
  setError: (message: string | null) => void;
  setSuccess: (message: string | null) => void;
  clearNotifications: () => void;

  // Dashboard map panel
  dashboardMapPanel: DashboardMapPanel;
  setDashboardMapPanel: (panel: Partial<DashboardMapPanel>) => void;
  resetDashboardMapPanel: () => void;
  dashboardSelectedGridLevels: DashboardGridLevelId[];
  toggleDashboardGridLevel: (id: DashboardGridLevelId) => void;
}

export const useStore = create<AppState>((set) => ({
  // Configuration
  config: null,
  setConfig: (config) => set({ config }),

  // Branches
  branches: [],
  setBranches: (branches) => set({ branches }),
  addBranch: (branch) => set((state) => ({ branches: [...state.branches, branch] })),
  updateBranch: (id, branch) =>
    set((state) => ({
      branches: state.branches.map((b) => (b.id === id ? { ...b, ...branch } : b)),
    })),
  removeBranch: (id) =>
    set((state) => ({
      branches: state.branches.filter((b) => b.id !== id),
    })),

  // Customer dots
  customerDots: [],
  setCustomerDots: (dots) => set({ customerDots: dots }),
  addCustomerDot: (dot) => set((state) => ({ customerDots: [...state.customerDots, dot] })),
  removeCustomerDot: (id) =>
    set((state) => ({
      customerDots: state.customerDots.filter((d) => d.id !== id),
    })),
  clearCustomerDots: () => set({ customerDots: [] }),

  // Map state
  selectedGridLevel: 0, // 500km
  setSelectedGridLevel: (level) => set({ selectedGridLevel: level }),
  showGrid: true,
  setShowGrid: (show) => set({ showGrid: show }),
  showBranches: true,
  setShowBranches: (show) => set({ showBranches: show }),
  showCustomers: true,
  setShowCustomers: (show) => set({ showCustomers: show }),

  // Nearest branches
  nearestBranches: [],
  setNearestBranches: (branches) => set({ nearestBranches: branches }),
  queryLocation: null,
  setQueryLocation: (location) => set({ queryLocation: location }),

  // Loading states
  loading: false,
  setLoading: (loading) => set({ loading }),

  // Highlighted Pocket ID
  highlightedPocketId: null,
  setHighlightedPocketId: (pocketId) => set({ highlightedPocketId: pocketId }),

  // Notifications
  error: null,
  success: null,
  setError: (message) => set({ error: message, success: null }),
  setSuccess: (message) => set({ success: message, error: null }),
  clearNotifications: () => set({ error: null, success: null }),

  // Dashboard map panel
  dashboardMapPanel: defaultDashboardMapPanel,
  setDashboardMapPanel: (panel) =>
    set((state) => ({
      dashboardMapPanel: {
        ...state.dashboardMapPanel,
        ...panel,
      },
    })),
  resetDashboardMapPanel: () => set({ dashboardMapPanel: defaultDashboardMapPanel }),
  dashboardSelectedGridLevels: DASHBOARD_GRID_LEVELS.map((level) => level.id),
  toggleDashboardGridLevel: (id) =>
    set((state) => ({
      dashboardSelectedGridLevels: state.dashboardSelectedGridLevels.includes(id)
        ? state.dashboardSelectedGridLevels.filter((existingId) => existingId !== id)
        : [...state.dashboardSelectedGridLevels, id]
    })),
}));
