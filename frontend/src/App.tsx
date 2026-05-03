import { lazy, Suspense, useEffect, type ComponentType, type LazyExoticComponent } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Box, Skeleton, Snackbar, Alert, Stack } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Sentry from '@sentry/react';
import Layout from './components/Layout';
import ErrorFallback from './components/ErrorFallback';
import Login from './pages/Login';
import { useStore } from './store/useStore';
import { getStoredSession, isAuthenticated, subscribeToStoredSession } from './services/api';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Configuration = lazy(() => import('./pages/Configuration'));
const Branches = lazy(() => import('./pages/Branches'));
const Calculator = lazy(() => import('./pages/Calculator'));
const BatchProcessing = lazy(() => import('./pages/BatchProcessing'));
const CustomerMappingView = lazy(() => import('./pages/CustomerMappingView'));
const NotFound = lazy(() => import('./pages/NotFound'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
    mutations: {
      retry: 0,
    },
  },
});

function RouteLoadingFallback() {
  return (
    <Stack
      spacing={2}
      sx={{
        minHeight: 'calc(100vh - 64px)',
        px: { xs: 2, md: 4 },
        py: { xs: 2, md: 3 },
      }}
      aria-busy="true"
      aria-live="polite"
      role="status"
    >
      <Skeleton variant="text" width="32%" height={36} />
      <Skeleton variant="text" width="60%" height={20} />
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <Skeleton variant="rounded" width="100%" height={120} />
        <Skeleton variant="rounded" width="100%" height={120} />
        <Skeleton variant="rounded" width="100%" height={120} />
      </Stack>
      <Skeleton variant="rounded" width="100%" height={320} />
    </Stack>
  );
}

const renderLazyRoute = (PageComponent: LazyExoticComponent<ComponentType>) => (
  <Suspense fallback={<RouteLoadingFallback />}>
    <PageComponent />
  </Suspense>
);

function ProtectedAppShell() {
  const authSession = useStore((state) => state.authSession);

  if (!authSession?.accessToken) {
    return <Navigate to="/login" replace />;
  }

  return <Layout />;
}

function App() {
  const { error, success, clearNotifications, setAuthSession, clearAuthSession } = useStore();

  useEffect(() => {
    const initialSession = getStoredSession();
    if (initialSession) {
      setAuthSession(initialSession);
    } else {
      clearAuthSession();
    }

    return subscribeToStoredSession((nextSession) => {
      if (nextSession) {
        setAuthSession(nextSession);
        return;
      }

      clearAuthSession();
    });
  }, [clearAuthSession, setAuthSession]);

  const handleClose = () => {
    clearNotifications();
  };

  return (
    <Sentry.ErrorBoundary
      fallback={({ error, resetError }) => <ErrorFallback error={error} resetError={resetError} />}
    >
      <QueryClientProvider client={queryClient}>
        <Box sx={{ width: '100%', height: '100vh', overflow: 'hidden' }}>
          <Routes>
            <Route
              path="/login"
              element={isAuthenticated() ? <Navigate to="/" replace /> : <Login />}
            />
            <Route path="/" element={<ProtectedAppShell />}>
              <Route index element={renderLazyRoute(Dashboard)} />
              <Route path="config" element={renderLazyRoute(Configuration)} />
              <Route path="branches" element={renderLazyRoute(Branches)} />
              <Route path="calculator" element={renderLazyRoute(Calculator)} />
              <Route path="batch" element={renderLazyRoute(BatchProcessing)} />
              <Route path="mappings" element={renderLazyRoute(CustomerMappingView)} />
              <Route path="*" element={renderLazyRoute(NotFound)} />
            </Route>
          </Routes>

          <Snackbar
            open={!!(error || success)}
            autoHideDuration={6000}
            onClose={handleClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
          >
            <Alert
              onClose={handleClose}
              severity={error ? 'error' : 'success'}
              variant="filled"
              elevation={6}
              sx={{ width: '100%' }}
            >
              {error || success}
            </Alert>
          </Snackbar>
        </Box>
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
  );
}

export default App;
