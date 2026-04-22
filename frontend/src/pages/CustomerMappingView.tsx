// Customer Mapping View Container
// Requirements: 2.1, 3.1, 4.4, 4.5

import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper
} from '@mui/material';
import { Assessment, People, LocationOn, Business, Refresh as RefreshIcon } from '@mui/icons-material';
import CustomerMappingTable from '../components/CustomerMappingTable';
import FilterPanel from '../components/FilterPanel';
import DataState from '../components/DataState';
import customerMappingApi from '../services/customerMappingApi';
import {
  CustomerMapping,
  FilterState,
  PaginationState,
  ApiError,
  MappingImpactStats
} from '../types/customerMapping';
import { useStore } from '../store/useStore';
import api from '../services/api';

export default function CustomerMappingView() {
  const { setError, setSuccess } = useStore();

  const [mappings, setMappings] = useState<CustomerMapping[]>([]);
  const [filters, setFilters] = useState<FilterState>({
    jobId: '',
    customerId: '',
    pocketId: '',
  });
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    pageSize: 100,
    totalRecords: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<Array<{ id: string; name: string }>>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [stats, setStats] = useState({
    uniqueCustomers: 0,
    uniquePockets: 0,
    uniqueBranches: 0,
    avgDistance: 0,
  });
  const [impactStats, setImpactStats] = useState<MappingImpactStats>({
    comparableAccounts: 0,
    sameBranchAccounts: 0,
    differentBranchAccounts: 0,
    sameBranchCount: 0,
    differentBranchCount: 0,
    totalBranchCount: 0,
    avgExistingBranchDistance: 0,
    avgRevisedBranchDistance: 0,
    avgDistanceReduction: 0,
    totalDistanceReduction: 0,
    improvedAccounts: 0,
    unchangedDistanceAccounts: 0,
    worsenedAccounts: 0,
    sameBranchAvgOriginalDistance: 0,
    sameBranchAvgChangedDistance: 0,
    differentBranchAvgOriginalDistance: 0,
    differentBranchAvgChangedDistance: 0,
    sameBranchAvgImpact: 0,
    differentBranchAvgImpact: 0,
  });

  // Fetch available jobs for filter dropdown
  useEffect(() => {
    const fetchJobs = async () => {
      try {
        const response = await api.listJobs({ limit: 100 });
        const jobList = response.jobs.map((job: any) => ({
          id: job.jobId,
          name: `${job.type} - ${new Date(job.createdAt).toLocaleDateString()}`,
        }));
        setJobs(jobList);
      } catch (error) {
        console.error('Failed to fetch jobs:', error);
      }
    };
    fetchJobs();
  }, []);

  // Fetch mappings when filters or pagination change
  const fetchMappings = useCallback(async () => {
    setLoading(true);
    setLocalError(null);

    try {
      const params = {
        page: pagination.page,
        pageSize: pagination.pageSize,
        ...(filters.jobId && { jobId: filters.jobId }),
        ...(filters.customerId && { customerId: filters.customerId }),
        ...(filters.pocketId && { pocketId: filters.pocketId }),
      };

      const response = await customerMappingApi.fetchMappings(params);

      setMappings(response.data);
      setPagination({
        page: response.pagination.page,
        pageSize: response.pagination.pageSize,
        totalRecords: response.pagination.totalRecords,
        totalPages: response.pagination.totalPages,
      });

      setStats({
        uniqueCustomers: response.stats?.uniqueCustomers || 0,
        uniquePockets: response.stats?.uniquePockets || 0,
        uniqueBranches: response.stats?.uniqueBranches || 0,
        avgDistance: response.stats?.avgDistance || 0,
      });
      setImpactStats(response.stats?.impact || {
        comparableAccounts: 0,
        sameBranchAccounts: 0,
        differentBranchAccounts: 0,
        sameBranchCount: 0,
        differentBranchCount: 0,
        totalBranchCount: 0,
        avgExistingBranchDistance: 0,
        avgRevisedBranchDistance: 0,
        avgDistanceReduction: 0,
        totalDistanceReduction: 0,
        improvedAccounts: 0,
        unchangedDistanceAccounts: 0,
        worsenedAccounts: 0,
        sameBranchAvgOriginalDistance: 0,
        sameBranchAvgChangedDistance: 0,
        differentBranchAvgOriginalDistance: 0,
        differentBranchAvgChangedDistance: 0,
        sameBranchAvgImpact: 0,
        differentBranchAvgImpact: 0,
      });
    } catch (error) {
      const apiError = error as ApiError;
      const errorMessage = apiError.message || 'Failed to fetch customer mappings';
      setLocalError(errorMessage);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [filters, pagination.page, pagination.pageSize, setError]);

  // Fetch mappings on mount and when dependencies change
  useEffect(() => {
    fetchMappings();
  }, [fetchMappings]);

  const handleFilterChange = useCallback((newFilters: FilterState) => {
    setFilters(newFilters);
    setPagination((prev) => ({ ...prev, page: 1 })); // Reset to first page
  }, []);

  const handlePageChange = useCallback((newPage: number) => {
    setPagination((prev) => ({ ...prev, page: newPage }));
  }, []);

  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPagination((prev) => ({ ...prev, pageSize: newPageSize, page: 1 }));
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters({ jobId: '', customerId: '', pocketId: '' });
    setPagination((prev) => ({ ...prev, page: 1 }));
    setSuccess('Filters cleared');
  }, [setSuccess]);

  const formatDistance = (distance: number) => {
    if (distance < 1000) {
      return `${distance.toFixed(0)} m`;
    }
    return `${(distance / 1000).toFixed(2)} km`;
  };

  const formatReduction = (distance: number) => {
    const prefix = distance > 0 ? '+' : '';
    if (Math.abs(distance) < 1000) {
      return `${prefix}${distance.toFixed(0)} m`;
    }
    return `${prefix}${(distance / 1000).toFixed(2)} km`;
  };

  return (
    <Box sx={{ width: '100%', minHeight: '100%', p: 3, bgcolor: '#F8FAFC' }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" gutterBottom sx={{ fontWeight: 700, color: '#0F172A' }}>
          Customer Pocket Mappings
        </Typography>
        <Typography variant="body1" color="text.secondary">
          View and analyze customer-to-pocket assignments from batch processing operations.
        </Typography>
      </Box>

      {/* Statistics Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ boxShadow: 2, borderRadius: 2 }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Total Records
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 700 }}>
                    {pagination.totalRecords.toLocaleString()}
                  </Typography>
                </Box>
                <Assessment sx={{ fontSize: 40, color: 'primary.main', opacity: 0.7 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ boxShadow: 2, borderRadius: 2 }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Unique Customers
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 700 }}>
                    {stats.uniqueCustomers.toLocaleString()}
                  </Typography>
                </Box>
                <People sx={{ fontSize: 40, color: 'success.main', opacity: 0.7 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ boxShadow: 2, borderRadius: 2 }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Unique Pockets (5km)
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 700 }}>
                    {stats.uniquePockets.toLocaleString()}
                  </Typography>
                </Box>
                <LocationOn sx={{ fontSize: 40, color: 'warning.main', opacity: 0.7 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ boxShadow: 2, borderRadius: 2 }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Avg Distance
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 700 }}>
                    {formatDistance(stats.avgDistance)}
                  </Typography>
                </Box>
                <Business sx={{ fontSize: 40, color: 'info.main', opacity: 0.7 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Typography variant="h6" sx={{ mb: 1.2, fontWeight: 700, color: '#0F172A' }}>
        Branch Impact Summary (Existing vs Revised)
      </Typography>
      <Paper sx={{ boxShadow: 2, borderRadius: 2, mb: 3 }}>
        <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid #E2E8F0' }}>
          <Typography sx={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>
            All Branches Summary Grid
          </Typography>
          <Typography sx={{ fontSize: 12, color: '#64748B' }}>
            Summary is across all matching accounts, not just current page. Missing original branch is treated as unchanged for aggregate totals.
          </Typography>
        </Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Type of Branch Customer Mapping</TableCell>
                <TableCell align="right">Number of Branches</TableCell>
                <TableCell align="right">Number of Customers</TableCell>
                <TableCell align="right">Average Original Distance</TableCell>
                <TableCell align="right">Average Changed Distance</TableCell>
                <TableCell align="right">Impact</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Same Branch
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  {impactStats.sameBranchCount.toLocaleString()}
                </TableCell>
                <TableCell align="right">
                  {impactStats.sameBranchAccounts.toLocaleString()}
                </TableCell>
                <TableCell align="right">
                  {formatDistance(impactStats.sameBranchAvgOriginalDistance)}
                </TableCell>
                <TableCell align="right">
                  {formatDistance(impactStats.sameBranchAvgChangedDistance)}
                </TableCell>
                <TableCell align="right">
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 600,
                      color: impactStats.sameBranchAvgImpact >= 0 ? 'success.dark' : 'error.dark'
                    }}
                  >
                    {formatReduction(impactStats.sameBranchAvgImpact)}
                  </Typography>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Different Branch
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  {impactStats.differentBranchCount.toLocaleString()}
                </TableCell>
                <TableCell align="right">
                  {impactStats.differentBranchAccounts.toLocaleString()}
                </TableCell>
                <TableCell align="right">
                  {formatDistance(impactStats.differentBranchAvgOriginalDistance)}
                </TableCell>
                <TableCell align="right">
                  {formatDistance(impactStats.differentBranchAvgChangedDistance)}
                </TableCell>
                <TableCell align="right">
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 600,
                      color: impactStats.differentBranchAvgImpact >= 0 ? 'success.dark' : 'error.dark'
                    }}
                  >
                    {formatReduction(impactStats.differentBranchAvgImpact)}
                  </Typography>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    Total
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {impactStats.totalBranchCount.toLocaleString()}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {impactStats.comparableAccounts.toLocaleString()}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {formatDistance(impactStats.avgExistingBranchDistance)}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {formatDistance(impactStats.avgRevisedBranchDistance)}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 700,
                      color: impactStats.avgDistanceReduction >= 0 ? 'success.dark' : 'error.dark'
                    }}
                  >
                    {formatReduction(impactStats.avgDistanceReduction)}
                  </Typography>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <FilterPanel
        filters={filters}
        jobs={jobs}
        onFilterChange={handleFilterChange}
        onClearFilters={handleClearFilters}
      />

      {localError ? (
        <DataState
          variant="error"
          title="Unable to load customer mappings"
          description={localError}
          minHeight={400}
          action={
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => void fetchMappings()}>
              Try Again
            </Button>
          }
        />
      ) : loading && mappings.length === 0 ? (
        <DataState
          variant="loading"
          title="Loading customer mappings"
          description="Fetching mappings, impact metrics, and pagination details."
          minHeight={400}
        />
      ) : !loading && mappings.length === 0 ? (
        <DataState
          variant="empty"
          title="No customer mappings found"
          description="Try adjusting your filters or upload a batch file to create mappings."
          minHeight={400}
        />
      ) : (
        <CustomerMappingTable
          mappings={mappings}
          pagination={pagination}
          loading={loading}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
        />
      )}
    </Box>
  );
}
