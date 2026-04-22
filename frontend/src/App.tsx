import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Box, Snackbar, Alert, CircularProgress, Stack, Typography } from '@mui/material';
import Layout from './components/Layout';
import Login from './pages/Login';
import { useStore } from './store/useStore';
import { isAuthenticated } from './services/api';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Configuration = lazy(() => import('./pages/Configuration'));
const Branches = lazy(() => import('./pages/Branches'));
const Calculator = lazy(() => import('./pages/Calculator'));
const BatchProcessing = lazy(() => import('./pages/BatchProcessing'));
const CustomerMappingView = lazy(() => import('./pages/CustomerMappingView'));

function RouteLoadingFallback() {
  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      spacing={2}
      sx={{
        minHeight: 'calc(100vh - 64px)',
        px: 3,
      }}
    >
      <CircularProgress size={32} />
      <Typography color="text.secondary" variant="body2">
        Loading page...
      </Typography>
    </Stack>
  );
}

const renderLazyRoute = (
  PageComponent: LazyExoticComponent<ComponentType>
) => (
  <Suspense fallback={<RouteLoadingFallback />}>
    <PageComponent />
  </Suspense>
);

function ProtectedAppShell() {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }

  return <Layout />;
}

function App() {
  const { error, success, clearNotifications } = useStore();

  const handleClose = () => {
    clearNotifications();
  };

  return (
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
        </Route>
      </Routes>

      {/* Global notification snackbar */}
      <Snackbar
        open={!!(error || success)}
        autoHideDuration={6000}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleClose} severity={error ? 'error' : 'success'} sx={{ width: '100%' }}>
          {error || success}
        </Alert>
      </Snackbar>
    </Box>
  );
}

export default App;
