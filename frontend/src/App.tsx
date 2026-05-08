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
import EmployeeMapping from './pages/EmployeeMapping';
import AdminTerritoryHealth from './pages/AdminTerritoryHealth';
import GridCellsViewer from './pages/GridCellsViewer';
import TerritoryData from './pages/TerritoryData';
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
        {/* --- ORIGINAL BACKUP --- */}
        {/* <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="config" element={<Configuration />} />
          <Route path="branches" element={<Branches />} />
          <Route path="calculator" element={<Calculator />} />
          <Route path="batch" element={<BatchProcessing />} />
          <Route path="employee-mapping" element={<EmployeeMapping />} />
          <Route path="mappings" element={<CustomerMappingView />} />
        </Route> */}
        <Route path="/" element={<ProtectedAppShell />}>
          <Route index element={<Dashboard territoryUiVariant="dashboard" />} />
          <Route path="voronoi" element={<Dashboard territoryUiVariant="voronoi" />} />
          <Route path="config" element={<Configuration />} />
          <Route path="branches" element={<Branches />} />
          <Route path="calculator" element={<Calculator />} />
          <Route path="batch" element={<BatchProcessing />} />
          <Route path="employee-mapping" element={<EmployeeMapping />} />
          <Route path="mappings" element={<CustomerMappingView />} />
          <Route path="admin/territory-data" element={<TerritoryData />} />
          {/* --- ORIGINAL BACKUP ---
          <Route path="admin/territory-health" element={<AdminTerritoryHealth />} />
          */}
          <Route path="admin/territory-health" element={<AdminTerritoryHealth />} />
          <Route path="admin/grid-cells" element={<GridCellsViewer />} />
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
