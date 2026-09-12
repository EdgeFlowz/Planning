// Mirrors backend/app/domain/models.py plus example_data/node_catalogue.json. Keep in sync with those.

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

/** Node types this editor can create and configure. A subset of node_catalogue.json's "implemented: true" entries. */
export type NodeType =
  | "source.csv"
  | "transform.select"
  | "transform.filter"
  | "transform.rename"
  | "transform.cast"
  | "transform.join"
  | "transform.aggregate"
  | "transform.sort"
  | "transform.deduplicate"
  | "transform.expression";

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

/** Target type name per column. Values are free text in the catalogue; the editor offers a fixed set. */
export interface CastConfig {
  columns: Record<string, string>;
}

export type JoinHow = "inner" | "left" | "right" | "full" | "semi" | "anti" | "cross";

export interface JoinConfig {
  how: JoinHow;
  on: string | string[] | null;
  left_on: string | string[] | null;
  right_on: string | string[] | null;
}

export type AggregationFunction =
  | "sum"
  | "mean"
  | "min"
  | "max"
  | "count"
  | "median"
  | "std"
  | "n_unique"
  | "first"
  | "last";

export interface AggregationSpec {
  column: string;
  function: AggregationFunction;
  alias?: string | null;
}

export interface AggregateConfig {
  group_by: string[];
  aggregations: AggregationSpec[];
}

export interface SortConfig {
  by: string[];
  descending: boolean | boolean[];
}

export type DeduplicateKeep = "first" | "last" | "any" | "none";

export interface DeduplicateConfig {
  subset: string[] | null;
  keep: DeduplicateKeep;
}

export type ExpressionOperand = { type: "column"; name: string } | { type: "literal"; value: string };

export interface BinaryExpression {
  type: "binary_operation";
  operator: "+" | "-" | "*" | "/" | "concat";
  left: ExpressionOperand;
  right: ExpressionOperand;
}

export interface ExpressionColumnSpec {
  alias: string;
  expression: BinaryExpression;
}

export interface ExpressionConfig {
  columns: ExpressionColumnSpec[];
}

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  "source.csv": "CSV Source",
  "transform.select": "Select Columns",
  "transform.filter": "Filter Rows",
  "transform.rename": "Rename Columns",
  "transform.cast": "Cast Types",
  "transform.join": "Join",
  "transform.aggregate": "Aggregate",
  "transform.sort": "Sort",
  "transform.deduplicate": "Deduplicate",
  "transform.expression": "Add Calculated Column",
};

/** Falls back to the raw type string for a node type the editor doesn't recognize (e.g. not yet implemented). */
export function labelForType(type: string): string {
  return NODE_TYPE_LABELS[type as NodeType] ?? type;
}

export function isKnownNodeType(type: string): type is NodeType {
  return type in NODE_TYPE_LABELS;
}

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
    case "transform.cast":
      return { columns: {} } satisfies CastConfig;
    case "transform.join":
      return { how: "inner", on: null, left_on: null, right_on: null } satisfies JoinConfig;
    case "transform.aggregate":
      return { group_by: [], aggregations: [] } satisfies AggregateConfig;
    case "transform.sort":
      return { by: [], descending: false } satisfies SortConfig;
    case "transform.deduplicate":
      return { subset: null, keep: "any" } satisfies DeduplicateConfig;
    case "transform.expression":
      return { columns: [] } satisfies ExpressionConfig;
  }
}
