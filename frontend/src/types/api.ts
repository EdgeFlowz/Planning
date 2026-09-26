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
