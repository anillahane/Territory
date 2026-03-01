import { Routes, Route } from 'react-router-dom';
import { Box, Snackbar, Alert } from '@mui/material';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Configuration from './pages/Configuration';
import Branches from './pages/Branches';
import Calculator from './pages/Calculator';
import BatchProcessing from './pages/BatchProcessing';
import CustomerMappingView from './pages/CustomerMappingView';
import { useStore } from './store/useStore';

function App() {
  const { error, success, clearNotifications } = useStore();

  const handleClose = () => {
    clearNotifications();
  };

  return (
    <Box sx={{ width: '100%', minHeight: '100vh' }}>
      <Routes>
        <Route path="/" element={<Layout />}>
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
