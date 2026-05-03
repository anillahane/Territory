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
const REACT_VENDOR_PACKAGES = [
  '/node_modules/react/',
  '/node_modules/react-dom/',
  '/node_modules/react-router/',
  '/node_modules/react-router-dom/',
  '/node_modules/scheduler/'
];
const QUERY_VENDOR_PACKAGES = ['/node_modules/@tanstack/'];
const SENTRY_VENDOR_PACKAGES = ['/node_modules/@sentry/'];

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';

  return {
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
      sourcemap: isProd ? 'hidden' : true,
      cssCodeSplit: true,
      reportCompressedSize: false,
      chunkSizeWarningLimit: 1200,
      target: 'es2020',
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalizedId = id.replaceAll('\\', '/');

            if (REACT_VENDOR_PACKAGES.some((p) => normalizedId.includes(p))) {
              return 'vendor-react';
            }
            if (MUI_VENDOR_PACKAGES.some((p) => normalizedId.includes(p))) {
              return 'vendor-mui';
            }
            if (MAPLIBRE_VENDOR_PACKAGES.some((p) => normalizedId.includes(p))) {
              return 'vendor-maplibre';
            }
            if (QUERY_VENDOR_PACKAGES.some((p) => normalizedId.includes(p))) {
              return 'vendor-query';
            }
            if (SENTRY_VENDOR_PACKAGES.some((p) => normalizedId.includes(p))) {
              return 'vendor-sentry';
            }

            return undefined;
          },
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
    },
  };
});
