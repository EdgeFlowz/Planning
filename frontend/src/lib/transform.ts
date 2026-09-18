import type { ParsedCsv } from "./csv";
import { getOrderedIncomingEdges, type GraphEdge } from "./graph";
import type {
  AggregateConfig,
  AggregationFunction,
  CastConfig,
  ConditionalConfig,
  DeduplicateConfig,
  Expression,
  ExpressionConfig,
  FilterConfig,
  JoinConfig,
  PipelineNode,
  RenameConfig,
  SelectConfig,
  SortConfig,
} from "../types/pipeline";

function pickColumns(table: ParsedCsv, columns: string[]): ParsedCsv {
  const kept = columns.filter((c) => table.columns.includes(c));
  return {
    columns: kept,
    rows: table.rows.map((row) => Object.fromEntries(kept.map((c) => [c, row[c] ?? ""]))),
  };
}


function castValue(value: string, type: string): string {
  switch (type) {
    case "int": {
      const n = parseInt(value, 10);
      return Number.isNaN(n) ? "" : String(n);
    }
    case "float": {
      const n = Number(value);
      return Number.isNaN(n) ? "" : String(n);
    }
    case "boolean":
      return ["1", "true", "yes"].includes(value.trim().toLowerCase()) ? "true" : "false";
    case "string":
    case "date":
    default:
      return value;
  }
}

function toBool(value: string | boolean): boolean {
  return typeof value === "boolean" ? value : value !== "" && value !== "false" && value !== "0";
}

function toRaw(value: string | boolean): string {
  return typeof value === "boolean" ? String(value) : value;
}

/**
 * Evaluates the declarative expression grammar (backend/app/transformations/expressions.py's
 * compile_expression, mirrored in types/pipeline.ts's `Expression`) against one row. Operands can
 * themselves be nested binary expressions — e.g. `and`/`or` combine two comparisons — so this is
 * recursive rather than a flat two-operand evaluator.
 */
function evaluateExpression(expr: Expression, row: Record<string, string>): string | boolean {
  if (expr.type === "column") return row[expr.name] ?? "";
  if (expr.type === "literal") return typeof expr.value === "boolean" ? expr.value : String(expr.value);

  const left = evaluateExpression(expr.left, row);
  const right = evaluateExpression(expr.right, row);

  if (expr.operator === "and") return toBool(left) && toBool(right);
  if (expr.operator === "or") return toBool(left) || toBool(right);

  const leftRaw = toRaw(left);
  const rightRaw = toRaw(right);

  if (expr.operator === "+" || expr.operator === "-" || expr.operator === "*" || expr.operator === "/") {
    const l = Number(leftRaw);
    const r = Number(rightRaw);
    if (Number.isNaN(l) || Number.isNaN(r)) return "";
    switch (expr.operator) {
      case "+":
        return String(l + r);
      case "-":
        return String(l - r);
      case "*":
        return String(l * r);
      case "/":
        return r === 0 ? "" : String(l / r);
    }
  }

  const l = Number(leftRaw);
  const r = Number(rightRaw);
  const bothNumeric = leftRaw !== "" && rightRaw !== "" && !Number.isNaN(l) && !Number.isNaN(r);

  switch (expr.operator) {
    case "==":
      return bothNumeric ? l === r : leftRaw === rightRaw;
    case "!=":
      return bothNumeric ? l !== r : leftRaw !== rightRaw;
    case ">":
      return bothNumeric ? l > r : leftRaw > rightRaw;
    case ">=":
      return bothNumeric ? l >= r : leftRaw >= rightRaw;
    case "<":
      return bothNumeric ? l < r : leftRaw < rightRaw;
    case "<=":
      return bothNumeric ? l <= r : leftRaw <= rightRaw;
    default:
      return false;
  }
}

