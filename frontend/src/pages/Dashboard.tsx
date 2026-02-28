import { Box, Typography } from '@mui/material';

export default function Dashboard() {
  return (
    <Box sx={{ width: '100%', height: '100%', p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Dashboard
      </Typography>
      <Typography variant="body1" color="text.secondary">
        Interactive map with grid overlay, branch markers, and nearest branch finder will be displayed here.
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        🚧 Under construction - Phase 4: Map Integration
      </Typography>
    </Box>
  );
}
