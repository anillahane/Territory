// Customer Mapping API Client
// Requirements: 2.1, 3.1

import axios, { AxiosError, type AxiosInstance } from 'axios';
import {
  type ApiError,
  type FetchMappingsParams,
  type MappingImpactByExistingBranchRow,
  type MappingImpactStats,
  type MappingsApiResponse,
} from '../types/customerMapping';
import { getErrorMessage, isRecord } from '../utils/errors';
import logger from '../utils/logger';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

type MappingApiRecord = Record<string, unknown>;
type MappingStatsRecord = Record<string, unknown>;
type QueryParams = Record<string, number | string>;

const toNumber = (value: unknown, fallback = 0): number => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
};

const toNullableNumber = (value: unknown): number | null =>
  value === undefined || value === null ? null : toNumber(value);

const toStringValue = <T extends string | null | undefined>(
  value: unknown,
  fallback: T = '' as T
): string | T => (typeof value === 'string' ? value : fallback);

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

    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response) {
          logger.error('Customer mapping API request failed', error.response.data);
        } else if (error.request) {
          logger.error('Customer mapping network request failed', { message: error.message });
        }
        return Promise.reject(error);
      }
    );
  }

  async fetchMappings(params: FetchMappingsParams = {}): Promise<MappingsApiResponse> {
    return this.retryRequest(async () => {
      const queryParams: QueryParams = {};

      if (params.page !== undefined) queryParams.page = params.page;
      if (params.pageSize !== undefined) queryParams.pageSize = params.pageSize;
      if (params.jobId) queryParams.jobId = params.jobId;
      if (params.customerId) queryParams.customerId = params.customerId;
      if (params.pocketId) queryParams.pocketId = params.pocketId;

      const response = await this.client.get<MappingsApiResponse>(
        '/customer-mappings',
        { params: queryParams }
      );

      if (!response.data || !response.data.data || !response.data.pagination) {
        throw new Error('Invalid API response structure');
      }

      const normalizedData = response.data.data.map((item) => {
        const record = item as unknown as MappingApiRecord;

        return {
          id: toNumber(record.id),
          job_id: toStringValue(record.job_id ?? record.jobId, params.jobId ?? ''),
          customer_id: toStringValue(record.customer_id ?? record.customerId, ''),
          customer_lat: toNumber(record.customer_lat ?? record.customerLat),
          customer_lon: toNumber(record.customer_lon ?? record.customerLon),
          pocket_id: toStringValue(record.pocket_id ?? record.pocketId, ''),
          distance_customer_to_pocket: toNumber(
            record.distance_customer_to_pocket ?? record.distanceCustomerToPocket
          ),
          nearest_branch_id: toStringValue(record.nearest_branch_id ?? record.nearestBranchId, ''),
          branch_name: toStringValue(record.branch_name ?? record.branchName, undefined),
          uploaded_branch_code: toStringValue(record.uploaded_branch_code ?? record.uploadedBranchCode, null),
          existing_branch_id: toStringValue(record.existing_branch_id ?? record.existingBranchId, null),
          existing_branch_name: toStringValue(record.existing_branch_name ?? record.existingBranchName, null),
          distance_customer_to_existing_branch: toNullableNumber(
            record.distance_customer_to_existing_branch ?? record.distanceCustomerToExistingBranch
          ),
          branch_change_type: toStringValue(
            record.branch_change_type ?? record.branchChangeType,
            'not_comparable'
          ),
          distance_reduction: toNullableNumber(
            record.distance_reduction ?? record.distanceReduction
          ),
          distance_pocket_to_branch: toNumber(
            record.distance_pocket_to_branch ?? record.distancePocketToBranch
          ),
          distance_customer_to_branch: toNumber(
            record.distance_customer_to_branch ?? record.distanceCustomerToBranch
          ),
          created_at: toStringValue(record.created_at ?? record.createdAt, ''),
        };
      });

      const rawStats = isRecord(response.data.stats) ? response.data.stats as MappingStatsRecord : undefined;
      const rawImpact =
        rawStats && isRecord(rawStats.impact) ? rawStats.impact as MappingStatsRecord : undefined;
      const normalizedImpact: MappingImpactStats | undefined = rawImpact
        ? {
            comparableAccounts: toNumber(rawImpact.comparableAccounts ?? rawImpact.comparable_accounts),
            sameBranchAccounts: toNumber(rawImpact.sameBranchAccounts ?? rawImpact.same_branch_accounts),
            differentBranchAccounts: toNumber(
              rawImpact.differentBranchAccounts ?? rawImpact.different_branch_accounts
            ),
            sameBranchCount: toNumber(rawImpact.sameBranchCount ?? rawImpact.same_branch_count),
            differentBranchCount: toNumber(
              rawImpact.differentBranchCount ?? rawImpact.different_branch_count
            ),
            totalBranchCount: toNumber(rawImpact.totalBranchCount ?? rawImpact.total_branch_count),
            avgExistingBranchDistance: toNumber(
              rawImpact.avgExistingBranchDistance ?? rawImpact.avg_existing_branch_distance
            ),
            avgRevisedBranchDistance: toNumber(
              rawImpact.avgRevisedBranchDistance ?? rawImpact.avg_revised_branch_distance
            ),
            avgDistanceReduction: toNumber(
              rawImpact.avgDistanceReduction ?? rawImpact.avg_distance_reduction
            ),
            totalDistanceReduction: toNumber(
              rawImpact.totalDistanceReduction ?? rawImpact.total_distance_reduction
            ),
            improvedAccounts: toNumber(rawImpact.improvedAccounts ?? rawImpact.improved_accounts),
            unchangedDistanceAccounts: toNumber(
              rawImpact.unchangedDistanceAccounts ?? rawImpact.unchanged_distance_accounts
            ),
            worsenedAccounts: toNumber(rawImpact.worsenedAccounts ?? rawImpact.worsened_accounts),
            sameBranchAvgOriginalDistance: toNumber(
              rawImpact.sameBranchAvgOriginalDistance ?? rawImpact.same_branch_avg_original_distance
            ),
            sameBranchAvgChangedDistance: toNumber(
              rawImpact.sameBranchAvgChangedDistance ?? rawImpact.same_branch_avg_changed_distance
            ),
            differentBranchAvgOriginalDistance: toNumber(
              rawImpact.differentBranchAvgOriginalDistance ?? rawImpact.different_branch_avg_original_distance
            ),
            differentBranchAvgChangedDistance: toNumber(
              rawImpact.differentBranchAvgChangedDistance ?? rawImpact.different_branch_avg_changed_distance
            ),
            sameBranchAvgImpact: toNumber(
              rawImpact.sameBranchAvgImpact ?? rawImpact.same_branch_avg_impact
            ),
            differentBranchAvgImpact: toNumber(
              rawImpact.differentBranchAvgImpact ?? rawImpact.different_branch_avg_impact
            ),
          }
        : undefined;

      const rawByExistingBranch =
        rawStats?.byExistingBranch ?? rawStats?.by_existing_branch;
      const normalizedByExistingBranch: MappingImpactByExistingBranchRow[] = Array.isArray(rawByExistingBranch)
        ? rawByExistingBranch.map((row) => {
            const branchRow = row as MappingStatsRecord;

            return {
              existingBranchId: toStringValue(
                branchRow.existingBranchId ?? branchRow.existing_branch_id
              ),
              existingBranchName: toStringValue(
                branchRow.existingBranchName ?? branchRow.existing_branch_name,
                null
              ),
              comparableAccounts: toNumber(
                branchRow.comparableAccounts ?? branchRow.comparable_accounts
              ),
              sameBranchAccounts: toNumber(
                branchRow.sameBranchAccounts ?? branchRow.same_branch_accounts
              ),
              differentBranchAccounts: toNumber(
                branchRow.differentBranchAccounts ?? branchRow.different_branch_accounts
              ),
              avgExistingBranchDistance: toNumber(
                branchRow.avgExistingBranchDistance ?? branchRow.avg_existing_branch_distance
              ),
              avgRevisedBranchDistance: toNumber(
                branchRow.avgRevisedBranchDistance ?? branchRow.avg_revised_branch_distance
              ),
              avgDistanceReduction: toNumber(
                branchRow.avgDistanceReduction ?? branchRow.avg_distance_reduction
              ),
              totalDistanceReduction: toNumber(
                branchRow.totalDistanceReduction ?? branchRow.total_distance_reduction
              ),
            };
          })
        : [];

      return {
        data: normalizedData,
        pagination: response.data.pagination,
        stats: rawStats
          ? {
              uniqueCustomers: toNumber(rawStats.uniqueCustomers ?? rawStats.unique_customers),
              uniquePockets: toNumber(rawStats.uniquePockets ?? rawStats.unique_pockets),
              uniqueBranches: toNumber(rawStats.uniqueBranches ?? rawStats.unique_branches),
              avgDistance: toNumber(rawStats.avgDistance ?? rawStats.avg_distance),
              impact: normalizedImpact,
              byExistingBranch: normalizedByExistingBranch,
            }
          : undefined,
      };
    });
  }

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

  private isRetryableError(error: unknown): boolean {
    if (!axios.isAxiosError(error)) {
      if (!isRecord(error)) {
        return false;
      }

      if (!isRecord(error.response)) {
        return 'request' in error;
      }

      return typeof error.response.status === 'number'
        && error.response.status >= 500
        && error.response.status < 600;
    }

    if (!error.response) {
      return true;
    }

    return error.response.status >= 500 && error.response.status < 600;
  }

  private formatError(error: unknown): ApiError {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        return {
          message: getErrorMessage(error, 'Server error occurred'),
          status: error.response.status,
        };
      }

      if (error.request) {
        return {
          message: 'Network error - please check your connection',
        };
      }
    }

    return {
      message: getErrorMessage(error, 'An unexpected error occurred'),
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default new CustomerMappingApiService();
