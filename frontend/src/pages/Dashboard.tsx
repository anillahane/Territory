import { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useStore } from '../store/useStore';
import api, { queryKeys } from '../services/api';
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
import logger from '../utils/logger';
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
  const [territoryValidationError, setTerritoryValidationError] = useState<string | null>(null);
  const [showTerritoryCustomers, setShowTerritoryCustomers] = useState(true);
  const [showOtherBranches, setShowOtherBranches] = useState(false);

  const findNearestBranch = (lat: number, lng: number) => {
    logger.debug('Nearest branch lookup pending API integration', { lat, lng });
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
      ensureTerritoryLayers(mapInstance, showTerritoryCustomers);
      if (showBranches && showOtherBranches && branchMarkersQuery.data) {
        void loadBranchMarkers(mapInstance, showBranches, showOtherBranches, branchMarkersQuery.data);
      }
    },
  });

  const branchMarkersQuery = useQuery({
    queryKey: queryKeys.branches({ limit: 5000, offset: 0 }),
    queryFn: () => api.getBranches({ limit: 5000, offset: 0 }),
    enabled: showBranches && showOtherBranches,
    placeholderData: (previousData) => previousData,
  });

  const territoryVisualizationQuery = useQuery({
    queryKey: queryKeys.territoryVisualization({
      mode: territoryMode,
      branchIds: selectedTerritoryBranchIds,
      customerView: territoryCustomerView,
    }),
    queryFn: () => api.getTerritoryVisualization({
      mode: territoryMode,
      branchIds: selectedTerritoryBranchIds.length > 0 ? selectedTerritoryBranchIds : undefined,
      customerView: territoryCustomerView,
    }) as Promise<TerritoryVisualizationResponse>,
    placeholderData: (previousData) => previousData,
  });

  const territoryError =
    territoryValidationError
    || (territoryVisualizationQuery.error instanceof Error
      ? territoryVisualizationQuery.error.message
      : null);
  const territoryLoading = territoryVisualizationQuery.isFetching;

  const handleTerritoryModeChange = (nextMode: TerritoryMode) => {
    setTerritoryMode(nextMode);
    setSelectedTerritoryBranchIds([]);
    setTerritoryValidationError(null);
  };

  const handleTerritoryCustomerViewChange = (nextCustomerView: TerritoryCustomerView) => {
    setTerritoryCustomerView(nextCustomerView);
    setTerritoryValidationError(null);
  };

  const handleTerritoryBranchChange = (nextBranchIds: string[]) => {
    if (nextBranchIds.length > MAX_TERRITORY_BRANCHES) {
      setTerritoryValidationError(`Select up to ${MAX_TERRITORY_BRANCHES} branches only.`);
      return;
    }

    setTerritoryValidationError(null);
    setSelectedTerritoryBranchIds(nextBranchIds);
  };

  useEffect(() => {
    if (!mapRef.current) return;

    setBranchLayerVisibility(mapRef.current, showBranches && showOtherBranches);

    if (showBranches && showOtherBranches && branchMarkersQuery.data) {
      void loadBranchMarkers(mapRef.current, showBranches, showOtherBranches, branchMarkersQuery.data);
    }
  }, [branchMarkersQuery.data, mapRef, showBranches, showOtherBranches]);

  useEffect(() => {
    if (!mapRef.current || !mapRef.current.isStyleLoaded()) {
      return;
    }

    if (territoryVisualizationQuery.data) {
      applyTerritoryVisualization(mapRef.current, territoryVisualizationQuery.data, showTerritoryCustomers);
      setTerritoryBranchOptions(territoryVisualizationQuery.data.availableBranches || []);
      setTerritorySummary(territoryVisualizationQuery.data.summary || null);

      const responseSelectedIds = (territoryVisualizationQuery.data.selectedBranchIds || [])
        .map(String)
        .slice(0, MAX_TERRITORY_BRANCHES);
      if (!hasSameIds(responseSelectedIds, selectedTerritoryBranchIds)) {
        setSelectedTerritoryBranchIds(responseSelectedIds);
      }
      return;
    }

    if (territoryVisualizationQuery.isError) {
      clearTerritoryVisualization(mapRef.current);
      setTerritorySummary(null);
    }
  }, [
    mapRef,
    selectedTerritoryBranchIds,
    showTerritoryCustomers,
    territoryVisualizationQuery.data,
    territoryVisualizationQuery.isError,
  ]);

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
