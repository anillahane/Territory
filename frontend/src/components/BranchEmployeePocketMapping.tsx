import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material';
import {
  AutoFixHigh as AutoFixHighIcon,
  Download as DownloadIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';
import api from '../services/api';
import { useStore } from '../store/useStore';

type BranchOption = {
  id: string;
  city: string;
};

type BranchEmployee = {
  id: string;
  branchId: string;
  employeeId: string;
  name: string;
  colorCode: string;
  maxCapacity: number | null;
  isActive: boolean;
  allocatedPocketsCount: number;
  allocatedCustomerCount: number;
};

type PocketRow = {
  pocketId: string;
  customerCount: number;
  employeeId: string;
};

type BranchEmployeeForm = {
  id: string;
  employeeId: string;
  name: string;
  colorCode: string;
  maxCapacity: string;
  isActive: boolean;
};

type BranchEmployeePocketMappingProps = {
  embeddedInBatch?: boolean;
};

const AUTO_EMPLOYEE_COLOR_SEQUENCE = [
  '#D50711', // Red
  '#10B981', // Green
  '#8B4513', // Brown
  '#B8860B', // Dark Yellow
  '#000000', // Black
  '#FFFFFF'  // White
];
const DEFAULT_COLOR = AUTO_EMPLOYEE_COLOR_SEQUENCE[0];
const DEFAULT_MAX_CAPACITY = '120';
const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{6})$/;
const ALLOCATION_LEVEL_OPTIONS = [
  { value: 5000, label: '5 km' },
  { value: 1000, label: '1 km' }
] as const;

const getNextAutoEmployeeColor = (employeeCount: number): string => {
  const safeCount = Number.isFinite(employeeCount) && employeeCount >= 0
    ? Math.floor(employeeCount)
    : 0;
  return AUTO_EMPLOYEE_COLOR_SEQUENCE[safeCount % AUTO_EMPLOYEE_COLOR_SEQUENCE.length];
};

const normalizeHexColor = (value: string | null | undefined, fallback = DEFAULT_COLOR): string => {
  const normalized = String(value || '').trim();
  if (!HEX_COLOR_REGEX.test(normalized)) {
    return fallback;
  }
  return normalized.toUpperCase();
};

const createEmptyForm = (): BranchEmployeeForm => ({
  id: '',
  employeeId: '',
  name: '',
  colorCode: getNextAutoEmployeeColor(0),
  maxCapacity: DEFAULT_MAX_CAPACITY,
  isActive: true
});

