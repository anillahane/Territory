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
  uploaded_branch_code?: string | null;
  existing_branch_id?: string | null;
  existing_branch_name?: string | null;
  distance_customer_to_existing_branch?: number | null;
  branch_change_type?: 'same' | 'different' | 'not_comparable' | string;
  distance_reduction?: number | null;
  distance_pocket_to_branch: number;
  distance_customer_to_branch: number;
  created_at: string;
}

export interface MappingImpactStats {
  comparableAccounts: number;
  sameBranchAccounts: number;
  differentBranchAccounts: number;
  sameBranchCount: number;
  differentBranchCount: number;
  totalBranchCount: number;
  avgExistingBranchDistance: number;
  avgRevisedBranchDistance: number;
  avgDistanceReduction: number;
  totalDistanceReduction: number;
  improvedAccounts: number;
  unchangedDistanceAccounts: number;
  worsenedAccounts: number;
  sameBranchAvgOriginalDistance: number;
  sameBranchAvgChangedDistance: number;
  differentBranchAvgOriginalDistance: number;
  differentBranchAvgChangedDistance: number;
  sameBranchAvgImpact: number;
  differentBranchAvgImpact: number;
}

export interface MappingImpactByExistingBranchRow {
  existingBranchId: string;
  existingBranchName?: string | null;
  comparableAccounts: number;
  sameBranchAccounts: number;
  differentBranchAccounts: number;
  avgExistingBranchDistance: number;
  avgRevisedBranchDistance: number;
  avgDistanceReduction: number;
  totalDistanceReduction: number;
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
  includeStats?: boolean;
  includeBranchImpact?: boolean;
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
    impact?: MappingImpactStats;
    byExistingBranch?: MappingImpactByExistingBranchRow[];
  };
}

export interface ApiError {
  message: string;
  status?: number;
}
