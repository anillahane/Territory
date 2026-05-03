import { Box, Button, Stack, Typography } from '@mui/material';
import { ExploreOutlined } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <Box
      role="main"
      sx={{
        flexGrow: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 3,
        py: 6,
      }}
    >
      <Stack spacing={2.5} alignItems="center" textAlign="center" sx={{ maxWidth: 520 }}>
        <Box
          sx={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'primary.main',
            backgroundColor: 'rgba(30, 64, 175, 0.10)',
          }}
        >
          <ExploreOutlined sx={{ fontSize: 40 }} />
        </Box>

        <Typography variant="h4" sx={{ fontWeight: 700 }}>
          Page not found
        </Typography>

        <Typography variant="body2" color="text.secondary">
          The page you’re looking for doesn’t exist or has been moved. Let’s get you back on track.
        </Typography>

        <Stack direction="row" spacing={1.5}>
          <Button variant="contained" onClick={() => navigate('/')}>
            Back to dashboard
          </Button>
          <Button variant="outlined" color="inherit" onClick={() => navigate(-1)}>
            Go back
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
