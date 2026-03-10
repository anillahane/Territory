import axios, { AxiosInstance, AxiosError } from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

export type BranchTerritoriesResponse = {
  requestedSource?: string;
  resolvedSource?: string;
  fallbackApplied?: boolean;
  fallbackReason?: string | null;
  repairRecommended?: boolean;
  [key: string]: unknown;
};

export interface AdminTerritoryHealthSummary {
  branch_id: string;
  branch_name: string;
  is_grid_generated: boolean;
  needs_repair: boolean;
  assigned_pockets_count: number;
}

export interface AdminTerritoryHealthResponse {
  generatedAt?: string;
  summary?: {
    totalBranches?: number;
    branchesNeedingRepair?: number;
    branchesWithGeneratedGrid?: number;
  };
  branches: AdminTerritoryHealthSummary[];
}

export interface GridCellRecord {
  pocket_id: string;
  level_m: number;
  min_lat: number | null;
  max_lat: number | null;
  min_lng: number | null;
  max_lng: number | null;
  allocated_employee_id: number | null;
}

export interface GridCellsResponse {
  data: GridCellRecord[];
  total: number;
  page: number;
  limit: number;
}

export interface GlobalReallocationBranchResult {
  branch_id: string;
  status: 'success' | 'failed';
  duration_ms: number;
  assignmentLevelMeters?: number;
  totalPockets?: number;
  totalCustomers?: number;
  isolatedPocketAssignments?: number;
  error_code?: string;
  error_message?: string;
  [key: string]: unknown;
}

export interface GlobalReallocationResponse {
  generatedAt?: string;
  levelMeters: number;
  totalBranches: number;
  successCount: number;
  failedCount: number;
  latestJobId?: string | null;
  branches: GlobalReallocationBranchResult[];
}

