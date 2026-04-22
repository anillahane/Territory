import type { RefObject } from 'react';
import { Box } from '@mui/material';

type MapContainerProps = {
  mapContainerRef: RefObject<HTMLDivElement>;
};

export function MapContainer({ mapContainerRef }: MapContainerProps) {
  return (
    <Box
      ref={mapContainerRef}
      sx={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        position: 'relative',
        '& .maplibregl-ctrl-attrib': {
          display: 'none'
        }
      }}
    />
  );
}
