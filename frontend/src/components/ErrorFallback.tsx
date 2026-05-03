import { Box, Button, Stack, Typography } from '@mui/material';
import { ErrorOutline, RefreshOutlined } from '@mui/icons-material';

interface ErrorFallbackProps {
  error: unknown;
  resetError?: () => void;
}

export default function ErrorFallback({ error, resetError }: ErrorFallbackProps) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'An unexpected error occurred while rendering this view.';

  const handleReload = () => {
    if (resetError) {
      resetError();
      return;
    }
    window.location.reload();
  };

  return (
    <Box
      role="alert"
      aria-live="assertive"
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'background.default',
        px: 3,
      }}
    >
      <Stack
        spacing={2.5}
        alignItems="center"
        sx={{
          maxWidth: 520,
          textAlign: 'center',
          p: 4,
          borderRadius: 3,
          backgroundColor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box
          sx={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'error.main',
            backgroundColor: 'rgba(220, 38, 38, 0.10)',
          }}
        >
          <ErrorOutline sx={{ fontSize: 36 }} />
        </Box>

        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Something went wrong
        </Typography>

        <Typography variant="body2" color="text.secondary">
          {message}
        </Typography>

        <Typography variant="caption" color="text.disabled">
          Our team has been notified. You can try reloading this view.
        </Typography>

        <Stack direction="row" spacing={1.5}>
          <Button
            variant="contained"
            color="primary"
            startIcon={<RefreshOutlined />}
            onClick={handleReload}
          >
            Reload
          </Button>
          <Button variant="outlined" color="inherit" onClick={() => (window.location.href = '/')}>
            Go to dashboard
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
