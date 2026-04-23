import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store/useStore';
import BatchProcessing from '../BatchProcessing';

const mockListJobs = vi.hoisted(() => vi.fn());
const mockSubscribeToJobsStream = vi.hoisted(() => vi.fn());
const mockBatchEncode = vi.hoisted(() => vi.fn());
const mockDownloadBatchTemplate = vi.hoisted(() => vi.fn());
const mockRetryJob = vi.hoisted(() => vi.fn());
const mockDeleteJob = vi.hoisted(() => vi.fn());
const mockBulkDeleteJobs = vi.hoisted(() => vi.fn());
const mockDownloadBatchResult = vi.hoisted(() => vi.fn());
const mockGetBatchTerritories = vi.hoisted(() => vi.fn());

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual<typeof import('../../services/api')>('../../services/api');

  return {
    ...actual,
    default: {
      listJobs: mockListJobs,
      subscribeToJobsStream: mockSubscribeToJobsStream,
      batchEncode: mockBatchEncode,
      downloadBatchTemplate: mockDownloadBatchTemplate,
      retryJob: mockRetryJob,
      deleteJob: mockDeleteJob,
      bulkDeleteJobs: mockBulkDeleteJobs,
      downloadBatchResult: mockDownloadBatchResult,
      getBatchTerritories: mockGetBatchTerritories,
    },
  };
});

const defaultDashboardMapPanel = {
  zoomLevel: 4.5,
  center: [78.9629, 20.5937] as [number, number],
  gridOverlay: '500 km, 100 km, 20 km',
  mapLoaded: false,
  mapError: null,
};

const resetStore = () => {
  useStore.setState({
    config: null,
    branches: [],
    customerDots: [],
    selectedGridLevel: 0,
    showGrid: true,
    showBranches: true,
    showCustomers: true,
    nearestBranches: [],
    queryLocation: null,
    loading: false,
    highlightedPocketId: null,
    error: null,
    success: null,
    dashboardMapPanel: defaultDashboardMapPanel,
    dashboardSelectedGridLevels: ['500km', '100km', '20km', '5km', '1km'],
  });
};

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('BatchProcessing', () => {
  beforeEach(() => {
    resetStore();
    mockListJobs.mockReset();
    mockSubscribeToJobsStream.mockReset();
    mockBatchEncode.mockReset();
    mockDownloadBatchTemplate.mockReset();
    mockRetryJob.mockReset();
    mockDeleteJob.mockReset();
    mockBulkDeleteJobs.mockReset();
    mockDownloadBatchResult.mockReset();
    mockGetBatchTerritories.mockReset();
    mockSubscribeToJobsStream.mockResolvedValue(() => undefined);
  });

  it('rejects non-Excel uploads before calling the API', async () => {
    mockListJobs.mockResolvedValue({ jobs: [], total: 0 });

    render(<BatchProcessing />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(mockListJobs).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Upload File' }));
    await screen.findByText('Upload File for Batch Processing');

    const input = document.querySelector('#batch-file-upload');
    const invalidFile = new File(['bad-data'], 'customers.csv', { type: 'text/csv' });
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [invalidFile] },
    });

    expect(useStore.getState().error).toBe('Please select an Excel file (.xlsx or .xls)');
    expect(mockBatchEncode).not.toHaveBeenCalled();
  });

  it('uploads an Excel file, queues processing, and refreshes job history', async () => {
    const uploadFile = new File(['xlsx-data'], 'customers.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    mockListJobs
      .mockResolvedValueOnce({ jobs: [], total: 0 })
      .mockResolvedValueOnce({
        jobs: [{
          jobId: 'job-1',
          type: 'batch-process',
          status: 'pending',
          progress: 10,
          createdAt: '2026-04-22T10:00:00.000Z',
          data: {
            fileName: 'customers.xlsx',
            totalAccounts: 42,
            totalPockets: 7,
          },
        }],
        total: 1,
      });
    mockBatchEncode.mockResolvedValue({
      jobId: 'job-1',
      fileName: 'customers.xlsx',
      total: 42,
    });

    render(<BatchProcessing />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(mockListJobs).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Upload File' }));
    await screen.findByText('Upload File for Batch Processing');

    const input = document.querySelector('#batch-file-upload');
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [uploadFile] },
    });

    expect(screen.getByText('Selected: customers.xlsx')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Replace existing customer data' }));
    fireEvent.click(screen.getByRole('button', { name: 'Upload & Process' }));

    await waitFor(() => {
      expect(mockBatchEncode).toHaveBeenCalledWith(uploadFile, true);
    });

    await waitFor(() => {
      expect(useStore.getState().success).toBe(
        'File "customers.xlsx" uploaded! Processing 42 records in background. Existing customer mappings will be replaced.'
      );
    });

    await waitFor(() => {
      expect(mockListJobs.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    await waitFor(() => {
      expect(screen.getByText('Processing: customers.xlsx')).toBeInTheDocument();
    });

    expect(screen.queryByText('Upload File for Batch Processing')).not.toBeInTheDocument();
    expect(useStore.getState().error).toBeNull();
  });
});