class ApiService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_URL,
      timeout: 120000, // 2 minutes for large file uploads
    });

    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        // Add any auth tokens here if needed
        return config;
      },
      (error) => Promise.reject(error)
    );

    // --- ORIGINAL BACKUP ---
    // // Response interceptor
    // this.client.interceptors.response.use(
    //   (response) => response,
    //   (error: AxiosError) => {
    //     const responseData = error.response?.data as Record<string, any> | undefined;
    //     const errorMessage =
    //       responseData?.error ||
    //       responseData?.message ||
    //       error.message ||
    //       'Request failed';
    //
    //     if (error.response) {
    //       // Server responded with error
    //       console.error('API Error:', responseData);
    //     } else if (error.request) {
    //       // Request made but no response
    //       console.error('Network Error:', error.message);
    //     }
    //
    //     const normalizedError = new Error(errorMessage) as Error & {
    //       status?: number;
    //       code?: string;
    //       details?: unknown;
    //       originalError?: AxiosError;
    //     };
    //     normalizedError.status = error.response?.status;
    //     normalizedError.code = (responseData?.code as string | undefined) || error.code;
    //     normalizedError.details = responseData?.details;
    //     normalizedError.originalError = error;
    //
    //     return Promise.reject(normalizedError);
    //   }
    // );
    // Response interceptor
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        const responseData = error.response?.data as Record<string, any> | undefined;
        const responseStatus = error.response?.status;
        const retryAfterHeader = error.response?.headers?.['retry-after'];
        const retryAfterSeconds = Number(
          Array.isArray(retryAfterHeader) ? retryAfterHeader[0] : retryAfterHeader
        );
        const isRateLimited = responseStatus === 429;
        const rateLimitMessage = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? `Too many requests. Please retry in ${Math.round(retryAfterSeconds)} seconds.`
          : 'Too many requests. Please wait a moment and retry.';
        const errorMessage = isRateLimited
          ? rateLimitMessage
          : (
            responseData?.error ||
            responseData?.message ||
            error.message ||
            'Request failed'
          );

        if (error.response) {
          // Server responded with error
          console.error('API Error:', responseData);
        } else if (error.request) {
          // Request made but no response
          console.error('Network Error:', error.message);
        }

        const normalizedError = new Error(errorMessage) as Error & {
          status?: number;
          code?: string;
          details?: unknown;
          originalError?: AxiosError;
        };
        normalizedError.status = responseStatus;
        normalizedError.code = (responseData?.code as string | undefined) || error.code;
        normalizedError.details = responseData?.details;
        normalizedError.originalError = error;

        return Promise.reject(normalizedError);
      }
    );
  }

  // Configuration endpoints
  async getConfig() {
    const response = await this.client.get('/config');
    return response.data;
  }

  async updateConfig(config: any) {
    const response = await this.client.put('/config', config);
    return response.data;
  }

  async getConfigHistory(limit = 10, offset = 0) {
    const response = await this.client.get('/config/history', {
      params: { limit, offset },
    });
    return response.data;
  }

  async clearSystemData(payload: {
    clearCustomerData?: boolean;
    clearBranchData?: boolean;
    clearPocketData?: boolean;
  }) {
    const response = await this.client.post('/config/clear-data', payload);
    return response.data;
  }

  // Branch endpoints
  async getBranches(params?: {
    limit?: number;
    offset?: number;
    search?: string;
    bbox?: string;
  }) {
    const response = await this.client.get('/branches', { params });
    return response.data;
  }

  async getBranch(id: string) {
    const response = await this.client.get(`/branches/${id}`);
    return response.data;
  }

  async createBranch(branch: any) {
    const response = await this.client.post('/branches', branch);
    return response.data;
  }

  async updateBranch(id: string, branch: any) {
    const response = await this.client.put(`/branches/${id}`, branch);
    return response.data;
  }

  async deleteBranch(id: string) {
    const response = await this.client.delete(`/branches/${id}`);
    return response.data;
  }

  async uploadBranches(file: File, uploadMode: 'overwrite' | 'add' = 'overwrite') {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('uploadMode', uploadMode);
    // Let the browser set multipart boundary automatically.
    const response = await this.client.post('/branches/upload', formData);
    return response.data;
  }

  async getJobStatus(jobId: string) {
    const response = await this.client.get(`/jobs/${jobId}`);
    return response.data;
  }

  async listJobs(params?: { status?: string; type?: string; limit?: number }) {
    const response = await this.client.get('/jobs', { params });
    return response.data;
  }

  async retryJob(jobId: string) {
    const response = await this.client.post(`/jobs/${jobId}/retry`);
    return response.data;
  }

  async deleteJob(jobId: string) {
    const response = await this.client.delete(`/jobs/${jobId}`);
    return response.data;
  }

  async bulkDeleteJobs(params: { jobIds?: string[]; status?: string }) {
    const response = await this.client.post('/jobs/bulk-delete', params);
    return response.data;
  }

  async exportBranches() {
    const response = await this.client.get('/branches/export', {
      responseType: 'blob',
    });
    return response.data;
  }

  // Pocket ID endpoints
  async encodePocketId(lat: number, lon: number) {
    const response = await this.client.post('/pocket/encode', { lat, lon });
    return response.data;
  }

  async decodePocketId(pocketId: string) {
    const response = await this.client.post('/pocket/decode', { pocketId });
    return response.data;
  }

  async validatePocketId(pocketId: string) {
    const response = await this.client.post('/pocket/validate', { pocketId });
    return response.data;
  }

  // Nearest branch endpoints
  async findNearest(lat: number, lon: number, limit = 5, maxDistance?: number) {
    const response = await this.client.post('/nearest', {
      lat,
      lon,
      limit,
      maxDistance,
    });
    return response.data;
  }

  async findNearestFallback(lat: number, lon: number, limit = 5, maxDistance?: number) {
    const response = await this.client.post('/nearest/fallback', {
      lat,
      lon,
      limit,
      maxDistance,
    });
    return response.data;
  }

  async findWithinPocket(pocketId: string) {
    const response = await this.client.get(`/nearest/within-pocket/${pocketId}`);
    return response.data;
  }

  // Batch processing endpoints
  async batchEncode(file: File, replaceExisting = false) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('replaceExisting', String(replaceExisting));
    
    try {
      // Try as JSON first (new non-blocking behavior)
      const response = await this.client.post('/batch/encode', formData);
      return response.data;
    } catch (error: any) {
      const axiosError = error?.originalError || error;
      // If it's a blob response (shouldn't happen anymore), handle it
      if (axiosError.response?.headers['content-type']?.includes('application/vnd.openxmlformats')) {
        return axiosError.response.data;
      }
      throw error;
    }
  }

  async getBatchStatus(jobId: string) {
    const response = await this.client.get(`/batch/status/${jobId}`);
    return response.data;
  }

  async downloadBatchResult(jobId: string) {
    const response = await this.client.get(`/batch/download/${jobId}`, {
      responseType: 'blob',
    });
    return response.data;
  }

  async getBatchTerritories(jobId: string) {
    const response = await this.client.get(`/batch/territories/job/${jobId}`);
    return response.data;
  }

  // --- ORIGINAL BACKUP ---
  // async getBranchTerritories(branchId: string, params?: {
  //   levelM?: number;
  //   level_m?: number;
  //   useExistingTerritoriesOnly?: boolean;
  // }) {
  async getBranchTerritories(branchId: string, params?: {
    levelM?: number;
    level_m?: number;
    useExistingTerritoriesOnly?: boolean;
  }): Promise<BranchTerritoriesResponse> {
    const levelValue = params?.level_m ?? params?.levelM;
    const response = await this.client.get(`/batch/territories/${encodeURIComponent(branchId)}`, {
      params: {
        level_m: levelValue,
        levelM: levelValue,
        useExistingTerritoriesOnly: params?.useExistingTerritoriesOnly
      }
    });
    return response.data;
  }

  async getBranchEmployees(branchId: string) {
    const response = await this.client.get(`/territories/employees/${encodeURIComponent(branchId)}`);
    return response.data;
  }

  async getEmployeesByBranch(branchId: string, params?: { includeInactive?: boolean }) {
    const response = await this.client.get(`/employees/branch/${encodeURIComponent(branchId)}`, {
      params: {
        includeInactive: params?.includeInactive
      }
    });
    return response.data;
  }

  async createEmployee(payload: {
    branch_id: string;
    employee_id: string;
    name: string;
    color_code: string;
    max_capacity?: number | null;
    is_active?: boolean;
  }) {
    const response = await this.client.post('/employees', payload);
    return response.data;
  }

  async updateEmployee(
    id: string,
    payload: {
      employee_id?: string;
      name?: string;
      color_code?: string;
      max_capacity?: number | null;
      is_active?: boolean;
    }
  ) {
    const response = await this.client.put(`/employees/${encodeURIComponent(id)}`, payload);
    return response.data;
  }

  async deleteEmployee(id: string) {
    const response = await this.client.delete(`/employees/${encodeURIComponent(id)}`);
    return response.data;
  }

  async bulkUploadEmployees(file: File, params?: { branch_id?: string }) {
    const formData = new FormData();
    formData.append('file', file);
    if (params?.branch_id) {
      formData.append('branch_id', params.branch_id);
    }
    const response = await this.client.post('/employees/bulk', formData);
    return response.data;
  }

  async downloadEmployeeTemplate() {
    const response = await this.client.get('/employees/template', {
      responseType: 'blob'
    });
    return response.data;
  }

  async getTerritoryVisualization(params?: {
    mode?: string;
    branchIds?: string[];
    jobId?: string;
    customerView?: string;
    employeeCount?: number;
  }) {
    const response = await this.client.get('/batch/territories/visualization', {
      params: {
        mode: params?.mode,
        jobId: params?.jobId,
        customerView: params?.customerView,
        employeeCount: params?.employeeCount,
        branchIds: params?.branchIds && params.branchIds.length > 0
          ? params.branchIds.join(',')
          : undefined
      }
    });
    return response.data;
  }

  // --- ORIGINAL BACKUP ---
  // async assignEmployeeTerritories(branchId: string, params?: {
  //   tolerance?: number;
  //   employeeCount?: number;
  //   useExistingTerritoriesOnly?: boolean;
  //   levelM?: number;
  //   level_m?: number;
  // }) {
  async assignEmployeeTerritories(branchId: string, params?: {
    tolerance?: number;
    employeeCount?: number;
    useExistingTerritoriesOnly?: boolean;
    forceRepair?: boolean;
    levelM?: number;
    level_m?: number;
  }) {
    const levelValue = params?.level_m ?? params?.levelM;
    const response = await this.client.post(`/batch/territories/assign/${encodeURIComponent(branchId)}`, {
      tolerance: params?.tolerance,
      employeeCount: params?.employeeCount,
      useExistingTerritoriesOnly: params?.useExistingTerritoriesOnly,
      forceRepair: params?.forceRepair,
      level_m: levelValue,
      levelM: levelValue
    });
    return response.data;
  }

  // --- ORIGINAL BACKUP ---
  // async runTerritoryAllocation(branchId: string, params?: {
  //   tolerance?: number;
  //   useExistingTerritoriesOnly?: boolean;
  //   levelM?: number;
  //   level_m?: number;
  // }) {
  async runTerritoryAllocation(branchId: string, params?: {
    tolerance?: number;
    useExistingTerritoriesOnly?: boolean;
    forceRepair?: boolean;
    levelM?: number;
    level_m?: number;
  }) {
    const levelValue = params?.level_m ?? params?.levelM;
    const response = await this.client.post(
      `/batch/territories/run-allocation/${encodeURIComponent(branchId)}`,
      {
        tolerance: params?.tolerance,
        useExistingTerritoriesOnly: params?.useExistingTerritoriesOnly,
        forceRepair: params?.forceRepair,
        level_m: levelValue,
        levelM: levelValue
      }
    );
    return response.data;
  }

  // --- ORIGINAL BACKUP ---
  // async runBranchTerritoryAllocation(branchId: string, params?: {
  //   tolerance?: number;
  //   useExistingTerritoriesOnly?: boolean;
  //   levelM?: number;
  //   level_m?: number;
  // }) {
  async runBranchTerritoryAllocation(branchId: string, params?: {
    tolerance?: number;
    useExistingTerritoriesOnly?: boolean;
    forceRepair?: boolean;
    levelM?: number;
    level_m?: number;
  }) {
    return this.runTerritoryAllocation(branchId, params);
  }

  async reassignEmployeeTerritories(branchId: string, payload: {
    employeeId: string;
    gridCellIds: string[];
    levelM?: number;
    level_m?: number;
  }) {
    const levelValue = payload.level_m ?? payload.levelM;
    const response = await this.client.post(
      `/batch/territories/reassign/${encodeURIComponent(branchId)}`,
      {
        ...payload,
        level_m: levelValue,
        levelM: levelValue
      }
    );
    return response.data;
  }

  async assignManualTerritory(payload: {
    branchId: string;
    employeeId: string;
    gridCellIds: string[];
  }) {
    const response = await this.client.post('/batch/territories/assign-manual', payload);
    return response.data;
  }

  async assignManualPocket(payload: {
    branchId: string;
    pocketId: string;
    newEmployeeId: string;
    levelM?: number;
    level_m?: number;
  }) {
    const levelValue = payload.level_m ?? payload.levelM;
    // --- ORIGINAL BACKUP ---
    // const response = await this.client.put('/territories/assign-manual', {
    //   ...payload,
    //   level_m: levelValue,
    //   levelM: levelValue
    // });
    const response = await this.client.post('/batch/territories/assign-manual', {
      branchId: payload.branchId,
      employeeId: payload.newEmployeeId,
      gridCellIds: [payload.pocketId],
      level_m: levelValue,
      levelM: levelValue
    });
    return response.data;
  }

  // Template endpoints
  async downloadBatchTemplate() {
    const response = await this.client.get('/templates/batch-processing', {
      responseType: 'blob',
    });
    return response.data;
  }

  async downloadBranchTemplate() {
    const response = await this.client.get('/templates/branch-upload', {
      responseType: 'blob',
    });
    return response.data;
  }

  // Health check
  // --- ORIGINAL BACKUP ---
  // async healthCheck() {
  //   const response = await axios.get(`${API_URL.replace('/api/v1', '')}/health`);
  //   return response.data;
  // }
  async getAdminTerritoryHealth(): Promise<AdminTerritoryHealthResponse> {
    const response = await this.client.get('/admin/territory-health');
    return response.data;
  }

  async getGridCells(page = 1, limit = 50): Promise<GridCellsResponse> {
    const response = await this.client.get('/admin/grid-cells', {
      params: { page, limit }
    });
    return response.data;
  }

  async runGlobalReallocation(levelMeters = 5000): Promise<GlobalReallocationResponse> {
    const response = await this.client.post('/admin/batch-reallocate-all', {
      levelMeters
    });
    return response.data;
  }

  async healthCheck() {
    const response = await axios.get(`${API_URL.replace('/api/v1', '')}/health`);
    return response.data;
  }
}

export default new ApiService();
