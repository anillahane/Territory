import { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { useStore } from '../store/useStore';
import api from '../services/api';
import { MapContainer } from '../features/dashboard/components/MapContainer';
import { MapControls } from '../features/dashboard/components/MapControls';
import {
  MAX_TERRITORY_BRANCHES,
} from '../features/dashboard/constants';
import { loadBranchMarkers, setBranchLayerVisibility } from '../features/dashboard/layers/BranchLayer';
import { setCustomerLayerVisibility } from '../features/dashboard/layers/CustomerLayer';
import {
  applyTerritoryVisualization,
  clearTerritoryVisualization,
  ensureTerritoryLayers,
} from '../features/dashboard/layers/TerritoryLayer';
import { useMapInstance } from '../features/dashboard/hooks/useMapInstance';
import type {
  TerritoryBranchOption,
  TerritoryCustomerView,
  TerritoryMode,
  TerritorySummary,
  TerritoryVisualizationResponse,
} from '../features/dashboard/types';

const hasSameIds = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((value, index) => value === b[index]);
};

export default function Dashboard() {
  const setDashboardMapPanel = useStore((state) => state.setDashboardMapPanel);
  const resetDashboardMapPanel = useStore((state) => state.resetDashboardMapPanel);
  const selectedGridLevels = useStore((state) => state.dashboardSelectedGridLevels);
  const showBranches = useStore((state) => state.showBranches);
  const [territoryMode, setTerritoryMode] = useState<TerritoryMode>('existing_customers');
  const [territoryCustomerView, setTerritoryCustomerView] = useState<TerritoryCustomerView>('selected_pockets');
  const [territoryBranchOptions, setTerritoryBranchOptions] = useState<TerritoryBranchOption[]>([]);
  const [selectedTerritoryBranchIds, setSelectedTerritoryBranchIds] = useState<string[]>([]);
  const [territorySummary, setTerritorySummary] = useState<TerritorySummary | null>(null);
  const [territoryLoading, setTerritoryLoading] = useState(false);
  const [territoryError, setTerritoryError] = useState<string | null>(null);
  const [showTerritoryCustomers, setShowTerritoryCustomers] = useState(true);
  const [showOtherBranches, setShowOtherBranches] = useState(false);
  const territoryRequestCounterRef = useRef(0);

  const findNearestBranch = (lat: number, lng: number) => {
    console.debug('Nearest branch lookup pending API integration:', { lat, lng });
  };

  const {
    mapContainerRef,
    mapRef,
    mapLoaded,
    mapError,
    currentZoom,
    currentCenter,
    currentGridLabel,
  } = useMapInstance({
    selectedGridLevels,
    onMapClick: findNearestBranch,
    onMapReady: (mapInstance) => {
      void loadBranchMarkers(mapInstance, showBranches, showOtherBranches);
      ensureTerritoryLayers(mapInstance, showTerritoryCustomers);
      void loadTerritoryVisualization(territoryMode, selectedTerritoryBranchIds, territoryCustomerView, mapInstance);
    },
  });

  const loadTerritoryVisualization = async (
    mode: TerritoryMode,
    branchIds: string[],
    customerView: TerritoryCustomerView,
    mapInstance = mapRef.current
  ) => {
    if (!mapInstance || !mapInstance.isStyleLoaded()) return;

    const requestId = territoryRequestCounterRef.current + 1;
    territoryRequestCounterRef.current = requestId;

    setTerritoryLoading(true);
    setTerritoryError(null);

    try {
      const payload = await api.getTerritoryVisualization({
        mode,
        branchIds: branchIds.length > 0 ? branchIds : undefined,
        customerView
      }) as TerritoryVisualizationResponse;

      if (!mapRef.current || territoryRequestCounterRef.current !== requestId) return;

      applyTerritoryVisualization(mapRef.current, payload, showTerritoryCustomers);

      setTerritoryBranchOptions(payload.availableBranches || []);
      setTerritorySummary(payload.summary || null);

      const responseSelectedIds = (payload.selectedBranchIds || []).map(String).slice(0, MAX_TERRITORY_BRANCHES);
      if (!hasSameIds(responseSelectedIds, selectedTerritoryBranchIds)) {
        setSelectedTerritoryBranchIds(responseSelectedIds);
      }
    } catch (error) {
      if (territoryRequestCounterRef.current !== requestId) return;

      const message = error instanceof Error ? error.message : 'Failed to load territory visualization';
      setTerritoryError(message);
      setTerritorySummary(null);
      if (mapRef.current) {
        clearTerritoryVisualization(mapRef.current);
      }
    } finally {
      if (territoryRequestCounterRef.current === requestId) {
        setTerritoryLoading(false);
      }
    }
  };

  const handleTerritoryModeChange = (nextMode: TerritoryMode) => {
    setTerritoryMode(nextMode);
    setSelectedTerritoryBranchIds([]);
    void loadTerritoryVisualization(nextMode, [], territoryCustomerView);
  };

  const handleTerritoryCustomerViewChange = (nextCustomerView: TerritoryCustomerView) => {
    setTerritoryCustomerView(nextCustomerView);
    void loadTerritoryVisualization(territoryMode, selectedTerritoryBranchIds, nextCustomerView);
  };

  const handleTerritoryBranchChange = (nextBranchIds: string[]) => {
    if (nextBranchIds.length > MAX_TERRITORY_BRANCHES) {
      setTerritoryError(`Select up to ${MAX_TERRITORY_BRANCHES} branches only.`);
      return;
    }

    setTerritoryError(null);
    setSelectedTerritoryBranchIds(nextBranchIds);
    void loadTerritoryVisualization(territoryMode, nextBranchIds, territoryCustomerView);
  };

  useEffect(() => {
    if (!mapRef.current) return;

    setBranchLayerVisibility(mapRef.current, showBranches && showOtherBranches);

    if (showBranches && showOtherBranches) {
      void loadBranchMarkers(mapRef.current, showBranches, showOtherBranches);
    }
  }, [mapRef, showBranches, showOtherBranches]);

  useEffect(() => {
    if (!mapRef.current) return;
    setCustomerLayerVisibility(mapRef.current, showTerritoryCustomers);
  }, [mapRef, showTerritoryCustomers, mapLoaded]);

  useEffect(() => {
    setDashboardMapPanel({
      zoomLevel: currentZoom,
      center: currentCenter,
      gridOverlay: currentGridLabel,
      mapLoaded,
      mapError
    });
  }, [currentZoom, currentCenter, currentGridLabel, mapLoaded, mapError, setDashboardMapPanel]);

  useEffect(() => () => {
    resetDashboardMapPanel();
  }, [resetDashboardMapPanel]);

  return (
    <Box sx={{ width: '100%', height: '100%', minHeight: 0, position: 'relative' }}>
      <MapContainer mapContainerRef={mapContainerRef} />
      <MapControls
        mapLoaded={mapLoaded}
        territoryMode={territoryMode}
        territoryCustomerView={territoryCustomerView}
        territoryBranchOptions={territoryBranchOptions}
        selectedTerritoryBranchIds={selectedTerritoryBranchIds}
        territorySummary={territorySummary}
        territoryLoading={territoryLoading}
        territoryError={territoryError}
        showTerritoryCustomers={showTerritoryCustomers}
        showOtherBranches={showOtherBranches}
        showBranches={showBranches}
        onTerritoryModeChange={handleTerritoryModeChange}
        onTerritoryCustomerViewChange={handleTerritoryCustomerViewChange}
        onTerritoryBranchChange={handleTerritoryBranchChange}
        onShowTerritoryCustomersChange={setShowTerritoryCustomers}
        onShowOtherBranchesChange={setShowOtherBranches}
      />
    </Box>
  );
}
