// Customer Mapping Table Component
// Requirements: 3.1, 3.2, 3.3, 3.5

import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Paper,
  Box,
  Typography,
  Skeleton,
  Chip,
  Tooltip,
} from '@mui/material';
import { Place, Business, Timeline } from '@mui/icons-material';
import { CustomerMapping, PaginationState } from '../types/customerMapping';

interface CustomerMappingTableProps {
  mappings: CustomerMapping[];
  pagination: PaginationState;
  loading: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export default function CustomerMappingTable({
  mappings,
  pagination,
  loading,
  onPageChange,
  onPageSizeChange,
}: CustomerMappingTableProps) {
  const handleChangePage = (_event: unknown, newPage: number) => {
    onPageChange(newPage + 1); // Material-UI uses 0-based, API uses 1-based
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    onPageSizeChange(parseInt(event.target.value, 10));
  };

  const formatDistance = (distance: number) => {
    if (distance < 1000) {
      return `${distance.toFixed(0)} m`;
    }
    return `${(distance / 1000).toFixed(2)} km`;
  };

  // Loading skeleton
  if (loading && mappings.length === 0) {
    return (
      <TableContainer component={Paper} sx={{ boxShadow: 2 }}>
        <Table>
          <TableHead>
            <TableRow sx={{ bgcolor: 'primary.main' }}>
              <TableCell sx={{ color: 'white', fontWeight: 600 }}>Customer ID</TableCell>
              <TableCell align="right" sx={{ color: 'white', fontWeight: 600 }}>Customer Lat</TableCell>
              <TableCell align="right" sx={{ color: 'white', fontWeight: 600 }}>Customer Lon</TableCell>
              <TableCell sx={{ color: 'white', fontWeight: 600 }}>Pocket ID</TableCell>
              <TableCell align="right" sx={{ color: 'white', fontWeight: 600 }}>Distance to Pocket</TableCell>
              <TableCell sx={{ color: 'white', fontWeight: 600 }}>Branch</TableCell>
              <TableCell align="right" sx={{ color: 'white', fontWeight: 600 }}>Pocket to Branch</TableCell>
              <TableCell align="right" sx={{ color: 'white', fontWeight: 600 }}>Customer to Branch</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {[...Array(5)].map((_, index) => (
              <TableRow key={index}>
                {[...Array(8)].map((_, cellIndex) => (
                  <TableCell key={cellIndex}>
                    <Skeleton animation="wave" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  }

  // Empty state
  if (!loading && mappings.length === 0) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: 400,
          bgcolor: 'background.paper',
          borderRadius: 2,
          boxShadow: 2,
          p: 4,
        }}
      >
        <Place sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
        <Typography variant="h6" color="text.secondary" gutterBottom>
          No customer mappings found
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Try adjusting your filters or upload a batch file to create mappings.
        </Typography>
      </Box>
    );
  }

  return (
    <Paper sx={{ boxShadow: 2 }}>
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow sx={{ bgcolor: 'primary.main' }}>
              <TableCell sx={{ color: 'white', fontWeight: 600 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Place fontSize="small" />
                  Customer ID
                </Box>
              </TableCell>
              <TableCell align="right" sx={{ color: 'white', fontWeight: 600 }}>Latitude</TableCell>
              <TableCell align="right" sx={{ color: 'white', fontWeight: 600 }}>Longitude</TableCell>
              <TableCell sx={{ color: 'white', fontWeight: 600 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Timeline fontSize="small" />
                  Pocket ID
                </Box>
              </TableCell>
              <TableCell align="right" sx={{ color: 'white', fontWeight: 600 }}>
                <Tooltip title="Distance from customer to pocket center">
                  <span>To Pocket</span>
                </Tooltip>
              </TableCell>
              <TableCell sx={{ color: 'white', fontWeight: 600 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Business fontSize="small" />
                  Branch
                </Box>
              </TableCell>
              <TableCell align="right" sx={{ color: 'white', fontWeight: 600 }}>
                <Tooltip title="Distance from pocket center to nearest branch">
                  <span>Pocket → Branch</span>
                </Tooltip>
              </TableCell>
              <TableCell align="right" sx={{ color: 'white', fontWeight: 600 }}>
                <Tooltip title="Distance from customer to nearest branch">
                  <span>Customer → Branch</span>
                </Tooltip>
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {mappings.map((mapping, index) => (
              <TableRow 
                key={mapping.id} 
                hover
                sx={{ 
                  '&:nth-of-type(odd)': { bgcolor: 'action.hover' },
                  transition: 'background-color 0.2s',
                }}
              >
                <TableCell>
                  <Chip 
                    label={mapping.customer_id} 
                    size="small" 
                    color="primary" 
                    variant="outlined"
                  />
                </TableCell>
                <TableCell align="right" sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                  {mapping.customer_lat.toFixed(6)}
                </TableCell>
                <TableCell align="right" sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                  {mapping.customer_lon.toFixed(6)}
                </TableCell>
                <TableCell>
                  <Chip 
                    label={mapping.pocket_id} 
                    size="small" 
                    color="secondary" 
                    variant="outlined"
                  />
                </TableCell>
                <TableCell align="right">
                  <Chip 
                    label={formatDistance(mapping.distance_customer_to_pocket)}
                    size="small"
                    sx={{ bgcolor: 'success.light', color: 'success.dark', fontWeight: 600 }}
                  />
                </TableCell>
                <TableCell>
                  <Tooltip title={mapping.branch_name || mapping.nearest_branch_id}>
                    <Chip 
                      label={mapping.branch_name || mapping.nearest_branch_id}
                      size="small"
                      color="info"
                      variant="outlined"
                      icon={<Business />}
                    />
                  </Tooltip>
                </TableCell>
                <TableCell align="right">
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {formatDistance(mapping.distance_pocket_to_branch)}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {formatDistance(mapping.distance_customer_to_branch)}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Box sx={{ borderTop: 1, borderColor: 'divider', bgcolor: 'grey.50' }}>
        <TablePagination
          component="div"
          count={pagination.totalRecords}
          page={pagination.page - 1} // Material-UI uses 0-based
          onPageChange={handleChangePage}
          rowsPerPage={pagination.pageSize}
          onRowsPerPageChange={handleChangeRowsPerPage}
          rowsPerPageOptions={[25, 50, 100, 250, 500]}
          labelDisplayedRows={({ from, to, count }) => (
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {`${from}–${to} of ${count !== -1 ? count.toLocaleString() : `more than ${to}`}`}
            </Typography>
          )}
        />
      </Box>
    </Paper>
  );
}
