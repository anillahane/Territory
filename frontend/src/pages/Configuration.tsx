import { useState, useEffect } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  FormGroup,
  Grid,
  Paper,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import {
  Save as SaveIcon,
  History as HistoryIcon,
  DeleteSweep as DeleteSweepIcon,
  HealthAndSafety as HealthAndSafetyIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import api from '../services/api';

type GridLevelId = '500km' | '100km' | '20km' | '5km' | '1km';

type GridLevelColorMap = Record<GridLevelId, string>;

type Config = {
  originLat: number;
  originLon: number;
  alphabet: string;
  gridLevels: number[];
  gridLevelColors: GridLevelColorMap;
};

type ConfigHistory = {
  id: number;
  originLat?: number;
  originLon?: number;
  alphabet?: string;
  origin_lat?: number;
  origin_lon?: number;
  changedAt?: string;
  changed_at?: string;
  version?: number;
  gridLevels?: unknown;
  gridLevelColors?: unknown;
};

const GRID_LEVEL_ROWS: Array<{ id: GridLevelId; label: string; meters: number }> = [
  { id: '500km', label: '500 km', meters: 500000 },
  { id: '100km', label: '100 km', meters: 100000 },
  { id: '20km', label: '20 km', meters: 20000 },
  { id: '5km', label: '5 km', meters: 5000 },
  { id: '1km', label: '1 km', meters: 1000 }
];

const DEFAULT_GRID_LEVELS = GRID_LEVEL_ROWS.map((item) => item.meters);

const DEFAULT_GRID_LEVEL_COLORS: GridLevelColorMap = {
  '500km': '#93C5FD',
  '100km': '#60A5FA',
  '20km': '#38BDF8',
  '5km': '#22D3EE',
  '1km': '#06B6D4'
};

const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

const normalizeHexColor = (value: unknown, fallback: string): string => {
  const normalized = String(value || '').trim();
  if (!HEX_COLOR_REGEX.test(normalized)) {
    return fallback;
  }
  return normalized.toUpperCase();
};

const normalizeGridLevelColors = (rawColors: unknown): GridLevelColorMap => {
  const nextColors: GridLevelColorMap = { ...DEFAULT_GRID_LEVEL_COLORS };
  if (!rawColors || typeof rawColors !== 'object' || Array.isArray(rawColors)) {
    return nextColors;
  }

  GRID_LEVEL_ROWS.forEach((row) => {
    nextColors[row.id] = normalizeHexColor(
      (rawColors as Record<string, unknown>)[row.id],
      DEFAULT_GRID_LEVEL_COLORS[row.id]
    );
  });

  return nextColors;
};

const normalizeGridLevels = (rawLevels: unknown): number[] => {
  if (!Array.isArray(rawLevels)) {
    return [...DEFAULT_GRID_LEVELS];
  }

  const parsed = rawLevels
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (parsed.length !== DEFAULT_GRID_LEVELS.length) {
    return [...DEFAULT_GRID_LEVELS];
  }

  return parsed;
};

export default function Configuration() {
  const navigate = useNavigate();
  const { setError, setSuccess } = useStore();
  const [config, setConfig] = useState<Config>({
    originLat: 8.0,
    originLon: 68.0,
    alphabet: '0123456789ABCDEFGHJKLMNPQRSTUV',
    gridLevels: [...DEFAULT_GRID_LEVELS],
    gridLevelColors: { ...DEFAULT_GRID_LEVEL_COLORS }
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<ConfigHistory[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [clearOptions, setClearOptions] = useState({
    clearCustomerData: false,
    clearBranchData: false,
    clearPocketData: false
  });
  const [clearingData, setClearingData] = useState(false);

  useEffect(() => {
    void loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const data = await api.getConfig();
      const configData = data.config || data;

      setConfig({
        originLat: Number(configData.originLat),
        originLon: Number(configData.originLon),
        alphabet: String(configData.alphabet || ''),
        gridLevels: normalizeGridLevels(configData.gridLevels),
        gridLevelColors: normalizeGridLevelColors(configData.gridLevelColors)
      });
    } catch (error: any) {
      console.error('Failed to load configuration:', error);
      setError(error.message || 'Failed to load configuration');
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      const data = await api.getConfigHistory();
      const historyData = data.history || data;
      setHistory(Array.isArray(historyData) ? historyData : []);
      setShowHistory(true);
    } catch (error: any) {
      console.error('Failed to load configuration history:', error);
      setError(error.message || 'Failed to load configuration history');
    }
  };

  const validateConfig = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (config.originLat < -90 || config.originLat > 90) {
      newErrors.originLat = 'Latitude must be between -90 and 90';
    }

    if (config.originLon < -180 || config.originLon > 180) {
      newErrors.originLon = 'Longitude must be between -180 and 180';
    }

    if (config.alphabet.length !== 30) {
      newErrors.alphabet = 'Alphabet must contain exactly 30 characters';
    }

    const uniqueChars = new Set(config.alphabet);
    if (uniqueChars.size !== 30) {
      newErrors.alphabet = 'Alphabet must contain 30 unique characters';
    }

    if (config.alphabet.includes('-')) {
      newErrors.alphabet = 'Alphabet cannot contain hyphen (-)';
    }

    GRID_LEVEL_ROWS.forEach((row) => {
      const color = config.gridLevelColors[row.id];
      if (!HEX_COLOR_REGEX.test(String(color || ''))) {
        newErrors[`gridLevelColors.${row.id}`] = `${row.label} color must be a valid hex color`;
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateConfig()) {
      return;
    }

    setSaving(true);
    try {
      const response = await api.updateConfig(config);
      const updatedConfig = response.config || response;

      setConfig({
        originLat: Number(updatedConfig.originLat),
        originLon: Number(updatedConfig.originLon),
        alphabet: String(updatedConfig.alphabet || ''),
        gridLevels: normalizeGridLevels(updatedConfig.gridLevels),
        gridLevelColors: normalizeGridLevelColors(updatedConfig.gridLevelColors)
      });
      setSuccess('Configuration updated successfully');
      setErrors({});
    } catch (error: any) {
      console.error('Failed to update configuration:', error);
      setError(error.message || 'Failed to update configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (field: 'originLat' | 'originLon' | 'alphabet') => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const value = field === 'alphabet' ? event.target.value : Number(event.target.value);
    setConfig((previousConfig) => ({
      ...previousConfig,
      [field]: value
    }));

    if (errors[field]) {
      setErrors((previousErrors) => ({
        ...previousErrors,
        [field]: ''
      }));
    }
  };

  const handleGridLevelColorChange = (gridLevelId: GridLevelId) => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const nextColor = normalizeHexColor(event.target.value, DEFAULT_GRID_LEVEL_COLORS[gridLevelId]);
    setConfig((previousConfig) => ({
      ...previousConfig,
      gridLevelColors: {
        ...previousConfig.gridLevelColors,
        [gridLevelId]: nextColor
      }
    }));

    const errorKey = `gridLevelColors.${gridLevelId}`;
    if (errors[errorKey]) {
      setErrors((previousErrors) => ({
        ...previousErrors,
        [errorKey]: ''
      }));
    }
  };

  const handleClearOptionChange = (field: 'clearCustomerData' | 'clearBranchData' | 'clearPocketData') => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setClearOptions((previousState) => ({
      ...previousState,
      [field]: event.target.checked
    }));
  };

  const handleClearSelectedData = async () => {
    const hasSelection =
      clearOptions.clearCustomerData
      || clearOptions.clearBranchData
      || clearOptions.clearPocketData;
    if (!hasSelection) {
      setError('Select at least one data domain to clear.');
      return;
    }

    const selectedLabels = [
      clearOptions.clearCustomerData ? 'Customer Data' : null,
      clearOptions.clearBranchData ? 'Branch Data' : null,
      clearOptions.clearPocketData ? 'Pocket Data' : null
    ].filter(Boolean);

    const confirmationMessage = [
      'This action will permanently clear selected data.',
      `Selected: ${selectedLabels.join(', ')}`,
      'Do you want to continue?'
    ].join('\n');

    if (!window.confirm(confirmationMessage)) {
      return;
    }

    setClearingData(true);
    try {
      const response = await api.clearSystemData(clearOptions);
      const deletedRows = response?.deletedRows && typeof response.deletedRows === 'object'
        ? response.deletedRows
        : {};
      const deletedSummary = Object.entries(deletedRows)
        .map(([tableName, count]) => `${tableName}: ${count}`)
        .join(', ');

      setSuccess(
        deletedSummary
          ? `Selected data cleared successfully. ${deletedSummary}`
          : 'Selected data cleared successfully.'
      );
      setClearOptions({
        clearCustomerData: false,
        clearBranchData: false,
        clearPocketData: false
      });
    } catch (error: any) {
      console.error('Failed to clear selected data:', error);
      setError(error.message || 'Failed to clear selected data');
    } finally {
      setClearingData(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ width: '100%', height: '100%', p: 3 }}>
        <Typography variant="h4" gutterBottom>
          System Configuration
        </Typography>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
          <CircularProgress />
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', height: '100%', p: 3, overflow: 'auto', bgcolor: '#FEF2F2' }}>
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography variant="h4" gutterBottom sx={{ fontWeight: 700, color: '#991B1B', mb: 0 }}>
            System Configuration
          </Typography>
          <Chip label="ADMIN ONLY" color="error" size="small" sx={{ fontWeight: 700 }} />
        </Box>
        <Typography variant="body1" color="text.secondary">
          Configure the core mathematical foundation and grid visualization settings
        </Typography>
      </Box>

      <Alert severity="error" sx={{ mb: 3 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
          Critical System Settings
        </Typography>
        <Typography variant="body2">
          Changing origin or alphabet may invalidate existing Pocket IDs and require recalculating branch assignments.
        </Typography>
      </Alert>

      <Grid container spacing={3}>
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Configuration Settings
            </Typography>

            <Box sx={{ mt: 3 }}>
              <TextField
                fullWidth
                label="Origin Latitude"
                type="number"
                value={config.originLat}
                onChange={handleChange('originLat')}
                error={!!errors.originLat}
                helperText={errors.originLat || 'Latitude of the origin point (-90 to 90)'}
                inputProps={{ step: 0.0001, min: -90, max: 90 }}
                sx={{ mb: 2 }}
              />

              <TextField
                fullWidth
                label="Origin Longitude"
                type="number"
                value={config.originLon}
                onChange={handleChange('originLon')}
                error={!!errors.originLon}
                helperText={errors.originLon || 'Longitude of the origin point (-180 to 180)'}
                inputProps={{ step: 0.0001, min: -180, max: 180 }}
                sx={{ mb: 2 }}
              />

              <TextField
                fullWidth
                label="Alphabet"
                value={config.alphabet}
                onChange={handleChange('alphabet')}
                error={!!errors.alphabet}
                helperText={errors.alphabet || 'Exactly 30 unique characters for encoding (no hyphen)'}
                inputProps={{ maxLength: 30 }}
                sx={{ mb: 2.5 }}
              />

              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                Grid Level Colors
              </Typography>
              <Stack spacing={1.2} sx={{ mb: 3 }}>
                {GRID_LEVEL_ROWS.map((row, index) => (
                  <Box
                    key={row.id}
                    sx={{
                      p: 1,
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 1.5
                    }}
                  >
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {row.label}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {config.gridLevels[index]?.toLocaleString() || row.meters.toLocaleString()} meters
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box
                        component="input"
                        type="color"
                        value={config.gridLevelColors[row.id]}
                        onChange={handleGridLevelColorChange(row.id)}
                        aria-label={`${row.label} color`}
                        sx={{
                          width: 40,
                          height: 32,
                          p: 0,
                          border: '1px solid #CBD5E1',
                          borderRadius: 1,
                          backgroundColor: 'transparent',
                          cursor: 'pointer'
                        }}
                      />
                      <Typography variant="caption" sx={{ fontFamily: 'monospace', minWidth: 64 }}>
                        {config.gridLevelColors[row.id]}
                      </Typography>
                    </Box>
                  </Box>
                ))}
                {GRID_LEVEL_ROWS.map((row) => {
                  const colorError = errors[`gridLevelColors.${row.id}`];
                  if (!colorError) return null;
                  return (
                    <Typography key={`${row.id}-error`} variant="caption" color="error">
                      {colorError}
                    </Typography>
                  );
                })}
              </Stack>

              <Box display="flex" gap={2}>
                <Button
                  variant="contained"
                  startIcon={saving ? <CircularProgress size={20} /> : <SaveIcon />}
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save Configuration'}
                </Button>

                <Button
                  variant="outlined"
                  startIcon={<HistoryIcon />}
                  onClick={loadHistory}
                >
                  View History
                </Button>

                <Button
                  variant="outlined"
                  color="warning"
                  startIcon={<HealthAndSafetyIcon />}
                  onClick={() => navigate('/admin/territory-health')}
                >
                  Open Territory Health
                </Button>
              </Box>
            </Box>
          </Paper>
        </Grid>

        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3, bgcolor: '#FFFBEB', border: '1px solid #FCD34D' }}>
            <Typography variant="h6" gutterBottom sx={{ color: '#92400E' }}>
              What This Controls
            </Typography>
            <Divider sx={{ my: 2 }} />

            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#92400E', mb: 0.5 }}>
                Origin Point
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Reference location from which pocket coordinate distances are calculated.
              </Typography>
            </Box>

            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#92400E', mb: 0.5 }}>
                Alphabet
              </Typography>
              <Typography variant="body2" color="text.secondary">
                30-character set used to encode grid positions into Pocket IDs.
              </Typography>
            </Box>

            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#92400E', mb: 0.5 }}>
                Grid Levels and Colors
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Fixed levels (500 km to 1 km) and their dashboard overlay colors.
              </Typography>
            </Box>
          </Paper>

          <Paper sx={{ p: 3, mt: 2, bgcolor: '#FEF2F2', border: '1px solid #FCA5A5' }}>
            <Typography variant="h6" gutterBottom sx={{ color: '#991B1B' }}>
              Data Reset
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Clear selected operational datasets. This cannot be undone.
            </Typography>

            <FormGroup sx={{ mb: 2 }}>
              <FormControlLabel
                control={(
                  <Checkbox
                    checked={clearOptions.clearCustomerData}
                    onChange={handleClearOptionChange('clearCustomerData')}
                    disabled={clearingData}
                  />
                )}
                label="Clear Customer Data"
              />
              <FormControlLabel
                control={(
                  <Checkbox
                    checked={clearOptions.clearBranchData}
                    onChange={handleClearOptionChange('clearBranchData')}
                    disabled={clearingData}
                  />
                )}
                label="Clear Branch Data"
              />
              <FormControlLabel
                control={(
                  <Checkbox
                    checked={clearOptions.clearPocketData}
                    onChange={handleClearOptionChange('clearPocketData')}
                    disabled={clearingData}
                  />
                )}
                label="Clear Pocket Data"
              />
            </FormGroup>

            <Button
              fullWidth
              color="error"
              variant="contained"
              onClick={handleClearSelectedData}
              disabled={
                clearingData
                || (
                  !clearOptions.clearCustomerData
                  && !clearOptions.clearBranchData
                  && !clearOptions.clearPocketData
                )
              }
              startIcon={clearingData ? <CircularProgress size={18} color="inherit" /> : <DeleteSweepIcon />}
            >
              {clearingData ? 'Clearing Data...' : 'Clear Selected Data'}
            </Button>
          </Paper>
        </Grid>

        {showHistory && history.length > 0 && (
          <Grid item xs={12}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>
                Configuration History
              </Typography>
              <Box sx={{ mt: 2 }}>
                {history.map((item) => {
                  const changedAt = item.changedAt ?? item.changed_at;
                  const historyColors = normalizeGridLevelColors(item.gridLevelColors);
                  return (
                    <Box
                      key={item.id}
                      sx={{
                        p: 2,
                        mb: 2,
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1
                      }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        {changedAt ? new Date(changedAt).toLocaleString() : 'Unknown timestamp'}
                      </Typography>
                      <Typography variant="body2" sx={{ mt: 1 }}>
                        Origin: ({item.originLat || item.origin_lat}, {item.originLon || item.origin_lon})
                      </Typography>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                        Alphabet: {item.alphabet}
                      </Typography>
                      <Stack direction="row" spacing={0.8} sx={{ mt: 1, flexWrap: 'wrap' }}>
                        {GRID_LEVEL_ROWS.map((row) => (
                          <Chip
                            key={`${item.id}-${row.id}`}
                            size="small"
                            label={`${row.label}: ${historyColors[row.id]}`}
                            sx={{
                              border: `1px solid ${historyColors[row.id]}`,
                              bgcolor: 'transparent',
                              fontFamily: 'monospace'
                            }}
                          />
                        ))}
                      </Stack>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                        Version: {item.version}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            </Paper>
          </Grid>
        )}
      </Grid>
    </Box>
  );
}
