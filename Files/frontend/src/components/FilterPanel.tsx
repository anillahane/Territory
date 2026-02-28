// Filter Panel Component
// Requirements: 4.1, 4.2, 4.3, 4.6

import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  TextField,
  Button,
  Paper,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  SelectChangeEvent,
  Chip,
  InputAdornment,
} from '@mui/material';
import { FilterList, Clear, Search, Work } from '@mui/icons-material';
import { FilterState } from '../types/customerMapping';

interface FilterPanelProps {
  filters: FilterState;
  jobs: Array<{ id: string; name: string }>;
  onFilterChange: (filters: FilterState) => void;
  onClearFilters: () => void;
}

export default function FilterPanel({
  filters,
  jobs,
  onFilterChange,
  onClearFilters,
}: FilterPanelProps) {
  const [localFilters, setLocalFilters] = useState<FilterState>(filters);
  const [debouncedFilters, setDebouncedFilters] = useState<FilterState>(filters);

  // Debounce customer ID and pocket ID inputs (500ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters(localFilters);
    }, 500);

    return () => clearTimeout(timer);
  }, [localFilters]);

  // Notify parent when debounced filters change
  useEffect(() => {
    onFilterChange(debouncedFilters);
  }, [debouncedFilters, onFilterChange]);

  const handleJobChange = (event: SelectChangeEvent) => {
    const newFilters = { ...localFilters, jobId: event.target.value };
    setLocalFilters(newFilters);
    setDebouncedFilters(newFilters); // Job filter applies immediately
  };

  const handleCustomerIdChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setLocalFilters({ ...localFilters, customerId: event.target.value });
  };

  const handlePocketIdChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setLocalFilters({ ...localFilters, pocketId: event.target.value });
  };

  const handleClear = () => {
    const emptyFilters = { jobId: '', customerId: '', pocketId: '' };
    setLocalFilters(emptyFilters);
    setDebouncedFilters(emptyFilters);
    onClearFilters();
  };

  const hasActiveFilters =
    localFilters.jobId || localFilters.customerId || localFilters.pocketId;

  const activeFilterCount = [
    localFilters.jobId,
    localFilters.customerId,
    localFilters.pocketId,
  ].filter(Boolean).length;

  return (
    <Paper sx={{ p: 3, mb: 3, boxShadow: 2, borderRadius: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <FilterList sx={{ color: 'primary.main' }} />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            Filters
          </Typography>
          {activeFilterCount > 0 && (
            <Chip 
              label={`${activeFilterCount} active`} 
              size="small" 
              color="primary"
              sx={{ ml: 1 }}
            />
          )}
        </Box>
        <Button
          variant="outlined"
          startIcon={<Clear />}
          onClick={handleClear}
          disabled={!hasActiveFilters}
          size="small"
          sx={{ minWidth: 120 }}
        >
          Clear All
        </Button>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
          gap: 2,
        }}
      >
        <FormControl fullWidth variant="outlined">
          <InputLabel id="job-filter-label">Batch Job</InputLabel>
          <Select
            labelId="job-filter-label"
            id="job-filter"
            value={localFilters.jobId}
            label="Batch Job"
            onChange={handleJobChange}
            startAdornment={
              <InputAdornment position="start">
                <Work fontSize="small" color="action" />
              </InputAdornment>
            }
          >
            <MenuItem value="">
              <em>All Jobs</em>
            </MenuItem>
            {jobs.map((job) => (
              <MenuItem key={job.id} value={job.id}>
                {job.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField
          fullWidth
          label="Customer ID"
          placeholder="Search by customer ID"
          value={localFilters.customerId}
          onChange={handleCustomerIdChange}
          variant="outlined"
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search fontSize="small" color="action" />
              </InputAdornment>
            ),
          }}
          helperText={localFilters.customerId ? 'Searching...' : 'Partial match supported'}
        />

        <TextField
          fullWidth
          label="Pocket ID"
          placeholder="Search by pocket ID"
          value={localFilters.pocketId}
          onChange={handlePocketIdChange}
          variant="outlined"
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search fontSize="small" color="action" />
              </InputAdornment>
            ),
          }}
          helperText={localFilters.pocketId ? 'Searching...' : 'Exact match'}
        />
      </Box>
    </Paper>
  );
}
