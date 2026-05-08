import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  OutlinedInput,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography
} from '@mui/material';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import StorageIcon from '@mui/icons-material/Storage';
import turfArea from '@turf/area';
import api from '../services/api';
import { useStore } from '../store/useStore';

const MAX_SELECTED_BRANCHES = 5;

const TERRITORY_DATA_BASIS_OPTIONS = [
  {
    value: 'current_ownership',
    label: 'Current Ownership',
    description: 'Live polygons from current uploaded branch ownership.',
    mode: 'existing_customers',
    customerView: 'original_customers',
    coverageStyle: 'overlap'
  },
  {
    value: 'closest_branch',
    label: 'Closest Branch',
    description: 'Live polygons from nearest-branch pocket assignment.',
    mode: 'nearest_pockets',
    customerView: 'selected_pockets',
    coverageStyle: 'overlap'
  },
  {
    value: 'strongest_presence',
    label: 'Strongest Presence',
    description: 'Live polygons from strongest existing customer presence per pocket.',
    mode: 'customer_availability',
    customerView: 'selected_pockets',
    coverageStyle: 'overlap'
  },
  {
    value: 'mutually_exclusive',
    label: 'Mutually Exclusive Coverage',
    description: 'Current ownership polygons clipped to exclusive, non-overlapping branch coverage.',
    mode: 'existing_customers',
    customerView: 'original_customers',
    coverageStyle: 'exclusive'
  }
] as const;

type TerritoryDataBasis = typeof TERRITORY_DATA_BASIS_OPTIONS[number]['value'];

type BranchOption = {
  id: string;
  city: string;
};

type TerritoryBranchSummary = {
  id: string;
  city: string;
  customerCount: number;
};

type TerritoryVisualizationSummary = {
  territories?: number;
  branches?: number;
  customers?: number;
  customersVisible?: number;
  pockets?: number;
  sourceType?: string;
};

type TerritoryVisualizationResponse = {
  jobId?: string | null;
  mode: string;
  modeLabel: string;
  coverageStyle?: string;
  selectedBranchIds: string[];
  availableBranches: TerritoryBranchSummary[];
  summary?: TerritoryVisualizationSummary;
  territories: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
};

type TerritoryDataRow = {
  branchId: string;
  branchName: string;
  city: string;
  customerCount: number;
  areaSqKm: number;
  polygonCount: number;
  featureCount: number;
  geometryType: string;
  hasCoverage: boolean;
  geoJson: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
};

const buildBranchName = (branchId: string, city?: string | null) => {
  const normalizedBranchId = String(branchId || '').trim();
  const normalizedCity = String(city || '').trim();
  if (!normalizedBranchId) {
    return normalizedCity;
  }
  return normalizedCity ? `${normalizedBranchId} - ${normalizedCity}` : normalizedBranchId;
};

const getBranchIdFromFeature = (
  feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
) => String(feature.properties?.branchId || '').trim();

const countGeometryPolygons = (geometry?: GeoJSON.Geometry | null) => {
  if (!geometry) {
    return 0;
  }
  if (geometry.type === 'Polygon') {
    return 1;
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.length;
  }
  return 0;
};

const formatNumber = (value: number, maximumFractionDigits = 2) =>
  new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits
  }).format(Number.isFinite(value) ? value : 0);

const formatRefreshTimestamp = (timestamp: string | null) => {
  if (!timestamp) {
    return 'Not refreshed yet';
  }

  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return timestamp;
  }

  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(value);
};

const normalizeBranches = (response: unknown): BranchOption[] => {
  const responseRecord = response && typeof response === 'object'
    ? response as Record<string, unknown>
    : null;
  const rawCandidate = responseRecord?.branches ?? responseRecord?.data ?? response;
  const rows = Array.isArray(rawCandidate) ? rawCandidate : [];

  return rows
    .map((row) => {
      const branch = row as Record<string, unknown>;
      const id = String(branch.id || '').trim();
      const city = String(branch.city || '').trim();
      if (!id) {
        return null;
      }

      return {
        id,
        city
      } as BranchOption;
    })
    .filter((row): row is BranchOption => Boolean(row))
    .sort((left, right) => left.id.localeCompare(right.id));
};