const createCsvCell = (value: unknown): string => {
  const normalized = value === null || value === undefined ? '' : String(value);
  const escaped = normalized.replace(/"/g, '""');
  if (/[",\n]/.test(escaped)) {
    return `"${escaped}"`;
  }
  return escaped;
};

const normalizeBranchEmployee = (input: Record<string, unknown>): BranchEmployee => ({
  id: String(input.id || '').trim(),
  branchId: String(input.branchId || input.branch_id || '').trim(),
  employeeId: String(input.employeeId || input.employeeCode || input.employee_id || '').trim(),
  name: String(input.name || input.employeeId || input.employeeCode || '').trim(),
  colorCode: normalizeHexColor(String(input.colorCode || input.color_code || ''), DEFAULT_COLOR),
  maxCapacity: Number.isFinite(Number(input.maxCapacity ?? input.max_capacity))
    ? Number(input.maxCapacity ?? input.max_capacity)
    : null,
  isActive: Boolean(input.isActive ?? input.is_active ?? true),
  allocatedPocketsCount: Number(input.allocatedPocketsCount ?? input.allocated_pockets_count ?? 0),
  allocatedCustomerCount: Number(input.allocatedCustomerCount ?? input.allocated_customer_count ?? 0)
});

const buildPocketRows = (payload: any): PocketRow[] => {
  const features = Array.isArray(payload?.pockets?.features) ? payload.pockets.features : [];
  const pocketMap = new Map<string, PocketRow>();

  features.forEach((feature: any) => {
    const properties = feature?.properties || {};
    const pocketId = String(
      properties.pocket_id
      || properties.grid_cell_id
      || ''
    ).trim();

    if (!pocketId) {
      return;
    }

    const customerCount = Number(properties.customer_count ?? properties.account_count ?? 0);
    const safeCustomerCount = Number.isFinite(customerCount) ? customerCount : 0;
    const employeeId = String(properties.employee_id || '').trim();

    const existing = pocketMap.get(pocketId);
    if (!existing) {
      pocketMap.set(pocketId, {
        pocketId,
        customerCount: safeCustomerCount,
        employeeId
      });
      return;
    }

    existing.customerCount += safeCustomerCount;
    if (!existing.employeeId && employeeId) {
      existing.employeeId = employeeId;
    }
  });

  return Array.from(pocketMap.values()).sort((a, b) => a.pocketId.localeCompare(b.pocketId));
};

export default function BranchEmployeePocketMapping(props: BranchEmployeePocketMappingProps) {
  const { embeddedInBatch = false } = props;
  const { setError, setSuccess } = useStore();

  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [branchesLoading, setBranchesLoading] = useState(false);

  const [employees, setEmployees] = useState<BranchEmployee[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);

  const [pocketRows, setPocketRows] = useState<PocketRow[]>([]);
  const [pocketsLoading, setPocketsLoading] = useState(false);

  const [allocationRunning, setAllocationRunning] = useState(false);
  const [allocationLevel, setAllocationLevel] = useState<number>(5000);
  const [tableAssignPocketId, setTableAssignPocketId] = useState('');
  const [employeeRowActionId, setEmployeeRowActionId] = useState('');
  const [employeeFormSaving, setEmployeeFormSaving] = useState(false);
  const [employeeFormError, setEmployeeFormError] = useState<string | null>(null);
  const [employeeForm, setEmployeeForm] = useState<BranchEmployeeForm>(createEmptyForm());
  const [maxCapacityEdited, setMaxCapacityEdited] = useState(false);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkUseSelectedBranch, setBulkUseSelectedBranch] = useState(true);
  const [bulkResultSummary, setBulkResultSummary] = useState<string | null>(null);

  const activeEmployees = useMemo(
    () => employees.filter((employee) => employee.isActive),
    [employees]
  );

  const hasActiveEmployees = activeEmployees.length > 0;
  const totalBranchCustomers = useMemo(
    () => pocketRows.reduce((total, row) => total + Number(row.customerCount || 0), 0),
    [pocketRows]
  );
  const suggestedMaxCapacity = useMemo(() => {
    const additionalHeadcount = employeeForm.id ? 0 : 1;
    const divisor = Math.max(activeEmployees.length + additionalHeadcount, 1);
    const calculated = Math.ceil(totalBranchCustomers / divisor);
    if (!Number.isFinite(calculated) || calculated < 0) {
      return Number.parseInt(DEFAULT_MAX_CAPACITY, 10);
    }
    return calculated;
  }, [totalBranchCustomers, activeEmployees.length, employeeForm.id]);
  const nextAutoColor = useMemo(
    () => getNextAutoEmployeeColor(employees.length),
    [employees.length]
  );

  const loadBranches = useCallback(async () => {
    setBranchesLoading(true);
    try {
      const response = await api.getBranches({ limit: 1000, offset: 0 });
      const rawCandidate = response?.branches ?? response?.data ?? response;
      const rows = Array.isArray(rawCandidate) ? rawCandidate : [];

      const normalized = rows
        .map((row: Record<string, unknown>) => {
          const id = String(row.id || '').trim();
          const city = String(row.city || '').trim();
          if (!id) return null;
          return {
            id,
            city
          } as BranchOption;
        })
        .filter((row): row is BranchOption => Boolean(row))
        .sort((a, b) => a.id.localeCompare(b.id));

      setBranches(normalized);
      if (!selectedBranchId && normalized.length > 0) {
        setSelectedBranchId(normalized[0].id);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to load branches');
    } finally {
      setBranchesLoading(false);
    }
  }, [selectedBranchId, setError]);

  const loadEmployees = useCallback(async (branchId: string) => {
    const trimmedBranchId = String(branchId || '').trim();
    if (!trimmedBranchId) {
      setEmployees([]);
      return;
    }

    setEmployeesLoading(true);
    try {
      const response = await api.getEmployeesByBranch(trimmedBranchId, {
        includeInactive: true
      });
      const employeeRows = Array.isArray(response?.employees) ? response.employees : [];
      const normalized = employeeRows
        .map((row: Record<string, unknown>) => normalizeBranchEmployee(row))
        .filter((row: BranchEmployee) => row.id.length > 0);
      setEmployees(normalized);
      setEmployeeFormError(null);
    } catch (error) {
      setEmployees([]);
      setError(error instanceof Error ? error.message : 'Failed to load employees');
    } finally {
      setEmployeesLoading(false);
    }
  }, [setError]);

  const loadPockets = useCallback(async (branchId: string, levelOverride?: number) => {
    const trimmedBranchId = String(branchId || '').trim();
    if (!trimmedBranchId) {
      setPocketRows([]);
      return;
    }
    const effectiveLevel = Number.isFinite(Number(levelOverride))
      ? Math.round(Number(levelOverride))
      : allocationLevel;

    setPocketsLoading(true);
    try {
      const payload = await api.getBranchTerritories(trimmedBranchId, {
        useExistingTerritoriesOnly: true,
        level_m: effectiveLevel
      });
      setPocketRows(buildPocketRows(payload));
    } catch (error) {
      setPocketRows([]);
      setError(error instanceof Error ? error.message : 'Failed to load pocket assignments');
    } finally {
      setPocketsLoading(false);
    }
  }, [setError, allocationLevel]);

  const refreshBranchData = useCallback(async (branchId: string) => {
    const trimmedBranchId = String(branchId || '').trim();
    if (!trimmedBranchId) {
      setEmployees([]);
      setPocketRows([]);
      return;
    }

    await Promise.all([
      loadEmployees(trimmedBranchId),
      loadPockets(trimmedBranchId)
    ]);
  }, [loadEmployees, loadPockets]);

  useEffect(() => {
    void loadBranches();
  }, [loadBranches]);

  useEffect(() => {
    if (!selectedBranchId) {
      setEmployees([]);
      setPocketRows([]);
      setEmployeeForm(createEmptyForm());
      setMaxCapacityEdited(false);
      return;
    }
    setEmployeeForm(createEmptyForm());
    setEmployeeFormError(null);
    setMaxCapacityEdited(false);
    void refreshBranchData(selectedBranchId);
  }, [selectedBranchId, refreshBranchData]);

  useEffect(() => {
    if (!selectedBranchId) {
      return;
    }
    if (employeeForm.id || employeeForm.employeeId || employeeForm.name) {
      return;
    }

    const nextSuggestedCapacity = String(suggestedMaxCapacity);
    const nextFormColor = nextAutoColor;
    const nextFormCapacity = maxCapacityEdited
      ? employeeForm.maxCapacity
      : nextSuggestedCapacity;

    if (
      employeeForm.colorCode === nextFormColor
      && employeeForm.maxCapacity === nextFormCapacity
    ) {
      return;
    }

    setEmployeeForm((previous) => ({
      ...previous,
      colorCode: nextFormColor,
      maxCapacity: nextFormCapacity
    }));
  }, [
    selectedBranchId,
    employeeForm.id,
    employeeForm.employeeId,
    employeeForm.name,
    employeeForm.colorCode,
    employeeForm.maxCapacity,
    nextAutoColor,
    suggestedMaxCapacity,
    maxCapacityEdited
  ]);

  const handleSaveEmployee = async () => {
    const branchId = String(selectedBranchId || '').trim();
    if (!branchId) {
      setEmployeeFormError('Select a branch first.');
      return;
    }

    const employeeCode = String(employeeForm.employeeId || '').trim();
    const name = String(employeeForm.name || '').trim();
    const colorCode = normalizeHexColor(
      employeeForm.colorCode,
      nextAutoColor || DEFAULT_COLOR
    );
    const maxCapacityRaw = String(employeeForm.maxCapacity || '').trim();
    const maxCapacity = maxCapacityRaw === ''
      ? suggestedMaxCapacity
      : Number.parseInt(maxCapacityRaw, 10);

    if (!employeeCode) {
      setEmployeeFormError('Employee ID is required.');
      return;
    }
    if (!name) {
      setEmployeeFormError('Employee name is required.');
      return;
    }
    if (
      maxCapacityRaw !== ''
      && (!Number.isInteger(maxCapacity) || Number(maxCapacity) < 0)
    ) {
      setEmployeeFormError('Max capacity must be a non-negative integer.');
      return;
    }

    setEmployeeFormSaving(true);
    setEmployeeFormError(null);
    try {
      if (employeeForm.id) {
        await api.updateEmployee(employeeForm.id, {
          employee_id: employeeCode,
          name,
          color_code: colorCode,
          max_capacity: maxCapacity,
          is_active: employeeForm.isActive
        });
        setSuccess('Employee updated successfully.');
      } else {
        await api.createEmployee({
          branch_id: branchId,
          employee_id: employeeCode,
          name,
          color_code: colorCode,
          max_capacity: maxCapacity,
          is_active: employeeForm.isActive
        });
        setSuccess('Employee created successfully.');
      }

      await loadEmployees(branchId);
      const nextColorBaseIndex = employeeForm.id
        ? employees.length
        : employees.length + 1;
      setEmployeeForm({
        ...createEmptyForm(),
        colorCode: getNextAutoEmployeeColor(Math.max(nextColorBaseIndex, 0)),
        maxCapacity: String(suggestedMaxCapacity)
      });
      setMaxCapacityEdited(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save employee';
      if (message === 'Not Found') {
        setEmployeeFormError(
          'Employee API route not found. Restart backend so /api/v1/employees routes are loaded.'
        );
      } else {
        setEmployeeFormError(message);
      }
    } finally {
      setEmployeeFormSaving(false);
    }
  };

  const handleDownloadExistingAllocation = () => {
    const branchId = String(selectedBranchId || '').trim();
    if (!branchId) {
      setError('Select a branch first.');
      return;
    }
    if (!Array.isArray(pocketRows) || pocketRows.length === 0) {
      setError('No pocket allocation available for this branch.');
      return;
    }

    const employeeById = new Map(
      employees.map((employee) => [employee.id, employee])
    );

    const csvHeaders = [
      'branch_id',
      'pocket_id',
      'total_customers',
      'assigned_employee_row_id',
      'assigned_employee_id',
      'assigned_employee_name',
      'assigned_color_code',
      'max_capacity'
    ];

    const csvRows = pocketRows.map((row) => {
      const employee = employeeById.get(String(row.employeeId || '').trim());
      return [
        branchId,
        row.pocketId,
        Number(row.customerCount || 0),
        row.employeeId || '',
        employee?.employeeId || '',
        employee?.name || '',
        employee?.colorCode || '',
        employee?.maxCapacity === null || employee?.maxCapacity === undefined
          ? ''
          : Number(employee.maxCapacity)
      ];
    });

    const csv = [
      csvHeaders.map((value) => createCsvCell(value)).join(','),
      ...csvRows.map((row) => row.map((value) => createCsvCell(value)).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const objectUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = `branch_${branchId}_existing_allocation.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    window.URL.revokeObjectURL(objectUrl);
    document.body.removeChild(anchor);
    setSuccess('Existing allocation downloaded.');
  };

  const handleDownloadEmployeeTemplate = async () => {
    try {
      const blob = await api.downloadEmployeeTemplate();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'employee_mapping_template.xlsx';
      document.body.appendChild(link);
      link.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(link);
      setSuccess('Employee template downloaded.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to download template');
    }
  };

  const handleBulkUpload = async () => {
    if (!bulkFile) {
      setError('Please select an employee upload file first.');
      return;
    }

    setBulkUploading(true);
    setBulkResultSummary(null);
    try {
      const payload = await api.bulkUploadEmployees(
        bulkFile,
        bulkUseSelectedBranch && selectedBranchId
          ? { branch_id: selectedBranchId }
          : undefined
      );
      const summary = payload?.summary || {};
      const summaryText = `Created: ${Number(summary.created || 0)}, Updated: ${Number(summary.updated || 0)}, Failed: ${Number(summary.failed || 0)}`;
      setBulkResultSummary(summaryText);
      setSuccess(`Bulk employee upload complete. ${summaryText}`);
      await refreshBranchData(selectedBranchId);
      setBulkFile(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bulk upload failed';
      if (message === 'Not Found') {
        setError('Bulk upload API route not found. Restart backend so /api/v1/employees routes are loaded.');
      } else {
        setError(message);
      }
    } finally {
      setBulkUploading(false);
    }
  };

  const handleDeactivateEmployee = async (employeeId: string) => {
    const normalizedEmployeeId = String(employeeId || '').trim();
    if (!normalizedEmployeeId || employeeRowActionId) {
      return;
    }

    setEmployeeRowActionId(normalizedEmployeeId);
    try {
      await api.deleteEmployee(normalizedEmployeeId);
      setSuccess('Employee deactivated.');
      await loadEmployees(selectedBranchId);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to deactivate employee');
    } finally {
      setEmployeeRowActionId('');
    }
  };

  const handleActivateEmployee = async (employeeId: string) => {
    const normalizedEmployeeId = String(employeeId || '').trim();
    if (!normalizedEmployeeId || employeeRowActionId) {
      return;
    }

    setEmployeeRowActionId(normalizedEmployeeId);
    try {
      await api.updateEmployee(normalizedEmployeeId, { is_active: true });
      setSuccess('Employee activated.');
      await loadEmployees(selectedBranchId);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to activate employee');
    } finally {
      setEmployeeRowActionId('');
    }
  };

  const handleRunAllocation = async () => {
    const branchId = String(selectedBranchId || '').trim();
    if (!branchId || allocationRunning) {
      return;
    }
    if (!hasActiveEmployees) {
      setError('Please add active employees to this branch before running allocation.');
      return;
    }

    setAllocationRunning(true);
    try {
      await api.runTerritoryAllocation(branchId, {
        useExistingTerritoriesOnly: true,
        level_m: allocationLevel
      });
      setSuccess('Auto-allocation completed.');
      await loadPockets(branchId);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to run auto-allocation');
    } finally {
      setAllocationRunning(false);
    }
  };

  const handleManualPocketAssign = async (pocketId: string, employeeId: string) => {
    const branchId = String(selectedBranchId || '').trim();
    const normalizedPocketId = String(pocketId || '').trim();
    const normalizedEmployeeId = String(employeeId || '').trim();
    if (!branchId || !normalizedPocketId || !normalizedEmployeeId || tableAssignPocketId) {
      return;
    }

    setTableAssignPocketId(normalizedPocketId);
    try {
      await api.assignManualPocket({
        branchId,
        pocketId: normalizedPocketId,
        newEmployeeId: normalizedEmployeeId,
        level_m: allocationLevel
      });

      setPocketRows((previousRows) => previousRows.map((row) => (
        row.pocketId === normalizedPocketId
          ? { ...row, employeeId: normalizedEmployeeId }
          : row
      )));
      setSuccess(`Pocket ${normalizedPocketId} assigned.`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to assign pocket');
    } finally {
      setTableAssignPocketId('');
    }
  };

  const rootWrapperSx = embeddedInBatch
    ? { width: '100%', mt: 1 }
    : { width: '100%', p: 3 };

  return (
    <Box sx={rootWrapperSx}>
      {!embeddedInBatch && (
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h4" gutterBottom>
            Employee Mapping
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Branch to Employee to Pocket mapping manager.
          </Typography>
        </Box>
      )}

      <Stack spacing={2}>
        <Paper sx={{ p: 2 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
            <FormControl size="small" sx={{ minWidth: 260 }}>
              <InputLabel id="mapping-branch-label">Branch</InputLabel>
              <Select
                labelId="mapping-branch-label"
                value={selectedBranchId}
                label="Branch"
                onChange={(event) => setSelectedBranchId(String(event.target.value || '').trim())}
                disabled={branchesLoading}
              >
                {branches.map((branch) => (
                  <MenuItem key={branch.id} value={branch.id}>
                    {branch.id} - {branch.city}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel id="mapping-allocation-level-label">Allocation Precision</InputLabel>
              <Select
                labelId="mapping-allocation-level-label"
                value={String(allocationLevel)}
                label="Allocation Precision"
                onChange={(event) => {
                  const nextLevel = Number(event.target.value);
                  if (!Number.isFinite(nextLevel) || nextLevel <= 0) {
                    return;
                  }
                  const normalizedLevel = Math.round(nextLevel);
                  setAllocationLevel(normalizedLevel);
                  if (selectedBranchId) {
                    void loadPockets(selectedBranchId, normalizedLevel);
                  }
                }}
                disabled={!selectedBranchId || branchesLoading || employeesLoading || pocketsLoading}
              >
                {ALLOCATION_LEVEL_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={String(option.value)}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={() => {
                if (!selectedBranchId) {
                  void loadBranches();
                  return;
                }
                void refreshBranchData(selectedBranchId);
              }}
              disabled={branchesLoading || employeesLoading || pocketsLoading}
            >
              Refresh Mapping
            </Button>

            <Button
              variant="outlined"
              onClick={() => setBulkDialogOpen(true)}
              disabled={!selectedBranchId}
            >
              Bulk Upload
            </Button>

            <Button
              variant="outlined"
              onClick={() => void handleDownloadEmployeeTemplate()}
            >
              Download Template
            </Button>

            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={handleDownloadExistingAllocation}
              disabled={!selectedBranchId || pocketRows.length === 0 || pocketsLoading}
            >
              Download Allocation
            </Button>

            <Button
              variant="contained"
              startIcon={<AutoFixHighIcon />}
              onClick={() => void handleRunAllocation()}
              disabled={allocationRunning || !selectedBranchId || !hasActiveEmployees}
            >
              {allocationRunning ? 'Running Auto-Allocation...' : 'Run Auto-Allocation'}
            </Button>
          </Stack>

          {!hasActiveEmployees && selectedBranchId && (
            <Alert severity="warning" sx={{ mt: 1.5 }}>
              Please add active employees to this branch before running allocation.
            </Alert>
          )}
        </Paper>

        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Branch -&gt; Employee Mapping
            </Typography>

            {employeeFormError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {employeeFormError}
              </Alert>
            )}

            <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2}>
              <Stack spacing={1.2} sx={{ minWidth: { lg: 320 }, flex: { lg: '0 0 360px' } }}>
                <TextField
                  size="small"
                  label="Employee ID"
                  value={employeeForm.employeeId}
                  onChange={(event) => setEmployeeForm((previous) => ({
                    ...previous,
                    employeeId: event.target.value
                  }))}
                  disabled={!selectedBranchId || employeeFormSaving}
                />
                <TextField
                  size="small"
                  label="Name"
                  value={employeeForm.name}
                  onChange={(event) => setEmployeeForm((previous) => ({
                    ...previous,
                    name: event.target.value
                  }))}
                  disabled={!selectedBranchId || employeeFormSaving}
                />
                <Stack direction="row" spacing={1.2} alignItems="center">
                  <Box
                    component="label"
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.8,
                      fontSize: 13,
                      color: 'text.secondary'
                    }}
                  >
                    Color
                    <input
                      type="color"
                      value={normalizeHexColor(employeeForm.colorCode, nextAutoColor || DEFAULT_COLOR)}
                      disabled={!selectedBranchId || employeeFormSaving}
                      onChange={(event) => setEmployeeForm((previous) => ({
                        ...previous,
                        colorCode: normalizeHexColor(
                          event.target.value,
                          nextAutoColor || DEFAULT_COLOR
                        )
                      }))}
                      style={{ width: 38, height: 28, padding: 0 }}
                    />
                  </Box>
                  <TextField
                    size="small"
                    label="Max Capacity"
                    type="number"
                    value={employeeForm.maxCapacity}
                    onChange={(event) => setEmployeeForm((previous) => ({
                      ...previous,
                      maxCapacity: event.target.value
                    }))}
                    onFocus={() => setMaxCapacityEdited(true)}
                    disabled={!selectedBranchId || employeeFormSaving}
                    inputProps={{ min: 0, step: 1 }}
                    sx={{ width: 150 }}
                  />
                </Stack>
                <Stack direction="row" spacing={1.2} alignItems="center" sx={{ mt: -0.3 }}>
                  <Typography variant="caption" color="text.secondary">
                    Calculated: {suggestedMaxCapacity} = {totalBranchCustomers} customers / {Math.max(activeEmployees.length + (employeeForm.id ? 0 : 1), 1)} employees
                  </Typography>
                  <Button
                    size="small"
                    onClick={() => {
                      setEmployeeForm((previous) => ({
                        ...previous,
                        maxCapacity: String(suggestedMaxCapacity)
                      }));
                      setMaxCapacityEdited(false);
                    }}
                    disabled={!selectedBranchId || employeeFormSaving}
                  >
                    Use Calculated
                  </Button>
                </Stack>
                <FormControlLabel
                  control={(
                    <Checkbox
                      checked={employeeForm.isActive}
                      onChange={(event) => setEmployeeForm((previous) => ({
                        ...previous,
                        isActive: event.target.checked
                      }))}
                      disabled={!selectedBranchId || employeeFormSaving}
                    />
                  )}
                  label="Active"
                />
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="contained"
                    onClick={() => void handleSaveEmployee()}
                    disabled={!selectedBranchId || employeeFormSaving}
                  >
                    {employeeFormSaving
                      ? 'Saving...'
                      : employeeForm.id
                        ? 'Update Employee'
                        : 'Add Employee'}
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={() => {
                      setEmployeeForm({
                        ...createEmptyForm(),
                        colorCode: nextAutoColor,
                        maxCapacity: String(suggestedMaxCapacity)
                      });
                      setMaxCapacityEdited(false);
                    }}
                    disabled={employeeFormSaving}
                  >
                    Reset
                  </Button>
                </Stack>
              </Stack>

              <TableContainer sx={{ maxHeight: 280, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Employee ID</TableCell>
                      <TableCell>Name</TableCell>
                      <TableCell align="right">Allocated Pockets</TableCell>
                      <TableCell align="right">Allocated Customers</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {employees.map((employee) => (
                      <TableRow key={employee.id}>
                        <TableCell>{employee.employeeId}</TableCell>
                        <TableCell>{employee.name}</TableCell>
                        <TableCell align="right">{Number(employee.allocatedPocketsCount || 0)}</TableCell>
                        <TableCell align="right">{Number(employee.allocatedCustomerCount || 0)}</TableCell>
                        <TableCell>{employee.isActive ? 'Active' : 'Inactive'}</TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={0.75}>
                            <Button
                              size="small"
                              onClick={() => {
                                setEmployeeForm({
                                  id: employee.id,
                                  employeeId: employee.employeeId,
                                  name: employee.name,
                                  colorCode: employee.colorCode,
                                  maxCapacity: employee.maxCapacity === null ? '' : String(employee.maxCapacity),
                                  isActive: employee.isActive
                                });
                                setMaxCapacityEdited(true);
                              }}
                              disabled={employeeRowActionId === employee.id}
                            >
                              Edit
                            </Button>
                            {employee.isActive ? (
                              <Button
                                size="small"
                                color="error"
                                onClick={() => void handleDeactivateEmployee(employee.id)}
                                disabled={employeeRowActionId === employee.id}
                              >
                                Deactivate
                              </Button>
                            ) : (
                              <Button
                                size="small"
                                color="success"
                                onClick={() => void handleActivateEmployee(employee.id)}
                                disabled={employeeRowActionId === employee.id}
                              >
                                Activate
                              </Button>
                            )}
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))}
                    {employees.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} align="center">
                          {employeesLoading ? 'Loading employees...' : 'No employees found for this branch.'}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Employee -&gt; Pocket Mapping
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Assign each pocket to an active employee for the selected branch.
            </Typography>

            <TableContainer sx={{ maxHeight: 340, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <Table stickyHeader size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Pocket ID</TableCell>
                    <TableCell>Total Customers</TableCell>
                    <TableCell>Assigned Employee</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pocketRows.map((row) => (
                    <TableRow key={row.pocketId}>
                      <TableCell>{row.pocketId}</TableCell>
                      <TableCell>{row.customerCount}</TableCell>
                      <TableCell>
                        <FormControl size="small" fullWidth>
                          <Select
                            value={row.employeeId || ''}
                            onChange={(event) => {
                              const nextEmployeeId = String(event.target.value || '').trim();
                              if (nextEmployeeId) {
                                void handleManualPocketAssign(row.pocketId, nextEmployeeId);
                              }
                            }}
                            disabled={!hasActiveEmployees || tableAssignPocketId === row.pocketId}
                          >
                            {activeEmployees.map((employee) => (
                              <MenuItem key={employee.id} value={employee.id}>
                                {employee.name} ({employee.employeeId})
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </TableCell>
                    </TableRow>
                  ))}
                  {pocketRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} align="center">
                        {pocketsLoading ? 'Loading pocket assignments...' : 'No pocket assignments found for this branch.'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </Stack>

      <Dialog
        open={bulkDialogOpen}
        onClose={() => {
          if (bulkUploading) {
            return;
          }
          setBulkDialogOpen(false);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Bulk Upload Employees</DialogTitle>
        <DialogContent>
          <Stack spacing={1.25} sx={{ pt: 1 }}>
            <Alert severity="info">
              Upload `.xlsx` / `.xls` file with columns: `branch_id`, `employee_id`, `name`, `color_code`, `max_capacity`, `is_active`.
              If `color_code` is blank, the system auto-assigns colors in sequence:
              red, green, brown, dark yellow, black, white.
            </Alert>

            <Button
              variant="outlined"
              component="label"
              disabled={bulkUploading}
            >
              Select Upload File
              <input
                hidden
                type="file"
                accept=".xlsx,.xls"
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  setBulkFile(file);
                }}
              />
            </Button>

            {bulkFile && (
              <Typography variant="body2">
                Selected: {bulkFile.name}
              </Typography>
            )}

            <FormControlLabel
              control={(
                <Checkbox
                  checked={bulkUseSelectedBranch}
                  onChange={(event) => setBulkUseSelectedBranch(event.target.checked)}
                  disabled={bulkUploading || !selectedBranchId}
                />
              )}
              label={`Override file branch_id with selected branch (${selectedBranchId || '-'})`}
            />

            {bulkResultSummary && (
              <Alert severity="success">
                {bulkResultSummary}
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setBulkDialogOpen(false)}
            disabled={bulkUploading}
          >
            Close
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleBulkUpload()}
            disabled={!bulkFile || bulkUploading}
          >
            {bulkUploading ? 'Uploading...' : 'Upload'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
