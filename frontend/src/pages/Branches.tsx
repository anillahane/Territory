import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  IconButton,
  Tooltip,
  Alert,
  CircularProgress,
  Chip,
  LinearProgress,
  FormControl,
  FormControlLabel,
  Radio,
  RadioGroup,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Upload as UploadIcon,
  Download as DownloadIcon,
  Refresh as RefreshIcon,
  Business,
} from '@mui/icons-material';
import { DataGrid, GridColDef, GridPaginationModel } from '@mui/x-data-grid';
import { useStore } from '../store/useStore';
import api from '../services/api';
import DataState from '../components/DataState';

interface Branch {
  id: string;
  city: string;
  lat: number;
  lon: number;
  pocket_id: string;
  created_at: string;
  updated_at: string;
}

const normalizeBranches = (branchesData: unknown): Branch[] =>
  Array.isArray(branchesData)
    ? branchesData.map((branch: any) => ({
        id: branch.id,
        city: branch.city,
        lat: branch.lat,
        lon: branch.lon,
        pocket_id: branch.pocket_id || branch.pocketId,
        created_at: branch.created_at || branch.createdAt,
        updated_at: branch.updated_at || branch.updatedAt,
      }))
    : [];

export default function Branches() {
  const { setError, setSuccess } = useStore();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [totalBranches, setTotalBranches] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [formData, setFormData] = useState({
    id: '',
    city: '',
    lat: '',
    lon: '',
  });
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadMode, setUploadMode] = useState<'overwrite' | 'add'>('overwrite');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({
    page: 0,
    pageSize: 25,
  });

  useEffect(() => {
    let isActive = true;

    const fetchBranches = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const data = await api.getBranches({
          limit: paginationModel.pageSize,
          offset: paginationModel.page * paginationModel.pageSize,
        });
        console.log('Branches API response:', data);
        const branchesData = data.branches || data.data || data;
        const normalizedBranches = normalizeBranches(branchesData);
        const total = Number(data.pagination?.total ?? normalizedBranches.length);

        if (!isActive) {
          return;
        }

        if (normalizedBranches.length === 0 && total > 0 && paginationModel.page > 0) {
          const lastPage = Math.max(0, Math.ceil(total / paginationModel.pageSize) - 1);
          if (lastPage !== paginationModel.page) {
            setPaginationModel((currentModel) => ({
              ...currentModel,
              page: lastPage,
            }));
            return;
          }
        }

        setBranches(normalizedBranches);
        setTotalBranches(total);
        setLoadError(null);
      } catch (error: any) {
        if (!isActive) {
          return;
        }

        console.error('Failed to load branches:', error);
        const errorMessage = error.message || 'Failed to load branches';
        setLoadError(errorMessage);
        setError(errorMessage);
        setBranches([]);
        setTotalBranches(0);
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    void fetchBranches();

    return () => {
      isActive = false;
    };
  }, [paginationModel.page, paginationModel.pageSize, reloadToken, setError]);

  const handleReloadBranches = () => {
    setReloadToken((currentToken) => currentToken + 1);
  };

  const showBranchLoadingState = loading && branches.length === 0;
  const showBranchErrorState = !loading && Boolean(loadError) && branches.length === 0;
  const showBranchEmptyState = !loading && !loadError && totalBranches === 0;

  const handleAdd = () => {
    setEditingBranch(null);
    setFormData({
      id: '',
      city: '',
      lat: '',
      lon: '',
    });
    setOpenDialog(true);
  };

  const handleEdit = (branch: Branch) => {
    setEditingBranch(branch);
    setFormData({
      id: branch.id,
      city: branch.city,
      lat: branch.lat.toString(),
      lon: branch.lon.toString(),
    });
    setOpenDialog(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this branch?')) {
      return;
    }

    try {
      await api.deleteBranch(id);
      setSuccess('Branch deleted successfully');
      setReloadToken((currentToken) => currentToken + 1);
    } catch (error: any) {
      setError(error.message || 'Failed to delete branch');
    }
  };

  const handleSave = async () => {
    // Validation
    if (!formData.id || !formData.city || !formData.lat || !formData.lon) {
      setError('Please fill in all required fields');
      return;
    }

    const lat = parseFloat(formData.lat);
    const lon = parseFloat(formData.lon);

    if (isNaN(lat) || isNaN(lon)) {
      setError('Invalid coordinates');
      return;
    }

    if (lat < -90 || lat > 90) {
      setError('Latitude must be between -90 and 90');
      return;
    }

    if (lon < -180 || lon > 180) {
      setError('Longitude must be between -180 and 180');
      return;
    }

    const branchData = {
      id: formData.id,
      city: formData.city,
      lat: lat,
      lon: lon,
    };

    try {
      if (editingBranch) {
        await api.updateBranch(editingBranch.id, branchData);
        setSuccess('Branch updated successfully');
      } else {
        await api.createBranch(branchData);
        setSuccess('Branch created successfully');
      }
      setOpenDialog(false);
      setReloadToken((currentToken) => currentToken + 1);
    } catch (error: any) {
      setError(error.message || 'Failed to save branch');
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
        setError('Please select an Excel file (.xlsx or .xls)');
        return;
      }
      // Create a copy of the file to avoid ERR_UPLOAD_FILE_CHANGED
      const blob = file.slice(0, file.size, file.type);
      const newFile = new File([blob], file.name, { type: file.type });
      setSelectedFile(newFile);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError('Please select a file');
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    
    try {
      console.log('Starting upload for file:', selectedFile.name);
      
      // Start upload - returns immediately with job ID
      const response = await api.uploadBranches(selectedFile, uploadMode);
      console.log('Upload response:', response);
      
      const jobId = response.jobId;
      
      if (!jobId) {
        throw new Error('No job ID returned from server');
      }
      
      setSuccess(`Upload started. Job ID: ${jobId}`);

      // Poll for job status
      let pollCount = 0;
      const maxPolls = 120; // 2 minutes max
      
      const pollInterval = setInterval(async () => {
        pollCount++;
        
        if (pollCount > maxPolls) {
          clearInterval(pollInterval);
          setUploading(false);
          setUploadProgress(0);
          setError('Upload timeout - please check job status manually');
          return;
        }
        
        try {
          console.log(`Polling job status (attempt ${pollCount})...`);
          const status = await api.getJobStatus(jobId);
          console.log('Job status:', status);
          
          // Update progress
          const progress = status.progress || 0;
          setUploadProgress(progress);

          if (status.status === 'completed') {
            clearInterval(pollInterval);
            setUploading(false);
            setUploadDialogOpen(false);
            setSelectedFile(null);
            setUploadProgress(0);
            
            // Reset file input
            const fileInput = document.getElementById('file-upload') as HTMLInputElement;
            if (fileInput) fileInput.value = '';
            
            const summary = status.result?.summary || {};
            const inserted = summary.inserted ?? 0;
            const replaced = summary.replaced ?? 0;
            const skippedExisting = summary.skippedExisting ?? 0;
            const errors = summary.errors ?? 0;
            const completedMode = summary.mode ?? uploadMode;

            if (completedMode === 'add') {
              setSuccess(
                `Upload complete: ${inserted} new branches added (${skippedExisting} existing branch IDs skipped).`
              );
            } else {
              setSuccess(
                `Upload complete: ${inserted} branches loaded (replaced ${replaced} existing branches).`
              );
            }
            if (errors > 0) {
              setError(`${errors} row(s) were skipped due validation errors.`);
            }
            if (paginationModel.page === 0) {
              setReloadToken((currentToken) => currentToken + 1);
            } else {
              setPaginationModel((currentModel) => ({
                ...currentModel,
                page: 0,
              }));
            }
          } else if (status.status === 'failed') {
            clearInterval(pollInterval);
            setUploading(false);
            setUploadProgress(0);
            setError(status.error || 'Upload failed');
          } else if (status.status === 'active' || status.status === 'pending') {
            console.log('Job is active, progress:', progress);
          } else {
            console.log('Job status:', status.status);
          }
        } catch (pollError: any) {
          console.error('Poll error:', pollError);
          clearInterval(pollInterval);
          setUploading(false);
          setUploadProgress(0);
          setError(`Failed to check upload status: ${pollError.message}`);
        }
      }, 1000); // Poll every second

    } catch (error: any) {
      console.error('Upload error:', error);
      setUploading(false);
      setUploadProgress(0);
      setError(error.message || 'Failed to start upload');
    }
  };

  const handleExport = async () => {
    try {
      const blob = await api.exportBranches();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `branches_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setSuccess('Branches exported successfully');
    } catch (error: any) {
      setError(error.message || 'Failed to export branches');
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const blob = await api.downloadBranchTemplate();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'branch_upload_template.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setSuccess('Template downloaded successfully');
    } catch (error: any) {
      setError(error.message || 'Failed to download template');
    }
  };

  const columns: GridColDef[] = [
    { field: 'id', headerName: 'Branch ID', width: 120 },
    { field: 'city', headerName: 'City/Name', width: 200, flex: 1 },
    {
      field: 'lat',
      headerName: 'Latitude',
      width: 120,
      valueFormatter: (value) => Number(value).toFixed(6),
    },
    {
      field: 'lon',
      headerName: 'Longitude',
      width: 120,
      valueFormatter: (value) => Number(value).toFixed(6),
    },
    {
      field: 'pocket_id',
      headerName: 'Pocket ID',
      width: 180,
      renderCell: (params) => (
        <Chip
          label={params.value}
          size="small"
          sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
        />
      ),
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 120,
      sortable: false,
      renderCell: (params) => (
        <Box>
          <Tooltip title="Edit">
            <IconButton
              size="small"
              onClick={() => handleEdit(params.row as Branch)}
              color="primary"
            >
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton
              size="small"
              onClick={() => handleDelete(params.row.id)}
              color="error"
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      ),
    },
  ];

  return (
    <Box sx={{ width: '100%', height: '100%', p: 3 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h4" gutterBottom>
            Branch Management
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage branch locations and their Pocket IDs
          </Typography>
        </Box>
        <Box display="flex" gap={1}>
          <Tooltip title="Refresh">
            <IconButton
              onClick={handleReloadBranches}
              disabled={loading}
            >
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={handleDownloadTemplate}
          >
            Download Template
          </Button>
          <Button
            variant="outlined"
            startIcon={<UploadIcon />}
            onClick={() => setUploadDialogOpen(true)}
          >
            Upload Excel
          </Button>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={handleExport}
            disabled={totalBranches === 0}
          >
            Export Excel
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleAdd}>
            Add Branch
          </Button>
        </Box>
      </Box>

      {showBranchEmptyState && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
            Getting Started with Branches
          </Typography>
          <Typography variant="body2">
            Branches represent your physical service locations (offices, stores, warehouses). 
            Each branch is automatically assigned a Pocket ID based on its geographic coordinates. 
            Start by adding branches manually or upload an Excel file with multiple branches.
          </Typography>
        </Alert>
      )}

      <Paper sx={{ height: 'calc(100vh - 250px)', width: '100%' }}>
        {showBranchLoadingState ? (
          <DataState
            variant="loading"
            title="Loading branches"
            description="Fetching branch locations and their Pocket IDs."
            minHeight="100%"
          />
        ) : showBranchErrorState ? (
          <DataState
            variant="error"
            title="Unable to load branches"
            description={loadError}
            minHeight="100%"
            action={
              <Button variant="outlined" startIcon={<RefreshIcon />} onClick={handleReloadBranches}>
                Try Again
              </Button>
            }
          />
        ) : showBranchEmptyState ? (
          <DataState
            variant="empty"
            title="No Branches Found"
            description="Get started by adding your first branch manually or upload multiple branches from an Excel file."
            icon={<Business sx={{ fontSize: 40 }} />}
            minHeight="100%"
            action={
              <>
                <Button
                  variant="outlined"
                  startIcon={<DownloadIcon />}
                  onClick={handleDownloadTemplate}
                >
                  Download Template
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<UploadIcon />}
                  onClick={() => setUploadDialogOpen(true)}
                >
                  Upload Excel
                </Button>
                <Button variant="contained" startIcon={<AddIcon />} onClick={handleAdd}>
                  Add First Branch
                </Button>
              </>
            }
          />
        ) : (
          <DataGrid
            rows={branches}
            columns={columns}
            loading={loading}
            pagination
            paginationMode="server"
            paginationModel={paginationModel}
            onPaginationModelChange={(model) => setPaginationModel(model)}
            pageSizeOptions={[10, 25, 50, 100]}
            rowCount={totalBranches}
            disableRowSelectionOnClick
            sx={{
              '& .MuiDataGrid-cell:focus': {
                outline: 'none',
              },
            }}
          />
        )}
      </Paper>

      {/* Add/Edit Dialog */}
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingBranch ? 'Edit Branch' : 'Add New Branch'}</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Branch ID"
              value={formData.id}
              onChange={(e) => setFormData({ ...formData, id: e.target.value })}
              required
              fullWidth
              disabled={!!editingBranch}
              helperText="Unique identifier for the branch (e.g., BR001)"
            />
            <TextField
              label="City/Branch Name"
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              required
              fullWidth
            />
            <TextField
              label="Latitude"
              type="number"
              value={formData.lat}
              onChange={(e) => setFormData({ ...formData, lat: e.target.value })}
              required
              fullWidth
              inputProps={{ step: 0.000001, min: -90, max: 90 }}
            />
            <TextField
              label="Longitude"
              type="number"
              value={formData.lon}
              onChange={(e) => setFormData({ ...formData, lon: e.target.value })}
              required
              fullWidth
              inputProps={{ step: 0.000001, min: -180, max: 180 }}
            />
            <Alert severity="info">
              Pocket ID will be automatically calculated based on the coordinates
            </Alert>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDialog(false)}>Cancel</Button>
          <Button onClick={handleSave} variant="contained">
            {editingBranch ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Upload Dialog */}
      <Dialog
        open={uploadDialogOpen}
        onClose={() => !uploading && setUploadDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Upload Branches from Excel</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Alert severity="info" sx={{ mb: 2 }}>
              Excel file should contain columns: <strong>ID</strong>, <strong>City</strong>, <strong>Latitude</strong>, <strong>Longitude</strong>
              <br />
              (Column names are case-insensitive)
            </Alert>

            {!uploading && (
              <FormControl sx={{ mb: 2 }}>
                <Typography variant="body2" sx={{ mb: 0.5, fontWeight: 600 }}>
                  Upload Mode
                </Typography>
                <RadioGroup
                  value={uploadMode}
                  onChange={(event) => setUploadMode(event.target.value as 'overwrite' | 'add')}
                >
                  <FormControlLabel
                    value="overwrite"
                    control={<Radio />}
                    label="Overwrite existing branches"
                  />
                  <FormControlLabel
                    value="add"
                    control={<Radio />}
                    label="Add new branches only (skip existing Branch IDs)"
                  />
                </RadioGroup>
              </FormControl>
            )}
            
            {!uploading && (
              <>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                  id="file-upload"
                />
                <label htmlFor="file-upload">
                  <Button variant="outlined" component="span" fullWidth>
                    Select Excel File
                  </Button>
                </label>
                {selectedFile && (
                  <Typography variant="body2" sx={{ mt: 2 }}>
                    Selected: {selectedFile.name}
                  </Typography>
                )}
              </>
            )}

            {uploading && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" gutterBottom>
                  Processing upload... {uploadProgress}%
                </Typography>
                <LinearProgress variant="determinate" value={uploadProgress} />
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  {uploadProgress < 10 && 'Parsing Excel file...'}
                  {uploadProgress >= 10 && uploadProgress < 80 && 'Validating data...'}
                  {uploadProgress >= 80 && uploadProgress < 100 && 'Inserting branches...'}
                  {uploadProgress === 100 && 'Finalizing...'}
                </Typography>
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUploadDialogOpen(false)} disabled={uploading}>
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            variant="contained"
            disabled={!selectedFile || uploading}
            startIcon={uploading ? <CircularProgress size={20} /> : <UploadIcon />}
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
