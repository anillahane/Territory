import type { ReactNode } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import { ErrorOutline, InboxOutlined } from '@mui/icons-material';
import type { SxProps, Theme } from '@mui/material/styles';

export type DataStateVariant = 'loading' | 'empty' | 'error';

interface DataStateProps {
  variant: DataStateVariant;
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  minHeight?: number | string;
  sx?: SxProps<Theme>;
}

const variantMeta: Record<Exclude<DataStateVariant, 'loading'>, { color: string; background: string }> = {
  empty: {
    color: '#475569',
    background: 'rgba(148, 163, 184, 0.14)',
  },
  error: {
    color: '#B91C1C',
    background: 'rgba(239, 68, 68, 0.12)',
  },
};

export default function DataState({
  variant,
  title,
  description,
  icon,
  action,
  minHeight = 320,
  sx,
}: DataStateProps) {
  const defaultIcon =
    variant === 'empty' ? <InboxOutlined sx={{ fontSize: 40 }} /> : <ErrorOutline sx={{ fontSize: 40 }} />;
  const baseSx: SxProps<Theme> = {
    minHeight,
    px: 4,
    py: 5,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    textAlign: 'center',
  };
  const containerSx = sx ? ([baseSx, sx] as SxProps<Theme>) : baseSx;

  return (
    <Box
      role={variant === 'loading' ? 'status' : undefined}
      aria-live={variant === 'loading' ? 'polite' : undefined}
      sx={containerSx}
    >
      {variant === 'loading' ? (
        <CircularProgress size={40} />
      ) : (
        <Box
          sx={{
            width: 80,
            height: 80,
            mb: 2,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: variantMeta[variant].color,
            backgroundColor: variantMeta[variant].background,
          }}
        >
          {icon ?? defaultIcon}
        </Box>
      )}

      <Typography
        variant="h6"
        sx={{
          mt: variant === 'loading' ? 2 : 0,
          fontWeight: 700,
          color: '#0F172A',
        }}
      >
        {title}
      </Typography>

      {description ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 560 }}>
          {description}
        </Typography>
      ) : null}

      {action ? (
        <Box sx={{ mt: 3, display: 'flex', justifyContent: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          {action}
        </Box>
      ) : null}
    </Box>
  );
}
