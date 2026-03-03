import axios, { AxiosInstance, AxiosError } from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

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

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        const responseData = error.response?.data as Record<string, any> | undefined;
        const errorMessage =
          responseData?.error ||
          responseData?.message ||
          error.message ||
          'Request failed';

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
        normalizedError.status = error.response?.status;
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

  // Branch endpoints
  async getBranches(params?: { limit?: number; offset?: number; search?: string }) {
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
    const response = await this.client.get(`/batch/territories/${jobId}`);
    return response.data;
  }

  async getTerritoryVisualization(params?: {
    mode?: string;
    branchIds?: string[];
    jobId?: string;
    customerView?: string;
  }) {
    const response = await this.client.get('/batch/territories/visualization', {
      params: {
        mode: params?.mode,
        jobId: params?.jobId,
        customerView: params?.customerView,
        branchIds: params?.branchIds && params.branchIds.length > 0
          ? params.branchIds.join(',')
          : undefined
      }
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
  async healthCheck() {
    const response = await axios.get(`${API_URL.replace('/api/v1', '')}/health`);
    return response.data;
  }
}

export default new ApiService();
