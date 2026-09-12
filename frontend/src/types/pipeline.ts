// Mirrors backend/app/domain/models.py exactly. Keep in sync with that file.

export interface PipelineNode {
  id: string;
  type: NodeType;
  config: Record<string, unknown>;
}

export interface PipelineEdge {
  source: string;
  target: string;
}

export interface PipelineDefinition {
  schema_version: number;
  pipeline_id: string;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
}

export type NodeType =
  | "source.csv"
  | "transform.select"
  | "transform.filter"
  | "transform.rename"
  | "transform.drop";

export interface SourceCsvConfig {
  path: string;
  has_header: boolean;
}

export interface SelectConfig {
  columns: string[];
}

export type FilterOperator = "==" | "!=" | ">" | ">=" | "<" | "<=" | "contains";

export interface FilterConfig {
  column: string;
  operator: FilterOperator;
  value: string;
}

export interface RenameConfig {
  mapping: Record<string, string>;
}

export interface DropConfig {
  columns: string[];
}

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  "source.csv": "CSV Source",
  "transform.select": "Select Columns",
  "transform.filter": "Filter Rows",
  "transform.rename": "Rename Columns",
  "transform.drop": "Drop Columns",
};

export function defaultConfigFor(type: NodeType): Record<string, unknown> {
  switch (type) {
    case "source.csv":
      return { path: "", has_header: true } satisfies SourceCsvConfig;
    case "transform.select":
      return { columns: [] } satisfies SelectConfig;
    case "transform.filter":
      return { column: "", operator: "==", value: "" } satisfies FilterConfig;
    case "transform.rename":
      return { mapping: {} } satisfies RenameConfig;
    case "transform.drop":
      return { columns: [] } satisfies DropConfig;
  }
}
