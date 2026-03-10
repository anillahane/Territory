import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
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
import api, { type GridCellRecord } from '../services/api';
import { useStore } from '../store/useStore';

const DEFAULT_LIMIT = 50;

const formatCoordinate = (value: number | null) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '-';
  }
  return Number(value).toFixed(6);
};

export default function GridCellsViewer() {
  const { setError } = useStore();
  const [rows, setRows] = useState<GridCellRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(totalRecords / DEFAULT_LIMIT)),
    [totalRecords]
  );

  const loadGridCells = useCallback(async (page: number) => {
    setLoading(true);
    try {
      const response = await api.getGridCells(page, DEFAULT_LIMIT);
      setRows(Array.isArray(response?.data) ? response.data : []);
      setTotalRecords(Number(response?.total || 0));
    } catch (error: any) {
      setError(error?.message || 'Failed to load grid cell master tiles.');
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => {
    void loadGridCells(currentPage);
  }, [currentPage, loadGridCells]);

  return (
    <Stack spacing={2}>
      <Paper sx={{ p: 2, borderRadius: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Master Tile Viewer
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Raw `grid_cells` records for validating hierarchical pocket tiles and bbox bounds.
        </Typography>
      </Paper>

      <TableContainer component={Paper} sx={{ borderRadius: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>Pocket ID</TableCell>
              <TableCell sx={{ fontWeight: 700 }} align="right">Level (m)</TableCell>
              <TableCell sx={{ fontWeight: 700 }} align="right">Min Lat</TableCell>
              <TableCell sx={{ fontWeight: 700 }} align="right">Max Lat</TableCell>
              <TableCell sx={{ fontWeight: 700 }} align="right">Min Lng</TableCell>
              <TableCell sx={{ fontWeight: 700 }} align="right">Max Lng</TableCell>
              <TableCell sx={{ fontWeight: 700 }} align="right">Assigned Employee ID</TableCell>
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
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                    No master tiles found.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : rows.map((row) => (
              <TableRow key={`${row.level_m}-${row.pocket_id}`}>
                <TableCell>{row.pocket_id}</TableCell>
                <TableCell align="right">{row.level_m}</TableCell>
                <TableCell align="right">{formatCoordinate(row.min_lat)}</TableCell>
                <TableCell align="right">{formatCoordinate(row.max_lat)}</TableCell>
                <TableCell align="right">{formatCoordinate(row.min_lng)}</TableCell>
                <TableCell align="right">{formatCoordinate(row.max_lng)}</TableCell>
                <TableCell align="right">
                  {row.allocated_employee_id === null ? '-' : row.allocated_employee_id}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Paper sx={{ p: 1.5, borderRadius: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="body2" color="text.secondary">
            Page {currentPage} of {totalPages} | Total Records: {totalRecords}
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              onClick={() => setCurrentPage((previous) => Math.max(previous - 1, 1))}
              disabled={loading || currentPage <= 1}
            >
              Previous Page
            </Button>
            <Button
              variant="contained"
              onClick={() => setCurrentPage((previous) => Math.min(previous + 1, totalPages))}
              disabled={loading || currentPage >= totalPages}
            >
              Next Page
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
}
