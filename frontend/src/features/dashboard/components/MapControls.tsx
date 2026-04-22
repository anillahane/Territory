import {
  Alert,
  Box,
  Checkbox,
  CircularProgress,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  OutlinedInput,
  Paper,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import {
  MAX_TERRITORY_BRANCHES,
  TERRITORY_CUSTOMER_VIEW_OPTIONS,
  TERRITORY_MODE_OPTIONS,
} from '../constants';
import type {
  TerritoryBranchOption,
  TerritoryCustomerView,
  TerritoryMode,
  TerritorySummary,
} from '../types';

type MapControlsProps = {
  mapLoaded: boolean;
  territoryMode: TerritoryMode;
  territoryCustomerView: TerritoryCustomerView;
  territoryBranchOptions: TerritoryBranchOption[];
  selectedTerritoryBranchIds: string[];
  territorySummary: TerritorySummary | null;
  territoryLoading: boolean;
  territoryError: string | null;
  showTerritoryCustomers: boolean;
  showOtherBranches: boolean;
  showBranches: boolean;
  onTerritoryModeChange: (nextMode: TerritoryMode) => void;
  onTerritoryCustomerViewChange: (nextCustomerView: TerritoryCustomerView) => void;
  onTerritoryBranchChange: (nextBranchIds: string[]) => void;
  onShowTerritoryCustomersChange: (value: boolean) => void;
  onShowOtherBranchesChange: (value: boolean) => void;
};

export function MapControls({
  mapLoaded,
  territoryMode,
  territoryCustomerView,
  territoryBranchOptions,
  selectedTerritoryBranchIds,
  territorySummary,
  territoryLoading,
  territoryError,
  showTerritoryCustomers,
  showOtherBranches,
  showBranches,
  onTerritoryModeChange,
  onTerritoryCustomerViewChange,
  onTerritoryBranchChange,
  onShowTerritoryCustomersChange,
  onShowOtherBranchesChange,
}: MapControlsProps) {
  return (
    <Paper
      elevation={6}
      sx={{
        position: 'absolute',
        top: 16,
        right: 16,
        width: { xs: 'calc(100% - 32px)', sm: 360 },
        maxHeight: 'calc(100% - 32px)',
        overflowY: 'auto',
        p: 1.5,
        zIndex: 3,
        borderRadius: 2,
        backgroundColor: 'rgba(15, 23, 42, 0.9)',
        border: '1px solid rgba(148, 163, 184, 0.35)',
        color: '#E2E8F0',
        backdropFilter: 'blur(6px)'
      }}
    >
      <Stack spacing={1.25}>
        <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
          Voronoi Territory View
        </Typography>

        <FormControl fullWidth size="small">
          <InputLabel id="territory-mode-label" sx={{ color: '#CBD5E1' }}>
            Mode
          </InputLabel>
          <Select
            labelId="territory-mode-label"
            value={territoryMode}
            label="Mode"
            onChange={(event) => onTerritoryModeChange(event.target.value as TerritoryMode)}
            disabled={territoryLoading || !mapLoaded}
            sx={{
              color: '#E2E8F0',
              '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(148, 163, 184, 0.5)' },
              '& .MuiSvgIcon-root': { color: '#CBD5E1' }
            }}
          >
            {TERRITORY_MODE_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl fullWidth size="small">
          <InputLabel id="territory-branch-label" sx={{ color: '#CBD5E1' }}>
            Branch
          </InputLabel>
          <Select
            labelId="territory-branch-label"
            value={selectedTerritoryBranchIds[0] || ''}
            onChange={(event) => {
              const nextBranchId = String(event.target.value || '').trim();
              onTerritoryBranchChange(nextBranchId ? [nextBranchId] : []);
            }}
            input={<OutlinedInput label="Branch" />}
            disabled={territoryLoading || territoryBranchOptions.length === 0 || !mapLoaded}
            sx={{
              color: '#E2E8F0',
              '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(148, 163, 184, 0.5)' },
              '& .MuiSvgIcon-root': { color: '#CBD5E1' }
            }}
          >
            {territoryBranchOptions.map((branch) => (
              <MenuItem key={branch.id} value={branch.id}>
                {`${branch.id} (${branch.customerCount}) - ${branch.city}`}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl fullWidth size="small">
          <InputLabel id="territory-customer-view-label" sx={{ color: '#CBD5E1' }}>
            Customer View
          </InputLabel>
          <Select
            labelId="territory-customer-view-label"
            value={territoryCustomerView}
            label="Customer View"
            onChange={(event) => onTerritoryCustomerViewChange(event.target.value as TerritoryCustomerView)}
            disabled={territoryLoading || !mapLoaded}
            sx={{
              color: '#E2E8F0',
              '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(148, 163, 184, 0.5)' },
              '& .MuiSvgIcon-root': { color: '#CBD5E1' }
            }}
          >
            {TERRITORY_CUSTOMER_VIEW_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControlLabel
          control={(
            <Checkbox
              size="small"
              checked={showTerritoryCustomers}
              onChange={(event) => onShowTerritoryCustomersChange(event.target.checked)}
              disabled={!mapLoaded}
            />
          )}
          label="Show Customers (Selected Branches)"
          sx={{
            m: 0,
            '& .MuiFormControlLabel-label': { fontSize: 12, color: '#CBD5E1' }
          }}
        />

        <FormControlLabel
          control={(
            <Checkbox
              size="small"
              checked={showOtherBranches}
              onChange={(event) => onShowOtherBranchesChange(event.target.checked)}
              disabled={!mapLoaded || !showBranches}
            />
          )}
          label="Show Other Branches"
          sx={{
            m: 0,
            '& .MuiFormControlLabel-label': { fontSize: 12, color: '#CBD5E1' }
          }}
        />

        {territoryLoading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={16} sx={{ color: '#38BDF8' }} />
            <Typography sx={{ fontSize: 12, color: '#CBD5E1' }}>Refreshing territory view...</Typography>
          </Box>
        )}

        {territorySummary && (
          <Stack spacing={0.3}>
            <Typography sx={{ fontSize: 11, color: '#94A3B8' }}>
              Territories: {territorySummary.territories}
            </Typography>
            <Typography sx={{ fontSize: 11, color: '#94A3B8' }}>
              Source Points: {territorySummary.points} ({territorySummary.sourceType})
            </Typography>
            <Typography sx={{ fontSize: 11, color: '#94A3B8' }}>
              Visible Customers: {territorySummary.customersVisible}
            </Typography>
            <Typography sx={{ fontSize: 11, color: '#94A3B8' }}>
              Customer View: {territoryCustomerView === 'original_customers' ? 'Original Customers' : 'Selected Pockets'}
            </Typography>
            <Typography sx={{ fontSize: 11, color: '#94A3B8' }}>
              Selected Branch: {selectedTerritoryBranchIds.length}/{MAX_TERRITORY_BRANCHES}
            </Typography>
            <Typography sx={{ fontSize: 11, color: '#94A3B8' }}>
              Other Branches: {showOtherBranches ? 'Visible' : 'Hidden'}
            </Typography>
          </Stack>
        )}

        {territoryError && (
          <Alert severity="error" sx={{ py: 0.3, '& .MuiAlert-message': { fontSize: 12 } }}>
            {territoryError}
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}
