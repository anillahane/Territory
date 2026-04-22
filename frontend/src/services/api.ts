import axios, { AxiosInstance, AxiosError } from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';
const AUTH_STORAGE_KEY = 'territory-auth';

export type BranchListParams = {
  limit?: number;
  offset?: number;
  search?: string;
};

export type JobsListParams = {
  status?: string;
  type?: string;
  limit?: number;
};

export type TerritoryVisualizationParams = {
  mode?: string;
  branchIds?: string[];
  jobId?: string;
  customerView?: string;
};

export const queryKeys = {
  config: ['config'] as const,
  configHistory: (limit = 10, offset = 0) => ['config-history', limit, offset] as const,
  branches: (params: BranchListParams = {}) => ['branches', params] as const,
  jobs: (params: JobsListParams = {}) => ['jobs', params] as const,
  job: (jobId: string) => ['job', jobId] as const,
  territoryVisualization: (params: TerritoryVisualizationParams = {}) =>
    ['territory-visualization', params] as const,
};

export type AuthUser = {
  id: string;
  email: string;
  role: 'admin' | 'editor' | 'viewer';
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
};

export type JobsStreamPayload = {
  jobs: Array<Record<string, any>>;
  total: number;
};

type JobsStreamOptions = {
  status?: string;
  type?: string;
  limit?: number;
  activeJobId?: string | null;
  onOpen?: () => void;
  onJobs: (payload: JobsStreamPayload) => void;
  onError?: (error: Error) => void;
};

const readStoredSession = (): AuthSession | null => {
  const rawValue = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as AuthSession;
  } catch {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    return null;
  }
};

export const getStoredSession = (): AuthSession | null => readStoredSession();

export const setStoredSession = (session: AuthSession) => {
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
};

export const clearStoredSession = () => {
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
};

export const isAuthenticated = () => Boolean(readStoredSession()?.accessToken);

const redirectToLogin = () => {
  if (window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
};

class ApiService {
  private client: AxiosInstance;
  private refreshPromise: Promise<AuthSession> | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_URL,
      timeout: 120000, // 2 minutes for large file uploads
    });

    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        const session = readStoredSession();
        if (session?.accessToken) {
          config.headers = config.headers || {};
          config.headers.Authorization = `Bearer ${session.accessToken}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const responseData = error.response?.data as Record<string, any> | undefined;
        const responseStatus = error.response?.status;
        const originalRequest = error.config as (typeof error.config & { _retry?: boolean }) | undefined;
        const errorMessage =
          responseData?.error ||
          responseData?.message ||
          error.message ||
          'Request failed';

        if (responseStatus === 401 && originalRequest && !originalRequest._retry) {
          const existingSession = readStoredSession();
          if (existingSession?.refreshToken) {
            try {
              originalRequest._retry = true;
              if (!this.refreshPromise) {
                this.refreshPromise = this.refreshAuth(existingSession.refreshToken)
                  .finally(() => {
                    this.refreshPromise = null;
                  });
              }

              const refreshedSession = await this.refreshPromise;
              originalRequest.headers = originalRequest.headers || {};
              originalRequest.headers.Authorization = `Bearer ${refreshedSession.accessToken}`;
              return this.client(originalRequest);
            } catch {
              clearStoredSession();
              redirectToLogin();
            }
          } else {
            clearStoredSession();
            redirectToLogin();
          }
        }

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

  async login(email: string, password: string) {
    const response = await this.client.post('/auth/login', { email, password });
    const session = response.data as AuthSession;
    setStoredSession(session);
    return session;
  }

  async refreshAuth(refreshToken: string) {
    const response = await axios.post(`${API_URL}/auth/refresh`, { refreshToken }, {
      timeout: 120000,
    });
    const session = response.data as AuthSession;
    setStoredSession(session);
    return session;
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
  async getBranches(params?: BranchListParams) {
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

  async listJobs(params?: JobsListParams) {
    const response = await this.client.get('/jobs', { params });
    return response.data;
  }

  async subscribeToJobsStream(options: JobsStreamOptions) {
    if (
      typeof window === 'undefined'
      || typeof window.fetch !== 'function'
      || typeof TextDecoder === 'undefined'
    ) {
      return null;
    }

    const session = readStoredSession();
    if (!session?.accessToken) {
      return null;
    }

    const streamUrl = new URL(`${API_URL.replace(/\/$/, '')}/jobs/stream`, window.location.origin);
    if (options.status) {
      streamUrl.searchParams.set('status', options.status);
    }
    if (options.type) {
      streamUrl.searchParams.set('type', options.type);
    }
    if (options.limit !== undefined) {
      streamUrl.searchParams.set('limit', String(options.limit));
    }
    if (options.activeJobId) {
      streamUrl.searchParams.set('activeJobId', options.activeJobId);
    }

    const controller = new AbortController();
    const response = await fetch(streamUrl.toString(), {
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${session.accessToken}`,
      },
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      controller.abort();
      throw new Error(`Job stream request failed with status ${response.status}`);
    }

    options.onOpen?.();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const handleEventBlock = (eventBlock: string) => {
      const normalizedBlock = eventBlock.trim();
      if (!normalizedBlock || normalizedBlock.startsWith(':')) {
        return;
      }

      let eventName = 'message';
      const dataLines: string[] = [];

      normalizedBlock.split('\n').forEach((line) => {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
          return;
        }

        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trim());
        }
      });

      if (eventName !== 'jobs' || dataLines.length === 0) {
        return;
      }

      options.onJobs(JSON.parse(dataLines.join('\n')) as JobsStreamPayload);
    };

    const pumpEvents = async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
          const eventBlocks = buffer.split('\n\n');
          buffer = eventBlocks.pop() || '';
          eventBlocks.forEach(handleEventBlock);
        }

        const trailingBuffer = buffer.trim();
        if (trailingBuffer) {
          handleEventBlock(trailingBuffer);
        }

        if (!controller.signal.aborted) {
          options.onError?.(new Error('Job stream disconnected'));
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          options.onError?.(error instanceof Error ? error : new Error('Job stream failed'));
        }
      }
    };

    void pumpEvents();

    return () => {
      controller.abort();
    };
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

  async getTerritoryVisualization(params?: TerritoryVisualizationParams) {
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
