import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  IconButton,
  Tooltip,
  Card,
  CardContent,
  Grid,
  type ChipProps,
} from '@mui/material';
import {
  Upload as UploadIcon,
  Download as DownloadIcon,
  Refresh as RefreshIcon,
  History as HistoryIcon,
  Replay as ReplayIcon,
  Delete as DeleteIcon,
  BarChart as BarChartIcon,
  Map as MapIcon,
} from '@mui/icons-material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useStore } from '../store/useStore';
import api, { queryKeys, type JobRecord, type JobsStreamPayload } from '../services/api';
import DataState from '../components/DataState';
import { formatIndiaDateTime } from '../utils/datetime';
import { getErrorMessage, getErrorSummary } from '../utils/errors';
import logger from '../utils/logger';

const filterBatchJobs = (jobs: JobRecord[]) =>
  jobs.filter((job) => job.type === 'batch-process' || job.type === 'batch-processing');

export default function BatchProcessing() {
  const { setError, setSuccess } = useStore();
  const queryClient = useQueryClient();
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [showHistory, setShowHistory] = useState(true);
  const [selectedJobStats, setSelectedJobStats] = useState<JobRecord | null>(null);
  const [statsDialogOpen, setStatsDialogOpen] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null); // Track currently processing job
  const [liveUpdateMode, setLiveUpdateMode] = useState<'stream' | 'polling' | 'manual'>('manual');
  const streamCleanupRef = useRef<(() => void) | null>(null);
  const pollingIntervalRef = useRef<number | null>(null);

  const jobsQueryKey = queryKeys.jobs({
    limit: 20,
    type: 'batch-process',
  });

  const jobsQuery = useQuery({
    queryKey: jobsQueryKey,
    queryFn: async () => {
      const response = await api.listJobs({
        limit: 20,
        type: 'batch-process',
      });
      const batchJobs = filterBatchJobs(response.jobs);
      return {
        jobs: batchJobs,
        total: batchJobs.length,
      };
    },
    placeholderData: (previousData) => previousData,
  });

  const jobs = jobsQuery.data?.jobs ?? [];
  const loadingJobs = jobsQuery.isLoading;
  const jobHistoryError = jobsQuery.error ? 'Failed to load job history.' : null;

  const loadJobHistory = useCallback(async () => {
    await jobsQuery.refetch();
  }, [jobsQuery.refetch]);

  const setJobHistoryCache = useCallback((payload: Pick<JobsStreamPayload, 'jobs'>) => {
    const batchJobs = filterBatchJobs(payload.jobs);
    queryClient.setQueryData(jobsQueryKey, {
      jobs: batchJobs,
      total: batchJobs.length,
    });
  }, [jobsQueryKey, queryClient]);

  const showInitialJobsState = loadingJobs && jobs.length === 0 && !jobHistoryError;

  useEffect(() => {
    return () => {
      if (streamCleanupRef.current) {
        streamCleanupRef.current();
        streamCleanupRef.current = null;
      }

      if (pollingIntervalRef.current !== null) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    const stopFallbackPolling = () => {
      if (pollingIntervalRef.current !== null) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };

    const stopJobsStream = () => {
      if (streamCleanupRef.current) {
        streamCleanupRef.current();
        streamCleanupRef.current = null;
      }
    };

    const startFallbackPolling = async () => {
      stopFallbackPolling();
      setLiveUpdateMode('polling');
      await loadJobHistory();

      if (!activeJobId || disposed) {
        return;
      }

      pollingIntervalRef.current = window.setInterval(() => {
        void loadJobHistory();
      }, 2000);
    };

    const startJobsStream = async () => {
      stopJobsStream();
      stopFallbackPolling();

      try {
        const cleanup = await api.subscribeToJobsStream({
          type: 'batch-process',
          limit: 20,
          onOpen: () => {
            if (!disposed) {
              setLiveUpdateMode('stream');
            }
          },
          onJobs: (payload) => {
            if (disposed) {
              return;
            }

            setJobHistoryCache(payload);
          },
          onError: (error) => {
            if (disposed) {
              return;
            }

            logger.error('Job stream error', error);
            stopJobsStream();

            if (activeJobId) {
              void startFallbackPolling();
              return;
            }

            setLiveUpdateMode('manual');
          },
        });

        if (!cleanup) {
          if (activeJobId) {
            await startFallbackPolling();
          } else {
            setLiveUpdateMode('manual');
          }
          return;
        }

        if (disposed) {
          cleanup();
          return;
        }

        streamCleanupRef.current = cleanup;
      } catch (error) {
        if (disposed) {
          return;
        }

        logger.error('Failed to start job stream', error);
        if (activeJobId) {
          await startFallbackPolling();
        } else {
          setLiveUpdateMode('manual');
        }
      }
    };

    void startJobsStream();

    return () => {
      disposed = true;
      stopJobsStream();
      stopFallbackPolling();
    };
  }, [activeJobId, loadJobHistory, setJobHistoryCache]);

  useEffect(() => {
    if (activeJobId && jobs.length > 0) {
      const activeJob = jobs.find(j => j.jobId === activeJobId);
      if (activeJob && (activeJob.status === 'completed' || activeJob.status === 'failed')) {
        logger.info('Batch job finished', { jobId: activeJob.jobId, status: activeJob.status });
        setActiveJobId(null);

        if (activeJob.status === 'completed') {
          setSuccess(`Processing complete! ${activeJob.data?.totalAccounts || 0} customers assigned to ${activeJob.data?.totalPockets || 0} pockets.`);
        } else {
          setError(activeJob.error || 'Job failed. Please check the error details in job history.');
        }
      }
    }
  }, [jobs, activeJobId, setError, setSuccess]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
        setError('Please select an Excel file (.xlsx or .xls)');
        event.target.value = ''; // Reset input
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError('Please select a file');
      return;
    }
    const shouldReplaceExisting = replaceExisting;

    logger.info('Starting batch upload', { fileName: selectedFile.name });
    setUploading(true);

    // Store file reference before clearing
    const fileToUpload = selectedFile;

    try {
      // Upload file - backend parses and queues immediately
      const response = await api.batchEncode(fileToUpload, shouldReplaceExisting);

      // Backend always returns jobId immediately (non-blocking)
      if (response.jobId) {
        logger.info('Batch upload accepted', { jobId: response.jobId, fileName: response.fileName });
        // Close dialog and reset state immediately
        setUploading(false);
        setUploadDialogOpen(false);
        setSelectedFile(null);
        setReplaceExisting(false);
        
        // Reset file input
        const fileInput = document.getElementById('batch-file-upload') as HTMLInputElement;
        if (fileInput) fileInput.value = '';
        
        // Show success message
        const totalText = typeof response.total === 'number' ? `${response.total} records` : 'file';
        const replaceText = shouldReplaceExisting ? ' Existing customer mappings will be replaced.' : '';
        setSuccess(`File "${response.fileName || fileToUpload.name}" uploaded! Processing ${totalText} in background.${replaceText}`);
        
        // Show history and track the active job for live updates
        setShowHistory(true);
        setActiveJobId(response.jobId);
        void loadJobHistory();
      } else {
        // Unexpected response format
        logger.error('Unexpected batch upload response', response);
        setUploading(false);
        throw new Error('Unexpected response format from server');
      }
    } catch (error) {
      setUploading(false);
      logger.error('Batch upload failed', getErrorSummary(error));
      setError(getErrorMessage(error, 'Failed to upload file'));
    }
  };

  const handleDownloadJob = async (jobId: string) => {
    try {
      const blob = await api.downloadBatchResult(jobId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pocket_ids_${jobId}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setSuccess('Results downloaded successfully');
    } catch (error) {
      setError(getErrorMessage(error, 'Failed to download results'));
    }
  };

  const handleDownloadTerritories = async (jobId: string) => {
    try {
      const payload = await api.getBatchTerritories(jobId);
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json'
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `territories_${jobId}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setSuccess('Territory polygons downloaded successfully');
    } catch (error) {
      setError(getErrorMessage(error, 'Failed to download territory polygons'));
    }
  };

  const handleRetryJob = async (jobId: string) => {
    try {
      await api.retryJob(jobId);
      setSuccess('Job queued for retry');
      setActiveJobId(jobId);
      void loadJobHistory();
    } catch (error) {
      setError(getErrorMessage(error, 'Failed to retry job'));
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const blob = await api.downloadBatchTemplate();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'batch_processing_template.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setSuccess('Template downloaded successfully');
    } catch (error) {
      setError(getErrorMessage(error, 'Failed to download template'));
    }
  };

  const handleViewStats = (job: JobRecord) => {
    setSelectedJobStats(job);
    setStatsDialogOpen(true);
  };

  const handleDeleteJob = async (jobId: string) => {
    if (!window.confirm('Are you sure you want to delete this job?')) {
      return;
    }

    try {
      await api.deleteJob(jobId);
      setSuccess('Job deleted successfully');
      if (activeJobId === jobId) {
        setActiveJobId(null);
      }
      void loadJobHistory();
    } catch (error) {
      setError(getErrorMessage(error, 'Failed to delete job'));
    }
  };

  const handleBulkDelete = async (status: string) => {
    const statusLabel = status === 'completed' ? 'completed' : 'failed';
    const count = jobs.filter(j => j.status === status).length;
    
    if (count === 0) {
      setError(`No ${statusLabel} jobs to delete`);
      return;
    }

    if (!window.confirm(`Are you sure you want to delete all ${count} ${statusLabel} job(s)?`)) {
      return;
    }

    try {
      const result = await api.bulkDeleteJobs({ status });
      setSuccess(result.message || `${count} job(s) deleted successfully`);
      void loadJobHistory();
    } catch (error) {
      setError(getErrorMessage(error, 'Failed to delete jobs'));
    }
  };

  const getStatusColor = (status: string): ChipProps['color'] => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'failed':
        return 'error';
      case 'active':
        return 'info';
      case 'pending':
        return 'warning';
      default:
        return 'default';
    }
  };

  return (
    <Box sx={{ width: '100%', height: '100%', p: 3 }}>
      {showInitialJobsState && (
        <DataState
          variant="loading"
          title="Loading batch processing module"
          description="Fetching recent jobs and reconnecting live updates."
          minHeight={200}
        />
      )}
      
      {!showInitialJobsState ? (
        <>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
            <Box>
              <Typography variant="h4" gutterBottom>
                Batch Processing
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Upload Excel files for bulk Pocket ID generation
              </Typography>
            </Box>
            <Box display="flex" gap={1}>
              <Tooltip title="Refresh History">
                <IconButton
                  aria-label="Refresh job history"
                  onClick={() => void loadJobHistory()}
                  disabled={jobsQuery.isFetching}
                >
                  <RefreshIcon />
                </IconButton>
              </Tooltip>
              <Chip
                label={
                  liveUpdateMode === 'stream'
                    ? 'Live updates'
                    : liveUpdateMode === 'polling'
                      ? 'Polling fallback'
                      : 'Manual refresh'
                }
                color={liveUpdateMode === 'stream' ? 'success' : 'default'}
                size="small"
                variant="outlined"
              />
              {jobs.length > 0 && (
                <>
                  <Button
                    variant="outlined"
                    color="error"
                    size="small"
                    onClick={() => handleBulkDelete('completed')}
                  >
                    Clear Completed
                  </Button>
                  <Button
                    variant="outlined"
                    color="error"
                    size="small"
                    onClick={() => handleBulkDelete('failed')}
                  >
                    Clear Failed
                  </Button>
                </>
              )}
              <Button
                variant="outlined"
                startIcon={<DownloadIcon />}
                onClick={handleDownloadTemplate}
              >
                Download Template
              </Button>
              <Button
                variant="outlined"
                startIcon={<HistoryIcon />}
                onClick={() => {
                  if (!showHistory) {
                    void loadJobHistory(); // Load jobs when showing history
                  }
                  setShowHistory(!showHistory);
                }}
              >
                {showHistory ? 'Hide' : 'Show'} History
              </Button>
              <Button
                variant="contained"
                startIcon={<UploadIcon />}
                onClick={() => {
                  setReplaceExisting(false);
                  setUploadDialogOpen(true);
                }}
              >
                Upload File
              </Button>
            </Box>
          </Box>

      {/* Instructions Card */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            How to Use
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} md={4}>
              <Typography variant="subtitle2" color="primary">
                1. Prepare Excel File
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Include columns: <strong>lan</strong>, <strong>canon_lat</strong>, <strong>canon_long</strong>, <strong>branch_code</strong>
              </Typography>
            </Grid>
            <Grid item xs={12} md={4}>
              <Typography variant="subtitle2" color="primary">
                2. Upload & Process
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Upload your file and watch the progress bar
              </Typography>
            </Grid>
            <Grid item xs={12} md={4}>
              <Typography variant="subtitle2" color="primary">
                3. Download Results
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Get Excel file with Pocket IDs and download Voronoi territories
              </Typography>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Active Job Status Card */}
      {activeJobId && jobs.length > 0 && (() => {
        const activeJob = jobs.find(j => j.jobId === activeJobId);
        if (activeJob && (activeJob.status === 'active' || activeJob.status === 'pending')) {
          return (
            <Card sx={{ mb: 3, borderLeft: '4px solid #1976d2' }}>
              <CardContent>
                <Box display="flex" alignItems="center" gap={2}>
                  <CircularProgress size={40} />
                  <Box flex={1}>
                    <Typography variant="h6" gutterBottom>
                      Processing: {activeJob.data?.fileName || 'File'}
                    </Typography>
                    <Box display="flex" alignItems="center" gap={2} mb={1}>
                      <LinearProgress
                        variant="determinate"
                        value={activeJob.progress}
                        sx={{ flex: 1, height: 8, borderRadius: 4 }}
                      />
                      <Typography variant="body2" fontWeight={600}>
                        {activeJob.progress}%
                      </Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      {activeJob.status === 'pending' ? 'Queued to start...' : `Processing ${activeJob.data?.totalAccounts || 0} records...`}
                    </Typography>
                  </Box>
                  <Chip
                    label={activeJob.status}
                    color="info"
                    size="small"
                  />
                </Box>
              </CardContent>
            </Card>
          );
        }
        return null;
      })()}

      {/* Job History */}
      {showHistory && (
        <Paper sx={{ mb: 3 }}>
          <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="h6">Job History</Typography>
          </Box>
          {jobHistoryError ? (
            <DataState
              variant="error"
              title="Unable to load job history"
              description={jobHistoryError}
              minHeight={240}
          action={
                <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => void loadJobHistory()}>
                  Try Again
                </Button>
              }
            />
          ) : loadingJobs && jobs.length === 0 ? (
            <DataState
              variant="loading"
              title="Loading job history"
              description="Fetching recent batch processing runs."
              minHeight={240}
            />
          ) : jobs.length === 0 ? (
            <DataState
              variant="empty"
              title="No job history available"
              description="Job history will appear here after you process files."
              minHeight={240}
            />
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>File Name</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Progress</TableCell>
                    <TableCell>Records</TableCell>
                    <TableCell>Created</TableCell>
                    <TableCell>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {jobs.map((job) => {
                    const isActiveJob = job.jobId === activeJobId;
                    return (
                    <TableRow
                      key={job.jobId}
                      sx={{
                        backgroundColor: isActiveJob ? 'rgba(25, 118, 210, 0.08)' : 'transparent',
                        '&:hover': {
                          backgroundColor: isActiveJob ? 'rgba(25, 118, 210, 0.12)' : 'rgba(0, 0, 0, 0.04)',
                        },
                      }}
                    >
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {job.data?.fileName || 'Unknown'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
                          {job.jobId.substring(0, 8)}...
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={job.status}
                          size="small"
                          color={getStatusColor(job.status)}
                        />
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <LinearProgress
                            variant="determinate"
                            value={job.progress}
                            sx={{ width: 100 }}
                          />
                          <Typography variant="caption">{job.progress}%</Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        {job.data?.totalAccounts !== undefined ? (
                          <Box>
                            <Typography variant="body2">{job.data.totalAccounts} accounts</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {job.data.totalPockets} pockets
                            </Typography>
                          </Box>
                        ) : (
                          <Typography variant="body2" color="text.secondary">—</Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {formatIndiaDateTime(job.createdAt)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Box display="flex" gap={1}>
                          {job.status === 'completed' && job.data?.pocketStats && (
                            <Tooltip title="View Statistics">
                              <IconButton
                                aria-label={`View statistics for ${job.data?.fileName || job.jobId}`}
                                size="small"
                                onClick={() => handleViewStats(job)}
                                color="info"
                              >
                                <BarChartIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                          {job.status === 'completed' && (
                            <>
                              <Tooltip title="View Mappings">
                              <IconButton
                                aria-label={`View mappings for ${job.data?.fileName || job.jobId}`}
                                size="small"
                                onClick={() => window.location.href = '/mappings'}
                                color="secondary"
                              >
                                  <HistoryIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Download Results">
                                <IconButton
                                  aria-label={`Download results for ${job.data?.fileName || job.jobId}`}
                                  size="small"
                                  onClick={() => handleDownloadJob(job.jobId)}
                                  color="primary"
                                >
                                  <DownloadIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Download Territories (Voronoi)">
                                <IconButton
                                  aria-label={`Download territories for ${job.data?.fileName || job.jobId}`}
                                  size="small"
                                  onClick={() => handleDownloadTerritories(job.jobId)}
                                  color="success"
                                >
                                  <MapIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </>
                          )}
                          {job.status === 'failed' && (
                            <Tooltip title="Retry">
                              <IconButton
                                aria-label={`Retry ${job.data?.fileName || job.jobId}`}
                                size="small"
                                onClick={() => handleRetryJob(job.jobId)}
                                color="warning"
                              >
                                <ReplayIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                          <Tooltip title="Delete">
                            <IconButton
                              aria-label={`Delete ${job.data?.fileName || job.jobId}`}
                              size="small"
                              onClick={() => handleDeleteJob(job.jobId)}
                              color="error"
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </TableCell>
                    </TableRow>
                  );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      )}

      {/* Upload Dialog */}
      <Dialog
        aria-describedby="batch-upload-dialog-description"
        aria-labelledby="batch-upload-dialog-title"
        open={uploadDialogOpen}
        onClose={() => {
          if (uploading) {
            return;
          }
          setReplaceExisting(false);
          setUploadDialogOpen(false);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle id="batch-upload-dialog-title">Upload File for Batch Processing</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Alert id="batch-upload-dialog-description" severity="info" sx={{ mb: 2 }}>
              Excel file should contain columns: <strong>lan</strong> (Customer ID), <strong>canon_lat</strong> (Latitude), <strong>canon_long</strong> (Longitude), <strong>branch_code</strong>
              <br />
              (Column names are case-insensitive. Also accepts: Latitude/latitude/Lat/lat and Longitude/longitude/Lon/lon)
              <br />
              <strong>branch_code</strong> should match an existing branch ID when provided.
              <br />
              <br />
              <strong>Note:</strong> File will be uploaded and processed in the background. You can continue working while processing completes.
            </Alert>

            {!uploading && (
              <>
                <Button
                  variant="outlined"
                  component="label"
                  fullWidth
                  autoFocus
                >
                  Select Excel File
                  <input
                    hidden
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleFileSelect}
                    id="batch-file-upload"
                  />
                </Button>
                {selectedFile && (
                  <Typography variant="body2" sx={{ mt: 2 }}>
                    Selected: {selectedFile.name}
                  </Typography>
                )}
                <FormControlLabel
                  sx={{ mt: 1 }}
                  control={
                    <Checkbox
                      checked={replaceExisting}
                      onChange={(event) => setReplaceExisting(event.target.checked)}
                    />
                  }
                  label="Replace existing customer data"
                />
                {replaceExisting && (
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    Existing rows in Customer Pocket Mappings will be deleted before saving this upload.
                  </Alert>
                )}
              </>
            )}

            {uploading && (
              <Box
                role="status"
                aria-live="polite"
                sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 2 }}
              >
                <CircularProgress size={24} />
                <Typography variant="body2">
                  Uploading and parsing file...
                </Typography>
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setReplaceExisting(false);
              setUploadDialogOpen(false);
            }}
            disabled={uploading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            variant="contained"
            disabled={!selectedFile || uploading}
            startIcon={uploading ? <CircularProgress size={20} /> : <UploadIcon />}
          >
            {uploading ? 'Uploading...' : 'Upload & Process'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Statistics Dialog */}
      <Dialog
        aria-describedby="batch-stats-dialog-description"
        aria-labelledby="batch-stats-dialog-title"
        open={statsDialogOpen}
        onClose={() => setStatsDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle id="batch-stats-dialog-title">
          Pocket Statistics
          {selectedJobStats?.data?.fileName && (
            <Typography variant="caption" display="block" color="text.secondary">
              File: {selectedJobStats.data.fileName}
            </Typography>
          )}
        </DialogTitle>
        <DialogContent>
          <Typography id="batch-stats-dialog-description" variant="body2" color="text.secondary" sx={{ pt: 2 }}>
            Review the processed account totals and per-pocket distribution for the selected batch job.
          </Typography>
          {selectedJobStats?.data?.pocketStats && (
            <Box sx={{ pt: 2 }}>
              <Grid container spacing={2} sx={{ mb: 3 }}>
                <Grid item xs={6}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="h4" color="primary">
                        {selectedJobStats.data.totalAccounts || 0}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Total Accounts
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={6}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="h4" color="secondary">
                        {selectedJobStats.data.totalPockets || 0}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Unique Pockets
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>

              <Typography variant="h6" gutterBottom>
                Accounts per Pocket
              </Typography>
              <TableContainer sx={{ maxHeight: 400 }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Pocket ID</TableCell>
                      <TableCell align="right">Account Count</TableCell>
                      <TableCell align="right">Percentage</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {Object.entries(selectedJobStats.data.pocketStats)
                      .sort(([, a], [, b]) => (b as number) - (a as number))
                      .map(([pocketId, count]) => {
                        const percentage = ((count as number) / (selectedJobStats.data?.totalAccounts || 1) * 100).toFixed(1);
                        return (
                          <TableRow key={pocketId}>
                            <TableCell>
                              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 500 }}>
                                {pocketId}
                              </Typography>
                            </TableCell>
                            <TableCell align="right">
                              <Typography variant="body2">{count as number}</Typography>
                            </TableCell>
                            <TableCell align="right">
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1 }}>
                                <LinearProgress
                                  variant="determinate"
                                  value={parseFloat(percentage)}
                                  sx={{ width: 60 }}
                                />
                                <Typography variant="caption">{percentage}%</Typography>
                              </Box>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button autoFocus onClick={() => setStatsDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
        </>
      ) : null}
    </Box>
  );
}
