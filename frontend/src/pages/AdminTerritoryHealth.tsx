import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography
} from '@mui/material';
import BuildCircleIcon from '@mui/icons-material/BuildCircle';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import api, { type AdminTerritoryHealthSummary } from '../services/api';
import { useStore } from '../store/useStore';

const REPAIR_LEVEL_METERS = 5000;
const REPAIR_TOLERANCE = 0.1;
const REPAIR_REASON_LABELS: Record<string, string> = {
  MISSING_TIER2_GRID: 'Missing Tier-2 Grid',
  MISSING_PERSISTED_5KM_LAYOUT: 'Missing Persisted 5km Layout',
  GHOST_DATA_DETECTED: 'Ghost Data Detected'
};

const normalizeRepairReasons = (
  repairReason: AdminTerritoryHealthSummary['repair_reason']
): string[] => {
  if (!repairReason) {
    return [];
  }

  if (Array.isArray(repairReason)) {
    return repairReason
      .map((reason) => String(reason || '').trim())
      .filter(Boolean);
  }

  const singleReason = String(repairReason).trim();
  return singleReason ? [singleReason] : [];
};

export default function AdminTerritoryHealth() {
  const { setError, setSuccess } = useStore();
  const [rows, setRows] = useState<AdminTerritoryHealthSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [repairingBranchId, setRepairingBranchId] = useState<string>('');
  const [repairingAll, setRepairingAll] = useState(false);
  const [globalSyncing, setGlobalSyncing] = useState(false);

  const loadHealth = useCallback(async (showFullLoader: boolean) => {
    if (showFullLoader) {
      setLoading(true);
    } else {
      setReloading(true);
    }

    try {
      const response = await api.getAdminTerritoryHealth();
      const nextRows = Array.isArray(response?.branches) ? response.branches : [];
      setRows(nextRows);
    } catch (error: any) {
      setError(error?.message || 'Failed to load territory health status.');
    } finally {
      setLoading(false);
      setReloading(false);
    }
  }, [setError]);

  useEffect(() => {
    void loadHealth(true);
  }, [loadHealth]);

  const invalidBranchIds = useMemo(
    () => rows.filter((row) => row.needs_repair).map((row) => row.branch_id),
    [rows]
  );

  const handleRepairBranch = useCallback(async (branchId: string, silentSuccess = false) => {
    const normalizedBranchId = String(branchId || '').trim();
    if (!normalizedBranchId) {
      return false;
    }

    setRepairingBranchId(normalizedBranchId);
    try {
      // --- ORIGINAL BACKUP ---
      // await api.runBranchTerritoryAllocation(normalizedBranchId, {
      //   useExistingTerritoriesOnly: true,
      //   level_m: REPAIR_LEVEL_METERS,
      //   tolerance: REPAIR_TOLERANCE
      // });
      await api.runBranchTerritoryAllocation(normalizedBranchId, {
        useExistingTerritoriesOnly: true,
        forceRepair: true,
        level_m: REPAIR_LEVEL_METERS,
        tolerance: REPAIR_TOLERANCE
      });

      const healthResponse = await api.getAdminTerritoryHealth();
      const refreshedRows = Array.isArray(healthResponse?.branches) ? healthResponse.branches : [];
      setRows(refreshedRows);
      const refreshedBranch = refreshedRows.find(
        (row) => String(row.branch_id || '') === normalizedBranchId
      );

      if (refreshedBranch?.needs_repair) {
        setError(
          `Repair executed for branch ${normalizedBranchId}, but health check is still invalid. Verify branch/customer pocket source data.`
        );
        return false;
      }

      if (!silentSuccess) {
        setSuccess(`Branch ${normalizedBranchId} repaired successfully.`);
      }
      return true;
    } catch (error: any) {
      setError(error?.message || `Failed to repair branch ${normalizedBranchId}.`);
      return false;
    } finally {
      setRepairingBranchId('');
    }
  }, [loadHealth, setError, setSuccess]);

  // --- ORIGINAL BACKUP ---
  // const handleRepairAllInvalid = useCallback(async () => {
  //   if (repairingAll || invalidBranchIds.length === 0) {
  //     return;
  //   }
  //
  //   setRepairingAll(true);
  //   let successCount = 0;
  //   for (const branchId of invalidBranchIds) {
  //     const repaired = await handleRepairBranch(branchId, true);
  //     if (repaired) {
  //       successCount += 1;
  //     }
  //   }
  //   setRepairingAll(false);
  //
  //   if (successCount > 0) {
  //     setSuccess(`Repaired ${successCount} of ${invalidBranchIds.length} invalid branch records.`);
  //   }
  // }, [handleRepairBranch, invalidBranchIds, repairingAll, setSuccess]);
  const handleRepairAllInvalid = useCallback(async () => {
    if (repairingAll || globalSyncing || invalidBranchIds.length === 0) {
      return;
    }

    setRepairingAll(true);
    let successCount = 0;
    for (const branchId of invalidBranchIds) {
      const repaired = await handleRepairBranch(branchId, true);
      if (repaired) {
        successCount += 1;
      }
    }
    setRepairingAll(false);

    if (successCount > 0) {
      setSuccess(`Repaired ${successCount} of ${invalidBranchIds.length} invalid branch records.`);
    }
  }, [globalSyncing, handleRepairBranch, invalidBranchIds, repairingAll, setSuccess]);

  const handleRunGlobalTerritorySync = useCallback(async () => {
    if (globalSyncing || repairingAll) {
      return;
    }

    setGlobalSyncing(true);
    try {
      const result = await api.runGlobalReallocation(REPAIR_LEVEL_METERS);
      await loadHealth(false);
      const succeeded = Number(result?.successCount || 0);
      const failed = Number(result?.failedCount || 0);
      if (failed > 0) {
        setError(`Global sync completed with ${succeeded} success and ${failed} failure(s).`);
      } else {
        setSuccess(`Global sync completed successfully for ${succeeded} branch(es).`);
      }
    } catch (error: any) {
      setError(error?.message || 'Global territory sync failed.');
    } finally {
      setGlobalSyncing(false);
    }
  }, [globalSyncing, loadHealth, repairingAll, setError, setSuccess]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

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
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              Territory Data Preparedness & Health
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Detect missing layouts and ghost allocations before branch managers begin operations.
            </Typography>
          </Box>
          {/* --- ORIGINAL BACKUP ---
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={reloading ? <CircularProgress size={16} /> : <AutorenewIcon />}
              onClick={() => void loadHealth(false)}
              disabled={reloading || repairingAll}
            >
              Refresh
            </Button>
            <Button
              variant="contained"
              color="warning"
              startIcon={repairingAll ? <CircularProgress size={16} color="inherit" /> : <BuildCircleIcon />}
              onClick={() => void handleRepairAllInvalid()}
              disabled={repairingAll || invalidBranchIds.length === 0}
            >
              Repair All Invalid Branches
            </Button>
          </Stack>
          */}
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={reloading ? <CircularProgress size={16} /> : <AutorenewIcon />}
              onClick={() => void loadHealth(false)}
              disabled={reloading || repairingAll || globalSyncing}
            >
              Refresh
            </Button>
            <Button
              variant="contained"
              color="primary"
              startIcon={globalSyncing ? <CircularProgress size={16} color="inherit" /> : <BuildCircleIcon />}
              onClick={() => void handleRunGlobalTerritorySync()}
              disabled={globalSyncing || repairingAll}
            >
              {globalSyncing ? 'Rebuilding National Territories...' : 'Run Global Territory Sync'}
            </Button>
            <Button
              variant="contained"
              color="warning"
              startIcon={repairingAll ? <CircularProgress size={16} color="inherit" /> : <BuildCircleIcon />}
              onClick={() => void handleRepairAllInvalid()}
              disabled={repairingAll || globalSyncing || invalidBranchIds.length === 0}
            >
              Repair All Invalid Branches
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {globalSyncing && (
        <Alert severity="info">
          Rebuilding national territories... This may take a few minutes.
        </Alert>
      )}

      {invalidBranchIds.length > 0 && (
        <Alert severity="warning">
          {`${invalidBranchIds.length} branch(es) currently need repair.`}
        </Alert>
      )}

      <TableContainer component={Paper} sx={{ borderRadius: 2 }}>
        <Table size="small">
          <TableHead>
            {/* --- ORIGINAL BACKUP ---
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>Branch ID</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Branch Name</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Tier-2 Grid</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Repair Status</TableCell>
              <TableCell sx={{ fontWeight: 700 }} align="right">Assigned Pockets</TableCell>
              <TableCell sx={{ fontWeight: 700 }} align="right">Action</TableCell>
            </TableRow>
            */}
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>Branch ID</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Branch Name</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Tier-2 Grid</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Repair Status</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Repair Reason</TableCell>
              <TableCell sx={{ fontWeight: 700 }} align="right">Assigned Pockets</TableCell>
              <TableCell sx={{ fontWeight: 700 }} align="right">Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const rowRepairInProgress = repairingBranchId === row.branch_id;
              const repairReasons = normalizeRepairReasons(row.repair_reason);
              return (
                <TableRow
                  key={row.branch_id}
                  sx={{
                    backgroundColor: row.needs_repair ? 'rgba(245, 158, 11, 0.12)' : 'inherit'
                  }}
                >
                  <TableCell>{row.branch_id}</TableCell>
                  <TableCell>{row.branch_name}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={row.is_grid_generated ? 'success' : 'default'}
                      label={row.is_grid_generated ? 'Generated' : 'Missing'}
                    />
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={row.needs_repair ? 'warning' : 'success'}
                      label={row.needs_repair ? 'Needs Repair' : 'Healthy'}
                    />
                  </TableCell>
                  <TableCell>
                    {repairReasons.length > 0 ? (
                      <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }} useFlexGap>
                        {repairReasons.map((reason) => (
                          <Chip
                            key={`${row.branch_id}-${reason}`}
                            size="small"
                            variant="outlined"
                            color="warning"
                            label={REPAIR_REASON_LABELS[reason] || reason}
                          />
                        ))}
                      </Stack>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        -
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">{row.assigned_pockets_count}</TableCell>
                  <TableCell align="right">
                    {/* --- ORIGINAL BACKUP ---
                    {row.needs_repair ? (
                      <Button
                        size="small"
                        variant="contained"
                        color="warning"
                        onClick={() => void handleRepairBranch(row.branch_id)}
                        disabled={repairingAll || rowRepairInProgress}
                        startIcon={rowRepairInProgress ? <CircularProgress size={14} color="inherit" /> : <BuildCircleIcon />}
                      >
                        Repair Branch
                      </Button>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        No action needed
                      </Typography>
                    )}
                    */}
                    {row.needs_repair ? (
                      <Button
                        size="small"
                        variant="contained"
                        color="warning"
                        onClick={() => void handleRepairBranch(row.branch_id)}
                        disabled={globalSyncing || repairingAll || rowRepairInProgress}
                        startIcon={rowRepairInProgress ? <CircularProgress size={14} color="inherit" /> : <BuildCircleIcon />}
                      >
                        Repair Branch
                      </Button>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        No action needed
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                    No branches found.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}