function compareValues(a: string, b: string): number {
  const an = Number(a);
  const bn = Number(b);
  if (a !== "" && b !== "" && !Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
  return a.localeCompare(b);
}

function computeAggregation(rows: Record<string, string>[], column: string, fn: AggregationFunction): string {
  const values = rows.map((r) => r[column]).filter((v): v is string => v !== undefined && v !== "");
  const nums = values.map(Number).filter((n) => !Number.isNaN(n));

  switch (fn) {
    case "count":
      return String(rows.length);
    case "n_unique":
      return String(new Set(values).size);
    case "first":
      return rows[0]?.[column] ?? "";
    case "last":
      return rows[rows.length - 1]?.[column] ?? "";
    case "sum":
      return String(nums.reduce((a, b) => a + b, 0));
    case "mean":
      return nums.length ? String(nums.reduce((a, b) => a + b, 0) / nums.length) : "";
    case "min":
      return nums.length ? String(Math.min(...nums)) : "";
    case "max":
      return nums.length ? String(Math.max(...nums)) : "";
    case "median": {
      if (!nums.length) return "";
      const sorted = [...nums].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return String(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
    }
    case "std": {
      if (nums.length < 2) return "";
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (nums.length - 1);
      return String(Math.sqrt(variance));
    }
  }
}

/** Splits a table into "true"/"false" branches per transform.conditional's predicate. */
export function applyConditional(table: ParsedCsv, config: ConditionalConfig): { true: ParsedCsv; false: ParsedCsv } {
  if (!config.condition) return { true: table, false: { columns: table.columns, rows: [] } };
  const trueRows: Record<string, string>[] = [];
  const falseRows: Record<string, string>[] = [];
  for (const row of table.rows) {
    (toBool(evaluateExpression(config.condition, row)) ? trueRows : falseRows).push(row);
  }
  return {
    true: { columns: table.columns, rows: trueRows },
    false: { columns: table.columns, rows: falseRows },
  };
}

/** Applies a single node's operation to its (already computed) upstream table. Not used for
 * transform.join or transform.conditional — both need more than one output/input table. */
export function applyNode(table: ParsedCsv, node: PipelineNode): ParsedCsv {
  switch (node.type) {
    case "source.csv":
      return table;

    case "transform.select": {
      const cfg = node.config as unknown as SelectConfig;
      return pickColumns(table, cfg.columns ?? []);
    }

    case "transform.filter": {
      const cfg = node.config as unknown as FilterConfig;
      if (!cfg.expression) return table;
      return {
        columns: table.columns,
        rows: table.rows.filter((row) => toBool(evaluateExpression(cfg.expression, row))),
      };
    }

    case "transform.rename": {
      const cfg = node.config as unknown as RenameConfig;
      const mapping = cfg.mapping ?? {};
      const columns = table.columns.map((c) => mapping[c] ?? c);
      const rows = table.rows.map((row) => {
        const out: Record<string, string> = {};
        for (const c of table.columns) {
          out[mapping[c] ?? c] = row[c] ?? "";
        }
        return out;
      });
      return { columns, rows };
    }

    case "transform.cast": {
      const cfg = node.config as unknown as CastConfig;
      const columns = cfg.columns ?? {};
      const rows = table.rows.map((row) => {
        const out = { ...row };
        for (const [col, type] of Object.entries(columns)) {
          if (col in out) out[col] = castValue(out[col], type);
        }
        return out;
      });
      return { columns: table.columns, rows };
    }

    case "transform.sort": {
      const cfg = node.config as unknown as SortConfig;
      const by = cfg.by ?? [];
      const descending = cfg.descending ?? false;
      const descArr = Array.isArray(descending) ? descending : by.map(() => descending);
      const rows = [...table.rows].sort((a, b) => {
        for (let i = 0; i < by.length; i++) {
          const cmp = compareValues(a[by[i]] ?? "", b[by[i]] ?? "");
          if (cmp !== 0) return descArr[i] ? -cmp : cmp;
        }
        return 0;
      });
      return { columns: table.columns, rows };
    }

    case "transform.deduplicate": {
      const cfg = node.config as unknown as DeduplicateConfig;
      const subset = cfg.subset && cfg.subset.length > 0 ? cfg.subset : table.columns;
      const keyOf = (row: Record<string, string>) => subset.map((c) => row[c] ?? "").join("");

      if (cfg.keep === "none") {
        const counts = new Map<string, number>();
        table.rows.forEach((r) => {
          const k = keyOf(r);
          counts.set(k, (counts.get(k) ?? 0) + 1);
        });
        return { columns: table.columns, rows: table.rows.filter((r) => counts.get(keyOf(r)) === 1) };
      }

      const seen = new Map<string, Record<string, string>>();
      const order: string[] = [];
      for (const row of table.rows) {
        const k = keyOf(row);
        if (!seen.has(k)) {
          seen.set(k, row);
          order.push(k);
        } else if (cfg.keep === "last") {
          seen.set(k, row);
        }
      }
      return { columns: table.columns, rows: order.map((k) => seen.get(k)!) };
    }

    case "transform.aggregate": {
      const cfg = node.config as unknown as AggregateConfig;
      const groupBy = cfg.group_by ?? [];
      const keyOf = (row: Record<string, string>) => groupBy.map((c) => row[c] ?? "").join("");

      const groups = new Map<string, Record<string, string>[]>();
      for (const row of table.rows) {
        const k = keyOf(row);
        const bucket = groups.get(k);
        if (bucket) bucket.push(row);
        else groups.set(k, [row]);
      }

      const aliasFor = (column: string, fn: AggregationFunction, alias?: string | null) => alias || `${fn}_${column}`;
      const columns = [...groupBy, ...cfg.aggregations.map((a) => aliasFor(a.column, a.function, a.alias))];

      const rows = [...groups.values()].map((groupRows) => {
        const out: Record<string, string> = {};
        for (const c of groupBy) out[c] = groupRows[0][c] ?? "";
        for (const agg of cfg.aggregations) {
          out[aliasFor(agg.column, agg.function, agg.alias)] = computeAggregation(groupRows, agg.column, agg.function);
        }
        return out;
      });

      return { columns, rows };
    }

    case "transform.expression": {
      const cfg = node.config as unknown as ExpressionConfig;
      const newAliases = cfg.columns.map((c) => c.alias);
      const columns = [...table.columns.filter((c) => !newAliases.includes(c)), ...newAliases];
      const rows = table.rows.map((row) => {
        const out = { ...row };
        for (const spec of cfg.columns) {
          if (spec.alias) out[spec.alias] = toRaw(evaluateExpression(spec.expression, row));
        }
        return out;
      });
      return { columns, rows };
    }

    default:
      return table;
  }
}

function normalizeKeys(spec: string | string[] | null | undefined): string[] {
  if (!spec) return [];
  return Array.isArray(spec) ? spec : [spec];
}

/** Right-hand column name (or null to drop, when it duplicates a join key already represented by the left side). */
function planRightColumns(leftColumns: string[], rightColumns: string[], onKeys: string[]): Map<string, string | null> {
  const plan = new Map<string, string | null>();
  for (const col of rightColumns) {
    if (onKeys.includes(col) && leftColumns.includes(col)) {
      plan.set(col, null);
    } else {
      plan.set(col, leftColumns.includes(col) ? `${col}_right` : col);
    }
  }
  return plan;
}

export function applyJoin(left: ParsedCsv, right: ParsedCsv, config: JoinConfig): ParsedCsv {
  const how = config.how ?? "inner";
  const onKeys = normalizeKeys(config.on);
  const leftKeys = normalizeKeys(config.left_on).length ? normalizeKeys(config.left_on) : onKeys;
  const rightKeys = normalizeKeys(config.right_on).length ? normalizeKeys(config.right_on) : onKeys;
  const keyOf = (row: Record<string, string>, keys: string[]) => keys.map((k) => row[k] ?? "").join("");

  if (how === "semi" || how === "anti") {
    const rightKeySet = new Set(right.rows.map((r) => keyOf(r, rightKeys)));
    const rows = left.rows.filter((l) => rightKeySet.has(keyOf(l, leftKeys)) === (how === "semi"));
    return { columns: left.columns, rows };
  }

  const rightPlan = planRightColumns(left.columns, right.columns, how === "cross" ? [] : onKeys);
  const columns = [...left.columns, ...[...rightPlan.values()].filter((v): v is string => v !== null)];
  const mergeRows = (l: Record<string, string> | null, r: Record<string, string> | null): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const c of left.columns) out[c] = l ? (l[c] ?? "") : "";
    for (const [c, target] of rightPlan) {
      if (target) out[target] = r ? (r[c] ?? "") : "";
    }
    return out;
  };

  if (how === "cross") {
    const rows: Record<string, string>[] = [];
    for (const l of left.rows) for (const r of right.rows) rows.push(mergeRows(l, r));
    return { columns, rows };
  }

  const rightByKey = new Map<string, Record<string, string>[]>();
  for (const r of right.rows) {
    const k = keyOf(r, rightKeys);
    const bucket = rightByKey.get(k);
    if (bucket) bucket.push(r);
    else rightByKey.set(k, [r]);
  }

  const matchedRight = new Set<Record<string, string>>();
  const rows: Record<string, string>[] = [];
  for (const l of left.rows) {
    const matches = rightByKey.get(keyOf(l, leftKeys));
    if (matches?.length) {
      for (const r of matches) {
        rows.push(mergeRows(l, r));
        matchedRight.add(r);
      }
    } else if (how === "left" || how === "full") {
      rows.push(mergeRows(l, null));
    }
  }
  if (how === "right" || how === "full") {
    for (const r of right.rows) {
      if (!matchedRight.has(r)) rows.push(mergeRows(null, r));
    }
  }

  return { columns, rows };
}

