import axios, { AxiosError, type AxiosInstance } from 'axios';
import type {
  TerritoryCustomerView,
  TerritoryMode,
  TerritoryVisualizationResponse,
} from '../features/dashboard/types';
import { getErrorMessage, isRecord } from '../utils/errors';
import logger from '../utils/logger';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';
const AUTH_STORAGE_KEY = 'territory-auth';
const AUTH_SESSION_EVENT = 'territory-auth:changed';

type ApiErrorPayload = {
  error?: string;
  message?: string;
  code?: string;
  details?: unknown;
};

export type ApiRequestError = Error & {
  status?: number;
  code?: string;
  details?: unknown;
  originalError?: AxiosError<ApiErrorPayload>;
};

export type PaginationResponse = {
  total: number;
  limit: number;
  offset: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

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
  mode?: TerritoryMode;
  branchIds?: string[];
  jobId?: string;
  customerView?: TerritoryCustomerView;
};

export type Role = 'admin' | 'editor' | 'viewer';

export type AuthUser = {
  id: string;
  email: string;
  role: Role;
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
};

export type ConfigRequest = {
  originLat: number;
  originLon: number;
  alphabet: string;
  gridLevels?: number[];
};

export type ConfigResponse = {
  id: number;
  originLat: number;
  originLon: number;
  alphabet: string;
  gridLevels: number[];
  version: number;
  createdAt?: string;
  updatedAt: string;
};

export type ConfigUpdateResponse = {
  message: string;
  config: ConfigResponse;
};

export type ConfigHistoryEntry = {
  id: number;
  configId: number;
  originLat: number;
  originLon: number;
  alphabet: string;
  gridLevels: number[];
  version: number;
  changedAt: string;
};