export default function TerritoryData() {
  const { setError } = useStore();
  const [branchOptions, setBranchOptions] = useState<BranchOption[]>([]);
  const [branchOptionsLoading, setBranchOptionsLoading] = useState(false);
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);
  const [basis, setBasis] = useState<TerritoryDataBasis>('current_ownership');
  const [loading, setLoading] = useState(false);
  const [territoryData, setTerritoryData] = useState<TerritoryVisualizationResponse | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [previewBranchId, setPreviewBranchId] = useState('');
  const territoryRequestCounterRef = useRef(0);

  const selectedBasisConfig = useMemo(
    () => TERRITORY_DATA_BASIS_OPTIONS.find((option) => option.value === basis) || TERRITORY_DATA_BASIS_OPTIONS[0],
    [basis]
  );

  const loadBranchCatalog = useCallback(async () => {
    setBranchOptionsLoading(true);
    try {
      const response = await api.getBranches({ limit: 1000, offset: 0 });
      const nextBranchOptions = normalizeBranches(response);
      setBranchOptions(nextBranchOptions);
      setSelectedBranchIds((currentBranchIds) => {
        if (currentBranchIds.length > 0) {
          return currentBranchIds;
        }
        if (nextBranchOptions.length === 0) {
          return [];
        }
        return [nextBranchOptions[0].id];
      });
    } catch (error: any) {
      setError(error?.message || 'Failed to load branch catalog.');
    } finally {
      setBranchOptionsLoading(false);
    }
  }, [setError]);

  const loadTerritoryData = useCallback(async () => {
    if (selectedBranchIds.length === 0) {
      setTerritoryData(null);
      return;
    }

    const requestId = territoryRequestCounterRef.current + 1;
    territoryRequestCounterRef.current = requestId;
    setLoading(true);

    try {
      const response = await api.getTerritoryVisualization({
        mode: selectedBasisConfig.mode,
        branchIds: selectedBranchIds,
        customerView: selectedBasisConfig.customerView,
        coverageStyle: selectedBasisConfig.coverageStyle
      }) as TerritoryVisualizationResponse;

      if (territoryRequestCounterRef.current !== requestId) {
        return;
      }

      setTerritoryData(response);
      setLastRefreshedAt(new Date().toISOString());
    } catch (error: any) {
      if (territoryRequestCounterRef.current !== requestId) {
        return;
      }

      setTerritoryData(null);
      setError(error?.message || 'Failed to load territory data.');
    } finally {
      if (territoryRequestCounterRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [
    selectedBasisConfig.coverageStyle,
    selectedBasisConfig.customerView,
    selectedBasisConfig.mode,
    selectedBranchIds,
    setError
  ]);

  useEffect(() => {
    void loadBranchCatalog();
  }, [loadBranchCatalog]);

  useEffect(() => {
    if (selectedBranchIds.length === 0) {
      return;
    }

    void loadTerritoryData();
  }, [loadTerritoryData, selectedBranchIds]);

  const territoryRows = useMemo<TerritoryDataRow[]>(() => {
    if (!territoryData) {
      return [];
    }

    const branchLookup = new Map<string, { city: string; customerCount: number }>();
    territoryData.availableBranches.forEach((branch) => {
      branchLookup.set(String(branch.id || '').trim(), {
        city: String(branch.city || '').trim(),
        customerCount: Number(branch.customerCount || 0)
      });
    });

    branchOptions.forEach((branch) => {
      if (!branchLookup.has(branch.id)) {
        branchLookup.set(branch.id, {
          city: branch.city,
          customerCount: 0
        });
      }
    });

    return selectedBranchIds.map((branchId) => {
      const features = territoryData.territories.features.filter((feature) =>
        getBranchIdFromFeature(feature) === branchId
      );
      const areaSqKm = features.reduce((total, feature) => total + (turfArea(feature) / 1_000_000), 0);
      const polygonCount = features.reduce(
        (total, feature) => total + countGeometryPolygons(feature.geometry),
        0
      );
      const geometryType = features.length > 0
        ? Array.from(new Set(features.map((feature) => feature.geometry.type))).join(', ')
        : 'None';
      const branchSummary = branchLookup.get(branchId);
      const city = branchSummary?.city || '';

      return {
        branchId,
        branchName: buildBranchName(branchId, city),
        city,
        customerCount: Number(branchSummary?.customerCount || 0),
        areaSqKm,
        polygonCount,
        featureCount: features.length,
        geometryType,
        hasCoverage: features.length > 0,
        geoJson: {
          type: 'FeatureCollection',
          features
        } as GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>
      };
    }).sort((left, right) => {
      if (left.hasCoverage !== right.hasCoverage) {
        return left.hasCoverage ? -1 : 1;
      }
      if (left.customerCount !== right.customerCount) {
        return right.customerCount - left.customerCount;
      }
      return left.branchId.localeCompare(right.branchId);
    });
  }, [branchOptions, selectedBranchIds, territoryData]);

  useEffect(() => {
    if (territoryRows.length === 0) {
      setPreviewBranchId('');
      return;
    }

    const previewExists = territoryRows.some((row) => row.branchId === previewBranchId);
    if (!previewExists) {
      setPreviewBranchId(territoryRows[0].branchId);
    }
  }, [previewBranchId, territoryRows]);

  const previewRow = useMemo(
    () => territoryRows.find((row) => row.branchId === previewBranchId) || territoryRows[0] || null,
    [previewBranchId, territoryRows]
  );

  const totalAreaSqKm = useMemo(
    () => territoryRows.reduce((total, row) => total + row.areaSqKm, 0),
    [territoryRows]
  );

  const handleBranchChange = (nextValue: unknown) => {
    const nextBranchIds = (
      Array.isArray(nextValue)
        ? nextValue
        : String(nextValue || '').split(',')
    )
      .map((value) => String(value || '').trim())
      .filter(Boolean);

    const uniqueBranchIds = Array.from(new Set(nextBranchIds));
    if (uniqueBranchIds.length > MAX_SELECTED_BRANCHES) {
      setError(`Select up to ${MAX_SELECTED_BRANCHES} branches for Territory Data.`);
    }

    setSelectedBranchIds(uniqueBranchIds.slice(0, MAX_SELECTED_BRANCHES));
  };

  return (
    <Stack spacing={2}>
      <Paper sx={{ p: 2, borderRadius: 2 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.5}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', md: 'center' }}
        >
          <Box>
            <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 0.75 }}>
              <StorageIcon sx={{ color: '#1D4ED8' }} />
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                Territory Data
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Dynamic territory datasets computed from the latest branch and customer mappings.
              Use refresh after batch uploads or mapping changes.
            </Typography>
          </Box>
          <Button
            variant="outlined"
            startIcon={loading ? <CircularProgress size={16} /> : <AutorenewIcon />}
            onClick={() => void loadTerritoryData()}
            disabled={loading || selectedBranchIds.length === 0}
          >
            Refresh
          </Button>
        </Stack>
      </Paper>

      <Paper sx={{ p: 2, borderRadius: 2 }}>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2}>
          <FormControl fullWidth size="small">
            <InputLabel id="territory-data-basis-label">Basis Type</InputLabel>
            <Select
              labelId="territory-data-basis-label"
              value={basis}
              label="Basis Type"
              onChange={(event) => setBasis(event.target.value as TerritoryDataBasis)}
              disabled={loading}
            >
              {TERRITORY_DATA_BASIS_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth size="small">
            <InputLabel id="territory-data-branch-label">Branch</InputLabel>
            <Select
              labelId="territory-data-branch-label"
              multiple
              value={selectedBranchIds}
              onChange={(event) => handleBranchChange(event.target.value)}
              input={<OutlinedInput label="Branch" />}
              renderValue={(selected) => (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {(selected as string[]).map((branchId) => {
                    const option = branchOptions.find((branch) => branch.id === branchId);
                    return (
                      <Chip
                        key={branchId}
                        size="small"
                        label={buildBranchName(branchId, option?.city)}
                      />
                    );
                  })}
                </Box>
              )}
              disabled={loading || branchOptionsLoading || branchOptions.length === 0}
            >
              {branchOptions.map((branch) => (
                <MenuItem key={branch.id} value={branch.id}>
                  {buildBranchName(branch.id, branch.city)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>

        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', md: 'center' }}
          sx={{ mt: 1.5 }}
        >
          <Typography variant="body2" color="text.secondary">
            {selectedBasisConfig.description}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Select up to {MAX_SELECTED_BRANCHES} branches.
          </Typography>
        </Stack>
      </Paper>

      {basis === 'mutually_exclusive' && (
        <Alert severity="info">
          Mutually Exclusive Coverage uses current ownership assignments, but clips branch polygons
          into exclusive, non-overlapping coverage.
        </Alert>
      )}

      {selectedBranchIds.length === 0 && (
        <Alert severity="warning">
          Select at least one branch to load Territory Data.
        </Alert>
      )}

      <Stack direction={{ xs: 'column', xl: 'row' }} spacing={2}>
        <Paper sx={{ p: 2, borderRadius: 2, flex: 1 }}>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }} useFlexGap>
            <Chip label="Data Source: Live computed view" color="primary" variant="outlined" />
            <Chip label={`Job ID: ${territoryData?.jobId || '-'}`} variant="outlined" />
            <Chip
              label={`Coverage: ${territoryData?.coverageStyle || selectedBasisConfig.coverageStyle}`}
              variant="outlined"
            />
            <Chip label={`Last Refreshed: ${formatRefreshTimestamp(lastRefreshedAt)}`} variant="outlined" />
          </Stack>
        </Paper>

        <Paper sx={{ p: 2, borderRadius: 2, minWidth: { xl: 340 } }}>
          <Stack spacing={0.75}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Snapshot Summary
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Basis: {selectedBasisConfig.label}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Territory records: {territoryData?.summary?.territories ?? territoryRows.length}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Visible customers: {territoryData?.summary?.customersVisible ?? 0}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Source pockets: {territoryData?.summary?.pockets ?? 0}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Total polygon area: {formatNumber(totalAreaSqKm)} sq km
            </Typography>
          </Stack>
        </Paper>
      </Stack>

      <TableContainer component={Paper} sx={{ borderRadius: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>Branch</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Coverage</TableCell>
              <TableCell sx={{ fontWeight: 700 }} align="right">Customers</TableCell>
              <TableCell sx={{ fontWeight: 700 }} align="right">Area (sq km)</TableCell>
              <TableCell sx={{ fontWeight: 700 }} align="right">Polygon Parts</TableCell>
              <TableCell sx={{ fontWeight: 700 }} align="right">Feature Rows</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Geometry Type</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Box sx={{ py: 3 }}>
                    <CircularProgress size={22} />
                  </Box>
                </TableCell>
              </TableRow>
            ) : territoryRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                    No territory data loaded.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : territoryRows.map((row) => (
              <TableRow
                key={row.branchId}
                hover
                selected={previewRow?.branchId === row.branchId}
                onClick={() => setPreviewBranchId(row.branchId)}
                sx={{ cursor: 'pointer' }}
              >
                <TableCell>{row.branchName}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    color={row.hasCoverage ? 'success' : 'warning'}
                    label={row.hasCoverage ? 'Coverage Ready' : 'No Coverage'}
                  />
                </TableCell>
                <TableCell align="right">{formatNumber(row.customerCount, 0)}</TableCell>
                <TableCell align="right">{formatNumber(row.areaSqKm)}</TableCell>
                <TableCell align="right">{formatNumber(row.polygonCount, 0)}</TableCell>
                <TableCell align="right">{formatNumber(row.featureCount, 0)}</TableCell>
                <TableCell>{row.geometryType}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Paper sx={{ p: 2, borderRadius: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.75 }}>
          Geometry Preview
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Raw GeoJSON coordinates for the selected branch row.
        </Typography>
        {previewRow ? (
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 1.5,
              borderRadius: 2,
              backgroundColor: '#0F172A',
              color: '#E2E8F0',
              overflowX: 'auto',
              overflowY: 'auto',
              maxHeight: 420,
              fontSize: 12,
              lineHeight: 1.5
            }}
          >
            {JSON.stringify(previewRow.geoJson, null, 2)}
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Select a territory row to inspect its geometry.
          </Typography>
        )}
      </Paper>
    </Stack>
  );
}