/**
 * Recursively computes the output table for any node in the graph, walking up through its
 * upstream inputs (one for most node types, two — left/right — for transform.join). A node
 * with multiple named outputs (transform.conditional's "true"/"false" branches) is resolved
 * per the connecting edge's sourceHandle; asked for directly (no edge context) it defaults to
 * its "true" branch. Memoized per call so shared upstream nodes aren't recomputed.
 */
export function computeNodeOutput(
  nodeId: string,
  nodes: PipelineNode[],
  edges: GraphEdge[],
  sourceTables: Record<string, ParsedCsv>,
  cache: Map<string, ParsedCsv | null> = new Map(),
): ParsedCsv | null {
  return computeNodeBranch(nodeId, undefined, nodes, edges, sourceTables, cache);
}

function resolveParent(
  edge: GraphEdge | undefined,
  nodes: PipelineNode[],
  edges: GraphEdge[],
  sourceTables: Record<string, ParsedCsv>,
  cache: Map<string, ParsedCsv | null>,
): ParsedCsv | null {
  if (!edge) return null;
  return computeNodeBranch(edge.source, edge.sourceHandle ?? undefined, nodes, edges, sourceTables, cache);
}

function computeNodeBranch(
  nodeId: string,
  branch: string | undefined,
  nodes: PipelineNode[],
  edges: GraphEdge[],
  sourceTables: Record<string, ParsedCsv>,
  cache: Map<string, ParsedCsv | null>,
): ParsedCsv | null {
  const cacheKey = branch ? `${nodeId}:${branch}` : nodeId;
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  let result: ParsedCsv | null;
  if (node.type === "source.csv") {
    result = sourceTables[nodeId] ?? null;
  } else if (node.type === "transform.join") {
    const [leftEdge, rightEdge] = getOrderedIncomingEdges(nodeId, edges);
    const left = resolveParent(leftEdge, nodes, edges, sourceTables, cache);
    const right = resolveParent(rightEdge, nodes, edges, sourceTables, cache);
    result = left && right ? applyJoin(left, right, node.config as unknown as JoinConfig) : null;
  } else if (node.type === "transform.conditional") {
    const [inputEdge] = getOrderedIncomingEdges(nodeId, edges);
    const input = resolveParent(inputEdge, nodes, edges, sourceTables, cache);
    const branches = input ? applyConditional(input, node.config as unknown as ConditionalConfig) : null;
    // Both branches share one upstream computation, so cache them together regardless of which was asked for.
    cache.set(`${nodeId}:true`, branches?.true ?? null);
    cache.set(`${nodeId}:false`, branches?.false ?? null);
    return branches?.[branch === "false" ? "false" : "true"] ?? null;
  } else {
    const [parentEdge] = getOrderedIncomingEdges(nodeId, edges);
    const parentTable = resolveParent(parentEdge, nodes, edges, sourceTables, cache);
    result = parentTable ? applyNode(parentTable, node) : null;
  }

  cache.set(cacheKey, result);
  return result;
}
