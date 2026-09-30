// Legacy format (for backward compatibility)
export interface NodeResult {
  node_id: string;
  node_type: string;
  port: string;
  rows: number;
  columns: string[];
}

export interface PipelineRunResponse {
  pipeline_id: string;
  node_results: NodeResult[];
}

// New v1 format
export interface PipelineRun {
  id: string;
  pipeline_id: string;
  pipeline_version: number;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
}

export interface NodeRunMetrics {
  id: string;
  node_id: string;
  node_type: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  started_at: string | null;
  completed_at: string | null;
  rows_read: number | null;
  rows_written: number | null;
  columns: string[] | null;
  error: string | null;
}

export interface PipelineRunDetail {
  run: PipelineRun;
  node_runs: NodeRunMetrics[];
}

export interface Pipeline {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface PipelineListResponse {
  pipelines: Pipeline[];
  total: number;
  skip: number;
  limit: number;
}

export interface Connection {
  id: string;
  type: string;
  name: string;
  created_at: string;
  config?: Record<string, unknown>;
}

export interface ConnectionListResponse {
  connections: Connection[];
  total: number;
  skip: number;
  limit: number;
}

export interface ValidationIssue {
  code: string;
  message: string;
  node_id?: string | null;
  field?: string | null;
}

export interface ValidationResponse {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}
