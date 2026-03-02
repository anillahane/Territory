// Customer Mapping Types
// Requirements: 3.1, 4.1

export interface CustomerMapping {
  id: number;
  job_id: string;
  customer_id: string;
  customer_lat: number;
  customer_lon: number;
  pocket_id: string;
  distance_customer_to_pocket: number;
  nearest_branch_id: string;
  branch_name?: string;
  distance_pocket_to_branch: number;
  distance_customer_to_branch: number;
  created_at: string;
}

export interface FilterState {
  jobId: string;
  customerId: string;
  pocketId: string;
}

export interface PaginationState {
  page: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
}

export interface FetchMappingsParams {
  page?: number;
  pageSize?: number;
  jobId?: string;
  customerId?: string;
  pocketId?: string;
}

export interface MappingsApiResponse {
  data: CustomerMapping[];
  pagination: {
    page: number;
    pageSize: number;
    totalRecords: number;
    totalPages: number;
  };
  stats?: {
    uniqueCustomers: number;
    uniquePockets: number;
    uniqueBranches: number;
    avgDistance: number;
  };
}

export interface ApiError {
  message: string;
  status?: number;
}
