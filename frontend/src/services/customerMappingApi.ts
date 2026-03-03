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
        uploaded_branch_code: item.uploaded_branch_code ?? item.uploadedBranchCode ?? null,
        existing_branch_id: item.existing_branch_id ?? item.existingBranchId ?? null,
        existing_branch_name: item.existing_branch_name ?? item.existingBranchName ?? null,
        distance_customer_to_existing_branch:
          item.distance_customer_to_existing_branch !== undefined &&
          item.distance_customer_to_existing_branch !== null
            ? Number(item.distance_customer_to_existing_branch)
            : (
              item.distanceCustomerToExistingBranch !== undefined &&
              item.distanceCustomerToExistingBranch !== null
                ? Number(item.distanceCustomerToExistingBranch)
                : null
            ),
        branch_change_type: item.branch_change_type ?? item.branchChangeType ?? 'not_comparable',
        distance_reduction:
          item.distance_reduction !== undefined && item.distance_reduction !== null
            ? Number(item.distance_reduction)
            : (item.distanceReduction !== undefined && item.distanceReduction !== null
              ? Number(item.distanceReduction)
              : null),
        distance_pocket_to_branch: Number(
          item.distance_pocket_to_branch ?? item.distancePocketToBranch ?? 0
        ),
        distance_customer_to_branch: Number(
          item.distance_customer_to_branch ?? item.distanceCustomerToBranch ?? 0
        ),
        created_at: item.created_at ?? item.createdAt ?? '',
      }));

      const rawStats = response.data.stats as any | undefined;
      const rawImpact = rawStats?.impact;
      const normalizedImpact = rawImpact
        ? {
            comparableAccounts: Number(rawImpact.comparableAccounts ?? rawImpact.comparable_accounts ?? 0),
            sameBranchAccounts: Number(rawImpact.sameBranchAccounts ?? rawImpact.same_branch_accounts ?? 0),
            differentBranchAccounts: Number(rawImpact.differentBranchAccounts ?? rawImpact.different_branch_accounts ?? 0),
            sameBranchCount: Number(rawImpact.sameBranchCount ?? rawImpact.same_branch_count ?? 0),
            differentBranchCount: Number(rawImpact.differentBranchCount ?? rawImpact.different_branch_count ?? 0),
            totalBranchCount: Number(rawImpact.totalBranchCount ?? rawImpact.total_branch_count ?? 0),
            avgExistingBranchDistance: Number(rawImpact.avgExistingBranchDistance ?? rawImpact.avg_existing_branch_distance ?? 0),
            avgRevisedBranchDistance: Number(rawImpact.avgRevisedBranchDistance ?? rawImpact.avg_revised_branch_distance ?? 0),
            avgDistanceReduction: Number(rawImpact.avgDistanceReduction ?? rawImpact.avg_distance_reduction ?? 0),
            totalDistanceReduction: Number(rawImpact.totalDistanceReduction ?? rawImpact.total_distance_reduction ?? 0),
            improvedAccounts: Number(rawImpact.improvedAccounts ?? rawImpact.improved_accounts ?? 0),
            unchangedDistanceAccounts: Number(rawImpact.unchangedDistanceAccounts ?? rawImpact.unchanged_distance_accounts ?? 0),
            worsenedAccounts: Number(rawImpact.worsenedAccounts ?? rawImpact.worsened_accounts ?? 0),
            sameBranchAvgOriginalDistance: Number(
              rawImpact.sameBranchAvgOriginalDistance ?? rawImpact.same_branch_avg_original_distance ?? 0
            ),
            sameBranchAvgChangedDistance: Number(
              rawImpact.sameBranchAvgChangedDistance ?? rawImpact.same_branch_avg_changed_distance ?? 0
            ),
            differentBranchAvgOriginalDistance: Number(
              rawImpact.differentBranchAvgOriginalDistance ?? rawImpact.different_branch_avg_original_distance ?? 0
            ),
            differentBranchAvgChangedDistance: Number(
              rawImpact.differentBranchAvgChangedDistance ?? rawImpact.different_branch_avg_changed_distance ?? 0
            ),
            sameBranchAvgImpact: Number(
              rawImpact.sameBranchAvgImpact ?? rawImpact.same_branch_avg_impact ?? 0
            ),
            differentBranchAvgImpact: Number(
              rawImpact.differentBranchAvgImpact ?? rawImpact.different_branch_avg_impact ?? 0
            ),
          }
        : undefined;

      const rawByExistingBranch = rawStats?.byExistingBranch ?? rawStats?.by_existing_branch;
      const normalizedByExistingBranch = Array.isArray(rawByExistingBranch)
        ? rawByExistingBranch.map((row: any) => ({
            existingBranchId: row.existingBranchId ?? row.existing_branch_id ?? '',
            existingBranchName: row.existingBranchName ?? row.existing_branch_name ?? null,
            comparableAccounts: Number(row.comparableAccounts ?? row.comparable_accounts ?? 0),
            sameBranchAccounts: Number(row.sameBranchAccounts ?? row.same_branch_accounts ?? 0),
            differentBranchAccounts: Number(row.differentBranchAccounts ?? row.different_branch_accounts ?? 0),
            avgExistingBranchDistance: Number(row.avgExistingBranchDistance ?? row.avg_existing_branch_distance ?? 0),
            avgRevisedBranchDistance: Number(row.avgRevisedBranchDistance ?? row.avg_revised_branch_distance ?? 0),
            avgDistanceReduction: Number(row.avgDistanceReduction ?? row.avg_distance_reduction ?? 0),
            totalDistanceReduction: Number(row.totalDistanceReduction ?? row.total_distance_reduction ?? 0),
          }))
        : [];

      return {
        data: normalizedData,
        pagination: response.data.pagination,
        stats: rawStats
          ? {
              uniqueCustomers: Number(rawStats.uniqueCustomers ?? rawStats.unique_customers ?? 0),
              uniquePockets: Number(rawStats.uniquePockets ?? rawStats.unique_pockets ?? 0),
              uniqueBranches: Number(rawStats.uniqueBranches ?? rawStats.unique_branches ?? 0),
              avgDistance: Number(rawStats.avgDistance ?? rawStats.avg_distance ?? 0),
              impact: normalizedImpact,
              byExistingBranch: normalizedByExistingBranch,
            }
          : undefined,
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
