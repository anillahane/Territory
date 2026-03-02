// Customer Mapping View Container
// Requirements: 2.1, 3.1, 4.4, 4.5

import { useState, useEffect, useCallback } from 'react';
import { Box, Typography, Alert, Card, CardContent, Grid, CircularProgress } from '@mui/material';
import { Assessment, People, LocationOn, Business } from '@mui/icons-material';
import CustomerMappingTable from '../components/CustomerMappingTable';
import FilterPanel from '../components/FilterPanel';
import customerMappingApi from '../services/customerMappingApi';
import {
  CustomerMapping,
  FilterState,
  PaginationState,
  ApiError,
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

      {localError && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setLocalError(null)}>
          {localError}
        </Alert>
      )}

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
                    Unique Pockets
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

      <FilterPanel
        filters={filters}
        jobs={jobs}
        onFilterChange={handleFilterChange}
        onClearFilters={handleClearFilters}
      />

      {loading && mappings.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
          <CircularProgress size={60} />
        </Box>
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
