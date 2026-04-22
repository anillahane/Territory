import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const MUI_VENDOR_PACKAGES = ['/node_modules/@mui/', '/node_modules/@emotion/'];
const MAPLIBRE_VENDOR_PACKAGES = [
  '/node_modules/maplibre-gl/',
  '/node_modules/@mapbox/',
  '/node_modules/kdbush/',
  '/node_modules/supercluster/',
  '/node_modules/geojson-vt/',
  '/node_modules/earcut/'
];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replaceAll('\\', '/');

          if (MUI_VENDOR_PACKAGES.some((packagePath) => normalizedId.includes(packagePath))) {
            return 'vendor-mui';
          }

          if (MAPLIBRE_VENDOR_PACKAGES.some((packagePath) => normalizedId.includes(packagePath))) {
            return 'vendor-maplibre';
          }

          return undefined;
        }
      }
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
});
