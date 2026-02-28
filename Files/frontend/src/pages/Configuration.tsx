import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  Alert,
  CircularProgress,
  Grid,
  Divider,
  Chip,
} from '@mui/material';
import { Save as SaveIcon, History as HistoryIcon } from '@mui/icons-material';
import { useStore } from '../store/useStore';
import api from '../services/api';

interface Config {
  originLat: number;
  originLon: number;
  alphabet: string;
}

interface ConfigHistory {
  id: number;
  originLat?: number;
  originLon?: number;
  alphabet?: string;
  origin_lat?: number;
  origin_lon?: number;
  changedAt?: string;
  changed_at?: string;
  version?: number;
}

export default function Configuration() {
  const { setError, setSuccess } = useStore();
  const [config, setConfig] = useState<Config>({
    originLat: 8.0,
    originLon: 68.0,
    alphabet: '0123456789ABCDEFGHJKLMNPQRSTUV',
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<ConfigHistory[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const data = await api.getConfig();
      // Handle both response formats
      const configData = data.config || data;
      setConfig({
        originLat: configData.originLat,
        originLon: configData.originLon,
        alphabet: configData.alphabet,
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
      // Handle response format
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
      // Handle response format
      const updatedConfig = response.config || response;
      setConfig({
        originLat: updatedConfig.originLat,
        originLon: updatedConfig.originLon,
        alphabet: updatedConfig.alphabet,
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

  const handleChange = (field: keyof Config) => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const value = field === 'alphabet' ? event.target.value : parseFloat(event.target.value);
    setConfig({ ...config, [field]: value });
    // Clear error for this field
    if (errors[field]) {
      setErrors({ ...errors, [field]: '' });
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
          Configure the core mathematical foundation for Pocket ID generation
        </Typography>
      </Box>

      <Alert severity="error" sx={{ mb: 3 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
          ⚠️ CRITICAL SYSTEM SETTINGS
        </Typography>
        <Typography variant="body2">
          Changing these values will invalidate ALL existing Pocket IDs and require recalculating ALL branch assignments. 
          Only modify during initial setup or major system migrations. Contact your system administrator before making changes.
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
                helperText={
                  errors.alphabet ||
                  'Exactly 30 unique characters for encoding (no hyphen)'
                }
                inputProps={{ maxLength: 30 }}
                sx={{ mb: 3 }}
              />

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
                🌍 Origin Point
              </Typography>
              <Typography variant="body2" color="text.secondary">
                The reference location from which ALL distance calculations are made. This is the "zero point" of your coordinate system.
              </Typography>
            </Box>

            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#92400E', mb: 0.5 }}>
                🔤 Alphabet
              </Typography>
              <Typography variant="body2" color="text.secondary">
                The 30-character set used to encode grid positions into Pocket IDs (e.g., "A1B2C-D3E4F"). Must not contain hyphens.
              </Typography>
            </Box>

            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#92400E', mb: 0.5 }}>
                📏 Grid Levels
              </Typography>
              <Typography variant="body2" color="text.secondary">
                The 5 distance tiers (500km, 100km, 20km, 5km, 1km) that define how the world is divided into pockets.
              </Typography>
            </Box>

            <Divider sx={{ my: 2 }} />

            <Alert severity="warning" sx={{ bgcolor: '#FEF3C7' }}>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                Impact of Changes:
              </Typography>
              <Typography variant="caption" component="div">
                • All existing Pocket IDs become invalid
              </Typography>
              <Typography variant="caption" component="div">
                • All branch assignments must be recalculated
              </Typography>
              <Typography variant="caption" component="div">
                • Historical data references may break
              </Typography>
            </Alert>
          </Paper>
        </Grid>

        {showHistory && history.length > 0 && (
          <Grid item xs={12}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>
                Configuration History
              </Typography>
              <Box sx={{ mt: 2 }}>
                {history.map((item) => (
                  <Box
                    key={item.id}
                    sx={{
                      p: 2,
                      mb: 2,
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                    }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      {new Date(item.changedAt || item.changed_at).toLocaleString()}
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      Origin: ({item.originLat || item.origin_lat}, {item.originLon || item.origin_lon})
                    </Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                      Alphabet: {item.alphabet}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Version: {item.version}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Paper>
          </Grid>
        )}
      </Grid>
    </Box>
  );
}