export type ConfigHistoryResponse = {
  history: ConfigHistoryEntry[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
};

export type BranchRecord = {
  id: string;
  city: string | null;
  lat: number;
  lon: number;
  pocketId: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CreateBranchRequest = {
  id: string;
  city: string;
  lat: number;
  lon: number;
};

export type UpdateBranchRequest = {
  city: string;
  lat: number;
  lon: number;
};

export type BranchListResponse = {
  branches: BranchRecord[];
  pagination: PaginationResponse;
};

export type BranchMutationResponse = {
  message: string;
  branch: BranchRecord;
};

export type BranchDeleteResponse = {
  message: string;
  id: string;
};

export type BranchUploadMode = 'overwrite' | 'add';

export type BranchUploadResponse = {
  message: string;
  jobId: string;
  status: 'pending' | string;
  fileName: string;
  rowCount: number;
  uploadMode: BranchUploadMode;
  confirmWipeAll: boolean;
  statusUrl: string;
};

export type JobType = 'batch-process' | 'branch-upload' | string;
export type JobStatus = 'pending' | 'active' | 'completed' | 'failed' | string;

export type JobResultSummary = {
  inserted?: number;
  replaced?: number;
  skippedExisting?: number;
  errors?: number;
  mode?: BranchUploadMode | string;
};

export type JobResult = Record<string, unknown> & {
  summary?: JobResultSummary;
};

export type JobData = Record<string, unknown> & {
  fileName?: string;
  rowCount?: number;
  totalAccounts?: number;
  totalPockets?: number;
  territoryUrl?: string | null;
  pocketStats?: Record<string, number>;
  mappingsPersisted?: number;
};

export type JobRecord = {
  jobId: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  total: number;
  resultUrl?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string | null;
  completedAt?: string | null;
  data: JobData;
  result?: JobResult | null;
};

export type JobsStreamPayload = {
  jobs: JobRecord[];
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

export type DeleteJobResponse = {
  message: string;
  jobId: string;
};

export type RetryJobResponse = {
  message: string;
  jobId: string;
};

export type BulkDeleteJobsRequest = {
  jobIds?: string[];
  status?: string;
};

export type BulkDeleteJobsResponse = {
  message: string;
  deletedCount: number;
};

export type PocketIndex = {
  level: number;
  levelSize: number;
  row: number;
  col: number;
};

type PocketCornerCoordinates = {
  lat: number;
  lon: number;
};

export type PocketEncodeResponse = {
  pocketId: string;
  input: {
    lat: number;
    lon: number;
  };
  meters: {
    x: number;
    y: number;
  };
  indices: PocketIndex[];
  breakdown: Array<{
    level: number;
    levelSize: number;
    code: string;
    row: number;
    col: number;
  }>;
};

export type PocketDecodeResponse = {
  pocketId: string;
  centerLat: number;
  centerLon: number;
  center: PocketCornerCoordinates;
  corners: {
    sw: PocketCornerCoordinates;
    ne: PocketCornerCoordinates;
    nw: PocketCornerCoordinates;
    se: PocketCornerCoordinates;
    southwest: PocketCornerCoordinates;
    northeast: PocketCornerCoordinates;
    northwest: PocketCornerCoordinates;
    southeast: PocketCornerCoordinates;
  };
  indices: PocketIndex[];
  cellSize: number;
};

export type PocketValidationResponse = {
  valid: boolean;
  pocketId: string;
  levels?: number;
  error?: string;
};

export type NearestBranchRecord = {
  id: string;
  city: string;
  lat: number;
  lon: number;
  pocketId: string;
  distance: number;
  distanceKm: string;
};

export type NearestBranchesResponse = {
  query: {
    lat: number;
    lon: number;
    limit: number;
    maxDistance?: number;
  };
  count: number;
  branches: NearestBranchRecord[];
  warning?: string;
};

export type WithinPocketResponse = {
  pocketId: string;
  count: number;
  branches: Array<Pick<NearestBranchRecord, 'id' | 'city' | 'lat' | 'lon' | 'pocketId'>>;
};

export type BatchEncodeResponse = {
  message: string;
  jobId: string;
  fileName: string;
  rowCount: number;
  total?: number;
  replaceExisting: boolean;
  confirmWipeAll: boolean;
  worker: string;
  statusUrl: string;
};

export type HealthCheckResponse = Record<string, unknown>;
export type BatchTerritoriesResponse = Record<string, unknown>;

export const queryKeys = {
  config: ['config'] as const,
  configHistory: (limit = 10, offset = 0) => ['config-history', limit, offset] as const,
  branches: (params: BranchListParams = {}) => ['branches', params] as const,
  jobs: (params: JobsListParams = {}) => ['jobs', params] as const,
  job: (jobId: string) => ['job', jobId] as const,
  territoryVisualization: (params: TerritoryVisualizationParams = {}) =>
    ['territory-visualization', params] as const,
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

const dispatchStoredSessionEvent = () => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(AUTH_SESSION_EVENT));
};

const getApiErrorPayload = (value: unknown): ApiErrorPayload | null => {
  if (!isRecord(value)) {
    return null;
  }

  return {
    error: typeof value.error === 'string' ? value.error : undefined,
    message: typeof value.message === 'string' ? value.message : undefined,
    code: typeof value.code === 'string' ? value.code : undefined,
    details: value.details,
  };
};

const createApiRequestError = (
  message: string,
  error: AxiosError<ApiErrorPayload>
): ApiRequestError => {
  const payload = getApiErrorPayload(error.response?.data);
  const normalizedError = new Error(message) as ApiRequestError;

  normalizedError.status = error.response?.status;
  normalizedError.code = payload?.code || error.code;
  normalizedError.details = payload?.details;
  normalizedError.originalError = error;

  return normalizedError;
};

export const getStoredSession = (): AuthSession | null => readStoredSession();

export const setStoredSession = (session: AuthSession) => {
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  dispatchStoredSessionEvent();
};

export const clearStoredSession = () => {
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
  dispatchStoredSessionEvent();
};

export const isAuthenticated = () => Boolean(readStoredSession()?.accessToken);

export const subscribeToStoredSession = (
  listener: (session: AuthSession | null) => void
) => {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleSessionChanged = () => {
    listener(readStoredSession());
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key === AUTH_STORAGE_KEY) {
      listener(readStoredSession());
    }
  };

  window.addEventListener(AUTH_SESSION_EVENT, handleSessionChanged as EventListener);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener(AUTH_SESSION_EVENT, handleSessionChanged as EventListener);
    window.removeEventListener('storage', handleStorage);
  };
};

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
      timeout: 120000,
    });

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

    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError<ApiErrorPayload>) => {
        const responseStatus = error.response?.status;
        const responseData = getApiErrorPayload(error.response?.data);
        const originalRequest = error.config as (typeof error.config & { _retry?: boolean }) | undefined;
        const errorMessage =
          responseData?.error
          || responseData?.message
          || error.message
          || 'Request failed';

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
          logger.error('API request failed', responseData);
        } else if (error.request) {
          logger.error('Network request failed', { message: error.message });
        }

        return Promise.reject(createApiRequestError(errorMessage, error));
      }
    );
  }

  async login(email: string, password: string): Promise<AuthSession> {
    const response = await this.client.post<AuthSession>('/auth/login', { email, password });
    setStoredSession(response.data);
    return response.data;
  }

  async refreshAuth(refreshToken: string): Promise<AuthSession> {
    const response = await axios.post<AuthSession>(`${API_URL}/auth/refresh`, { refreshToken }, {
      timeout: 120000,
    });
    setStoredSession(response.data);
    return response.data;
  }

  async logout(refreshToken?: string): Promise<void> {
    try {
      await this.client.post('/auth/logout', refreshToken ? { refreshToken } : {});
    } finally {
      clearStoredSession();
    }
  }

  async getConfig(): Promise<ConfigResponse> {
    const response = await this.client.get<ConfigResponse>('/config');
    return response.data;
  }

  async updateConfig(config: ConfigRequest): Promise<ConfigUpdateResponse> {
    const response = await this.client.put<ConfigUpdateResponse>('/config', config);
    return response.data;
  }

  async getConfigHistory(limit = 10, offset = 0): Promise<ConfigHistoryResponse> {
    const response = await this.client.get<ConfigHistoryResponse>('/config/history', {
      params: { limit, offset },
    });
    return response.data;
  }

  async getBranches(params?: BranchListParams): Promise<BranchListResponse> {
    const response = await this.client.get<BranchListResponse>('/branches', { params });
    return response.data;
  }

  async getBranch(id: string): Promise<BranchRecord> {
    const response = await this.client.get<BranchRecord>(`/branches/${id}`);
    return response.data;
  }

  async createBranch(branch: CreateBranchRequest): Promise<BranchMutationResponse> {
    const response = await this.client.post<BranchMutationResponse>('/branches', branch);
    return response.data;
  }

  async updateBranch(id: string, branch: UpdateBranchRequest): Promise<BranchMutationResponse> {
    const response = await this.client.put<BranchMutationResponse>(`/branches/${id}`, branch);
    return response.data;
  }

  async deleteBranch(id: string): Promise<BranchDeleteResponse> {
    const response = await this.client.delete<BranchDeleteResponse>(`/branches/${id}`);
    return response.data;
  }

  async uploadBranches(
    file: File,
    uploadMode: BranchUploadMode = 'overwrite'
  ): Promise<BranchUploadResponse> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('uploadMode', uploadMode);

    const response = await this.client.post<BranchUploadResponse>('/branches/upload', formData);
    return response.data;
  }

  async getJobStatus(jobId: string): Promise<JobRecord> {
    const response = await this.client.get<JobRecord>(`/jobs/${jobId}`);
    return response.data;
  }

  async listJobs(params?: JobsListParams): Promise<JobsStreamPayload> {
    const response = await this.client.get<JobsStreamPayload>('/jobs', { params });
    return response.data;
  }

  async subscribeToJobsStream(options: JobsStreamOptions): Promise<(() => void) | null> {
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

  async retryJob(jobId: string): Promise<RetryJobResponse> {
    const response = await this.client.post<RetryJobResponse>(`/jobs/${jobId}/retry`);
    return response.data;
  }

  async deleteJob(jobId: string): Promise<DeleteJobResponse> {
    const response = await this.client.delete<DeleteJobResponse>(`/jobs/${jobId}`);
    return response.data;
  }

  async bulkDeleteJobs(params: BulkDeleteJobsRequest): Promise<BulkDeleteJobsResponse> {
    const response = await this.client.post<BulkDeleteJobsResponse>('/jobs/bulk-delete', params);
    return response.data;
  }

  async exportBranches(): Promise<Blob> {
    const response = await this.client.get<Blob>('/branches/export', {
      responseType: 'blob',
    });
    return response.data;
  }

  async encodePocketId(lat: number, lon: number): Promise<PocketEncodeResponse> {
    const response = await this.client.post<PocketEncodeResponse>('/pocket/encode', { lat, lon });
    return response.data;
  }

  async decodePocketId(pocketId: string): Promise<PocketDecodeResponse> {
    const response = await this.client.post<PocketDecodeResponse>('/pocket/decode', { pocketId });
    return response.data;
  }

  async validatePocketId(pocketId: string): Promise<PocketValidationResponse> {
    const response = await this.client.post<PocketValidationResponse>('/pocket/validate', { pocketId });
    return response.data;
  }

  async findNearest(
    lat: number,
    lon: number,
    limit = 5,
    maxDistance?: number
  ): Promise<NearestBranchesResponse> {
    const response = await this.client.post<NearestBranchesResponse>('/nearest', {
      lat,
      lon,
      limit,
      maxDistance,
    });
    return response.data;
  }

  async findNearestFallback(
    lat: number,
    lon: number,
    limit = 5,
    maxDistance?: number
  ): Promise<NearestBranchesResponse> {
    const response = await this.client.post<NearestBranchesResponse>('/nearest/fallback', {
      lat,
      lon,
      limit,
      maxDistance,
    });
    return response.data;
  }

  async findWithinPocket(pocketId: string): Promise<WithinPocketResponse> {
    const response = await this.client.get<WithinPocketResponse>(`/nearest/within-pocket/${pocketId}`);
    return response.data;
  }

  async batchEncode(file: File, replaceExisting = false): Promise<BatchEncodeResponse> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('replaceExisting', String(replaceExisting));

    try {
      const response = await this.client.post<BatchEncodeResponse>('/batch/encode', formData);
      return response.data;
    } catch (error) {
      const originalError =
        isRecord(error)
        && 'originalError' in error
        && error.originalError instanceof AxiosError
          ? error.originalError
          : error;

      if (
        axios.isAxiosError(originalError)
        && typeof originalError.response?.headers['content-type'] === 'string'
        && originalError.response.headers['content-type'].includes('application/vnd.openxmlformats')
      ) {
        throw new Error('Unexpected file response from batch encode endpoint');
      }

      throw error instanceof Error ? error : new Error(getErrorMessage(error, 'Failed to upload file'));
    }
  }

  async getBatchStatus(jobId: string): Promise<JobRecord> {
    const response = await this.client.get<JobRecord>(`/batch/status/${jobId}`);
    return response.data;
  }

  async downloadBatchResult(jobId: string): Promise<Blob> {
    const response = await this.client.get<Blob>(`/batch/download/${jobId}`, {
      responseType: 'blob',
    });
    return response.data;
  }

  async getBatchTerritories(jobId: string): Promise<BatchTerritoriesResponse> {
    const response = await this.client.get<BatchTerritoriesResponse>(`/batch/territories/${jobId}`);
    return response.data;
  }

  async getTerritoryVisualization(
    params?: TerritoryVisualizationParams
  ): Promise<TerritoryVisualizationResponse> {
    const response = await this.client.get<TerritoryVisualizationResponse>(
      '/batch/territories/visualization',
      {
        params: {
          mode: params?.mode,
          jobId: params?.jobId,
          customerView: params?.customerView,
          branchIds:
            params?.branchIds && params.branchIds.length > 0
              ? params.branchIds.join(',')
              : undefined,
        },
      }
    );
    return response.data;
  }

  async downloadBatchTemplate(): Promise<Blob> {
    const response = await this.client.get<Blob>('/templates/batch-processing', {
      responseType: 'blob',
    });
    return response.data;
  }

  async downloadBranchTemplate(): Promise<Blob> {
    const response = await this.client.get<Blob>('/templates/branch-upload', {
      responseType: 'blob',
    });
    return response.data;
  }

  async healthCheck(): Promise<HealthCheckResponse> {
    const response = await axios.get<HealthCheckResponse>(`${API_URL.replace('/api/v1', '')}/health`);
    return response.data;
  }
}

export default new ApiService();
