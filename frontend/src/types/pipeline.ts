// Mirrors backend/app/domain/models.py. Node type availability, display names, and config shape
// now come from the live GET /nodes catalog (see store/catalogueStore.ts) rather than being
// hardcoded here — only the shapes this editor's own logic (client-side preview execution in
// lib/transform.ts, pipeline-shape validation in lib/graph.ts) needs to reason about live below.

export interface PipelineNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
}

export interface PipelineEdge {
  source: string;
  target: string;
  // Target/source port names (React Flow's targetHandle/sourceHandle) — only meaningful for
  // multi-port nodes (transform.join's left/right inputs, transform.conditional's true/false outputs).
  input?: string | null;
  output?: string | null;
}

export interface PipelineDefinition {
  schema_version: number;
  pipeline_id: string;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
}

export interface SourceCsvConfig {
  path: string;
  header: boolean;
  delimiter?: string;
}

export interface SelectConfig {
  columns: string[];
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

/**
 * The declarative expression grammar (requirements.md §7.2 / backend/app/transformations/
 * expressions.py's compile_expression): recursive and discriminated on `type`, matching the real
 * JSON Schema the backend now emits for transform.filter / transform.expression exactly — so this
 * editor's client-side preview (lib/transform.ts) can evaluate anything the generic config form
 * lets a user build.
 */
export type BinaryOperator = "==" | "!=" | ">" | ">=" | "<" | "<=" | "and" | "or" | "+" | "-" | "*" | "/";

export type ColumnExpr = { type: "column"; name: string };
export type LiteralExpr = { type: "literal"; value: string | number | boolean };
export type BinaryExpr = { type: "binary_operation"; operator: BinaryOperator; left: Expression; right: Expression };
export type Expression = ColumnExpr | LiteralExpr | BinaryExpr;

export interface FilterConfig {
  // Root must be an operation — a bare column or fixed value isn't a usable filter predicate.
  expression: BinaryExpr;
}

export interface ExpressionColumnSpec {
  alias: string;
  // Root must be an operation — a bare column copy or constant belongs in select/rename instead.
  expression: BinaryExpr;
}

export interface ExpressionConfig {
  columns: ExpressionColumnSpec[];
}

export interface ConditionalConfig {
  // Root must be an operation, same rule as FilterConfig — this decides the true/false branch.
  condition: BinaryExpr;
}
