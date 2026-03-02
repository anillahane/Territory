// Customer Mapping API Client
// Requirements: 2.1, 3.1

import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  FetchMappingsParams,
  MappingsApiResponse,
  ApiError,
} from '../types/customerMapping';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

class CustomerMappingApiService {
  private client: AxiosInstance;
  private maxRetries = 3;
  private retryDelay = 1000;

  constructor() {
    this.client = axios.create({
      baseURL: API_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response) {
          console.error('API Error:', error.response.data);
        } else if (error.request) {
          console.error('Network Error:', error.message);
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Fetch customer mappings with filters and pagination
   * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
   */
  async fetchMappings(params: FetchMappingsParams = {}): Promise<MappingsApiResponse> {
    return this.retryRequest(async () => {
      const queryParams: Record<string, any> = {};

      if (params.page !== undefined) queryParams.page = params.page;
      if (params.pageSize !== undefined) queryParams.pageSize = params.pageSize;
      if (params.jobId) queryParams.jobId = params.jobId;
      if (params.customerId) queryParams.customerId = params.customerId;
      if (params.pocketId) queryParams.pocketId = params.pocketId;

      const response = await this.client.get<MappingsApiResponse>(
        '/customer-mappings',
        { params: queryParams }
      );

      // Validate response structure
      if (!response.data || !response.data.data || !response.data.pagination) {
        throw new Error('Invalid API response structure');
      }
      const normalizedData = response.data.data.map((item: any) => ({
        id: item.id,
        job_id: item.job_id ?? item.jobId ?? params.jobId ?? '',
        customer_id: item.customer_id ?? item.customerId ?? '',
        customer_lat: Number(item.customer_lat ?? item.customerLat ?? 0),
        customer_lon: Number(item.customer_lon ?? item.customerLon ?? 0),
        pocket_id: item.pocket_id ?? item.pocketId ?? '',
        distance_customer_to_pocket: Number(
          item.distance_customer_to_pocket ?? item.distanceCustomerToPocket ?? 0
        ),
        nearest_branch_id: item.nearest_branch_id ?? item.nearestBranchId ?? '',
        branch_name: item.branch_name ?? item.branchName ?? undefined,
        distance_pocket_to_branch: Number(
          item.distance_pocket_to_branch ?? item.distancePocketToBranch ?? 0
        ),
        distance_customer_to_branch: Number(
          item.distance_customer_to_branch ?? item.distanceCustomerToBranch ?? 0
        ),
        created_at: item.created_at ?? item.createdAt ?? '',
      }));

      return {
        data: normalizedData,
        pagination: response.data.pagination,
        stats: response.data.stats,
      };
    });
  }

  /**
   * Retry logic for failed requests
   */
  private async retryRequest<T>(
    requestFn: () => Promise<T>,
    retries = this.maxRetries
  ): Promise<T> {
    try {
      return await requestFn();
    } catch (error) {
      if (retries > 0 && this.isRetryableError(error)) {
        await this.delay(this.retryDelay);
        return this.retryRequest(requestFn, retries - 1);
      }
      throw this.formatError(error);
    }
  }

  /**
   * Check if error is retryable (network errors, 5xx errors)
   */
  private isRetryableError(error: any): boolean {
    if (!error.response) {
      // Network error
      return true;
    }
    const status = error.response.status;
    // Retry on 5xx server errors
    return status >= 500 && status < 600;
  }

  /**
   * Format error for consistent error handling
   */
  private formatError(error: any): ApiError {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        return {
          message: (axiosError.response.data as any)?.error || 'Server error occurred',
          status: axiosError.response.status,
        };
      } else if (axiosError.request) {
        return {
          message: 'Network error - please check your connection',
        };
      }
    }
    return {
      message: error.message || 'An unexpected error occurred',
    };
  }

  /**
   * Delay helper for retry logic
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default new CustomerMappingApiService();
