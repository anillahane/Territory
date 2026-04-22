import { Routes, Route, Navigate } from 'react-router-dom';
import { Box, Snackbar, Alert } from '@mui/material';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Configuration from './pages/Configuration';
import Branches from './pages/Branches';
import Calculator from './pages/Calculator';
import BatchProcessing from './pages/BatchProcessing';
import CustomerMappingView from './pages/CustomerMappingView';
import { useStore } from './store/useStore';
import { isAuthenticated } from './services/api';

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
          <Route index element={<Dashboard />} />
          <Route path="config" element={<Configuration />} />
          <Route path="branches" element={<Branches />} />
          <Route path="calculator" element={<Calculator />} />
          <Route path="batch" element={<BatchProcessing />} />
          <Route path="mappings" element={<CustomerMappingView />} />
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
