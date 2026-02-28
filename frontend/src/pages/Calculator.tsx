import { useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  Grid,
  Divider,
  Alert,
  CircularProgress,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Calculate as CalculateIcon,
  ContentCopy as CopyIcon,
  SwapHoriz as SwapIcon,
} from '@mui/icons-material';
import { useStore } from '../store/useStore';
import api from '../services/api';

type Mode = 'encode' | 'decode';

interface EncodeResult {
  pocketId: string;
  indices: Array<{
    level: number;
    levelSize: number;
    row: number;
    col: number;
  }>;
  meters: {
    x: number;
    y: number;
  };
}

interface DecodeResult {
  centerLat: number;
  centerLon: number;
  corners: {
    sw: { lat: number; lon: number };
    ne: { lat: number; lon: number };
    nw: { lat: number; lon: number };
    se: { lat: number; lon: number };
  };
  indices: Array<{
    level: number;
    levelSize: number;
    row: number;
    col: number;
  }>;
}

export default function Calculator() {
  const { setError, setSuccess } = useStore();
  const [mode, setMode] = useState<Mode>('encode');
  const [loading, setLoading] = useState(false);

  // Encode inputs
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [encodeResult, setEncodeResult] = useState<EncodeResult | null>(null);

  // Decode inputs
  const [pocketId, setPocketId] = useState('');
  const [decodeResult, setDecodeResult] = useState<DecodeResult | null>(null);

  const handleEncode = async () => {
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lon)) {
      setError('Please enter valid coordinates');
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

    setLoading(true);
    try {
      const result = await api.encodePocketId(lat, lon);
      console.log('Encode result:', result);
      setEncodeResult(result);
      setSuccess('Pocket ID generated successfully');
    } catch (error: any) {
      console.error('Encode error:', error);
      setError(error.message || 'Failed to encode coordinates');
    } finally {
      setLoading(false);
    }
  };

  const handleDecode = async () => {
    if (!pocketId.trim()) {
      setError('Please enter a Pocket ID');
      return;
    }

    setLoading(true);
    try {
      const result = await api.decodePocketId(pocketId.trim());
      console.log('Decode result:', result);
      
      // Handle backend response format
      const normalizedResult: DecodeResult = {
        centerLat: result.center?.lat || result.centerLat,
        centerLon: result.center?.lon || result.centerLon,
        corners: {
          sw: result.corners?.southwest || result.corners?.sw || { lat: 0, lon: 0 },
          ne: result.corners?.northeast || result.corners?.ne || { lat: 0, lon: 0 },
          nw: result.corners?.northwest || result.corners?.nw || { lat: 0, lon: 0 },
          se: result.corners?.southeast || result.corners?.se || { lat: 0, lon: 0 },
        },
        indices: result.indices || [],
      };
      
      setDecodeResult(normalizedResult);
      setSuccess('Pocket ID decoded successfully');
    } catch (error: any) {
      console.error('Decode error:', error);
      setError(error.message || 'Failed to decode Pocket ID');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setSuccess('Copied to clipboard');
  };

  const toggleMode = () => {
    setMode(mode === 'encode' ? 'decode' : 'encode');
    setEncodeResult(null);
    setDecodeResult(null);
  };

  const formatCoordinate = (value: number, decimals: number = 6) => {
    return value.toFixed(decimals);
  };

  return (
    <Box sx={{ width: '100%', height: '100%', p: 3 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h4" gutterBottom>
            Pocket ID Calculator
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Convert between coordinates and Pocket IDs
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<SwapIcon />}
          onClick={toggleMode}
        >
          Switch to {mode === 'encode' ? 'Decode' : 'Encode'}
        </Button>
      </Box>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              {mode === 'encode' ? 'Encode Coordinates' : 'Decode Pocket ID'}
            </Typography>
            <Divider sx={{ my: 2 }} />

            {mode === 'encode' ? (
              <Box>
                <TextField
                  fullWidth
                  label="Latitude"
                  type="number"
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                  placeholder="e.g., 12.9716"
                  inputProps={{ step: 0.0001, min: -90, max: 90 }}
                  sx={{ mb: 2 }}
                />
                <TextField
                  fullWidth
                  label="Longitude"
                  type="number"
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                  placeholder="e.g., 77.5946"
                  inputProps={{ step: 0.0001, min: -180, max: 180 }}
                  sx={{ mb: 3 }}
                />
                <Button
                  fullWidth
                  variant="contained"
                  startIcon={loading ? <CircularProgress size={20} /> : <CalculateIcon />}
                  onClick={handleEncode}
                  disabled={loading}
                >
                  {loading ? 'Encoding...' : 'Generate Pocket ID'}
                </Button>
              </Box>
            ) : (
              <Box>
                <TextField
                  fullWidth
                  label="Pocket ID"
                  value={pocketId}
                  onChange={(e) => setPocketId(e.target.value)}
                  placeholder="e.g., 7F-33-22-11-00"
                  sx={{ mb: 3 }}
                />
                <Button
                  fullWidth
                  variant="contained"
                  startIcon={loading ? <CircularProgress size={20} /> : <CalculateIcon />}
                  onClick={handleDecode}
                  disabled={loading}
                >
                  {loading ? 'Decoding...' : 'Decode Pocket ID'}
                </Button>
              </Box>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Result
            </Typography>
            <Divider sx={{ my: 2 }} />

            {mode === 'encode' && encodeResult && (
              <Box>
                <Box display="flex" alignItems="center" gap={1} mb={3}>
                  <Typography variant="h5" sx={{ fontFamily: 'monospace' }}>
                    {encodeResult.pocketId}
                  </Typography>
                  <Tooltip title="Copy Pocket ID">
                    <IconButton
                      size="small"
                      onClick={() => handleCopy(encodeResult.pocketId)}
                    >
                      <CopyIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>

                <Typography variant="subtitle2" gutterBottom>
                  Grid Indices:
                </Typography>
                <TableContainer sx={{ mb: 2 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Level</TableCell>
                        <TableCell>Size (m)</TableCell>
                        <TableCell>Row</TableCell>
                        <TableCell>Col</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {encodeResult.indices.map((idx) => (
                        <TableRow key={idx.level}>
                          <TableCell>{idx.level}</TableCell>
                          <TableCell>{idx.levelSize.toLocaleString()}</TableCell>
                          <TableCell>{idx.row}</TableCell>
                          <TableCell>{idx.col}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>

                <Typography variant="subtitle2" gutterBottom>
                  Offset from Origin:
                </Typography>
                <Typography variant="body2">
                  X: {encodeResult.meters.x.toFixed(2)} m
                </Typography>
                <Typography variant="body2">
                  Y: {encodeResult.meters.y.toFixed(2)} m
                </Typography>
              </Box>
            )}

            {mode === 'decode' && decodeResult && (
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Center Coordinates:
                </Typography>
                <Box display="flex" alignItems="center" gap={1} mb={2}>
                  <Chip
                    label={`${formatCoordinate(decodeResult.centerLat)}, ${formatCoordinate(decodeResult.centerLon)}`}
                    sx={{ fontFamily: 'monospace' }}
                  />
                  <Tooltip title="Copy coordinates">
                    <IconButton
                      size="small"
                      onClick={() =>
                        handleCopy(`${decodeResult.centerLat}, ${decodeResult.centerLon}`)
                      }
                    >
                      <CopyIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>

                <Typography variant="subtitle2" gutterBottom>
                  Corner Coordinates:
                </Typography>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2">
                    SW: {formatCoordinate(decodeResult.corners.sw.lat)}, {formatCoordinate(decodeResult.corners.sw.lon)}
                  </Typography>
                  <Typography variant="body2">
                    NE: {formatCoordinate(decodeResult.corners.ne.lat)}, {formatCoordinate(decodeResult.corners.ne.lon)}
                  </Typography>
                  <Typography variant="body2">
                    NW: {formatCoordinate(decodeResult.corners.nw.lat)}, {formatCoordinate(decodeResult.corners.nw.lon)}
                  </Typography>
                  <Typography variant="body2">
                    SE: {formatCoordinate(decodeResult.corners.se.lat)}, {formatCoordinate(decodeResult.corners.se.lon)}
                  </Typography>
                </Box>

                <Typography variant="subtitle2" gutterBottom>
                  Grid Indices:
                </Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Level</TableCell>
                        <TableCell>Size (m)</TableCell>
                        <TableCell>Row</TableCell>
                        <TableCell>Col</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {decodeResult.indices.map((idx) => (
                        <TableRow key={idx.level}>
                          <TableCell>{idx.level}</TableCell>
                          <TableCell>{idx.levelSize.toLocaleString()}</TableCell>
                          <TableCell>{idx.row}</TableCell>
                          <TableCell>{idx.col}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}

            {!encodeResult && !decodeResult && (
              <Alert severity="info">
                Enter {mode === 'encode' ? 'coordinates' : 'a Pocket ID'} and click the button to see results
              </Alert>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
