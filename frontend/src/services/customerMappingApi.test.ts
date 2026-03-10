// Unit tests for Customer Mapping API Client
// Requirements: 2.1

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import customerMappingApi from './customerMappingApi';

const { mockClient, axiosMock } = vi.hoisted(() => {
  const client = {
    get: vi.fn(),
    interceptors: {
      response: {
        use: vi.fn(),
      },
    },
  };

  const mock = {
    create: vi.fn(() => client),
    isAxiosError: vi.fn(),
  };

  return {
    mockClient: client,
    axiosMock: mock,
  };
});

vi.mock('axios', () => {
  return {
    default: axiosMock,
    ...axiosMock,
  };
});

const mockedAxios = axios as any;

describe('CustomerMappingApiService', () => {
  beforeEach(() => {
    mockClient.get.mockReset();
    mockClient.interceptors.response.use.mockReset();
    mockedAxios.create.mockClear();
    mockedAxios.isAxiosError = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchMappings', () => {
    it('should fetch mappings successfully with default parameters', async () => {
      const mockResponse = {
        data: {
          data: [
            {
              id: 1,
              job_id: 'job-123',
              customer_id: 'cust-1',
              customer_lat: 40.7128,
              customer_lon: -74.006,
              pocket_id: 'pocket-1',
              distance_customer_to_pocket: 150.5,
              nearest_branch_id: 'branch-1',
              branch_name: 'Branch A',
              distance_pocket_to_branch: 200.3,
              distance_customer_to_branch: 250.8,
              created_at: '2024-01-01T00:00:00Z',
            },
          ],
          pagination: {
            page: 1,
            pageSize: 100,
            totalRecords: 1,
            totalPages: 1,
          },
        },
      };

      mockClient.get.mockResolvedValue(mockResponse);

      const result = await customerMappingApi.fetchMappings();

      expect(mockClient.get).toHaveBeenCalledWith('/customer-mappings', {
        params: {},
      });
      expect(result).toMatchObject({
        pagination: mockResponse.data.pagination,
        data: [
          {
            ...mockResponse.data.data[0],
            uploaded_branch_code: null,
            existing_branch_id: null,
            existing_branch_name: null,
            distance_customer_to_existing_branch: null,
            branch_change_type: 'not_comparable',
            distance_reduction: null,
          },
        ],
      });
      expect(result.data).toHaveLength(1);
      expect(result.pagination.totalRecords).toBe(1);
    });

    it('should fetch mappings with all filter parameters', async () => {
      const mockResponse = {
        data: {
          data: [],
          pagination: {
            page: 2,
            pageSize: 50,
            totalRecords: 0,
            totalPages: 0,
          },
        },
      };

      mockClient.get.mockResolvedValue(mockResponse);

      const params = {
        page: 2,
        pageSize: 50,
        jobId: 'job-456',
        customerId: 'cust-2',
        pocketId: 'pocket-2',
      };

      await customerMappingApi.fetchMappings(params);

      expect(mockClient.get).toHaveBeenCalledWith('/customer-mappings', {
        params: {
          page: 2,
          pageSize: 50,
          jobId: 'job-456',
          customerId: 'cust-2',
          pocketId: 'pocket-2',
        },
      });
    });

    it('should handle API errors gracefully', async () => {
      const mockError = {
        response: {
          status: 400,
          data: { error: 'Invalid parameters' },
        },
      };

      mockClient.get.mockRejectedValue(mockError);
      mockedAxios.isAxiosError.mockReturnValue(true);

      await expect(customerMappingApi.fetchMappings()).rejects.toMatchObject({
        message: 'Invalid parameters',
        status: 400,
      });
    });

    it('should handle network errors', async () => {
      const mockError = {
        request: {},
        message: 'Network Error',
      };

      mockClient.get.mockRejectedValue(mockError);
      mockedAxios.isAxiosError.mockReturnValue(true);

      await expect(customerMappingApi.fetchMappings()).rejects.toMatchObject({
        message: 'Network error - please check your connection',
      });
    });

    it('should retry on 5xx server errors', async () => {
      const mockError = {
        response: {
          status: 500,
          data: { error: 'Internal Server Error' },
        },
      };

      const mockSuccess = {
        data: {
          data: [],
          pagination: {
            page: 1,
            pageSize: 100,
            totalRecords: 0,
            totalPages: 0,
          },
        },
      };

      mockClient.get
        .mockRejectedValueOnce(mockError)
        .mockRejectedValueOnce(mockError)
        .mockResolvedValueOnce(mockSuccess);

      const result = await customerMappingApi.fetchMappings();

      expect(mockClient.get).toHaveBeenCalledTimes(3);
      expect(result).toEqual(mockSuccess.data);
    });

    it('should not retry on 4xx client errors', async () => {
      const mockError = {
        response: {
          status: 404,
          data: { error: 'Not Found' },
        },
      };

      mockClient.get.mockRejectedValue(mockError);
      mockedAxios.isAxiosError.mockReturnValue(true);

      await expect(customerMappingApi.fetchMappings()).rejects.toMatchObject({
        message: 'Not Found',
        status: 404,
      });

      expect(mockClient.get).toHaveBeenCalledTimes(1);
    });

    it('should throw error for invalid response structure', async () => {
      const mockResponse = {
        data: {
          // Missing 'data' and 'pagination' fields
          invalid: 'structure',
        },
      };

      mockClient.get.mockResolvedValue(mockResponse);

      await expect(customerMappingApi.fetchMappings()).rejects.toThrow(
        'Invalid API response structure'
      );
    });

    it('should only include defined filter parameters', async () => {
      const mockResponse = {
        data: {
          data: [],
          pagination: {
            page: 1,
            pageSize: 100,
            totalRecords: 0,
            totalPages: 0,
          },
        },
      };

      mockClient.get.mockResolvedValue(mockResponse);

      await customerMappingApi.fetchMappings({
        jobId: 'job-123',
        customerId: '',
        pocketId: undefined,
      });

      expect(mockClient.get).toHaveBeenCalledWith('/customer-mappings', {
        params: {
          jobId: 'job-123',
        },
      });
    });
  });
});
