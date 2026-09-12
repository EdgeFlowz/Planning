import type { ParsedCsv } from "./csv";
import { getOrderedParentIds, type GraphEdge } from "./graph";
import type {
  AggregateConfig,
  AggregationFunction,
  BinaryExpression,
  CastConfig,
  DeduplicateConfig,
  ExpressionConfig,
  ExpressionOperand,
  FilterConfig,
  FilterOperator,
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

function evaluateFilter(cellValue: string | undefined, operator: FilterOperator, value: string): boolean {
  const cell = cellValue ?? "";
  const cellNum = Number(cell);
  const valueNum = Number(value);
  const bothNumeric = cell !== "" && value !== "" && !Number.isNaN(cellNum) && !Number.isNaN(valueNum);

  switch (operator) {
    case "==":
      return bothNumeric ? cellNum === valueNum : cell === value;
    case "!=":
      return bothNumeric ? cellNum !== valueNum : cell !== value;
    case ">":
      return bothNumeric ? cellNum > valueNum : cell > value;
    case ">=":
      return bothNumeric ? cellNum >= valueNum : cell >= value;
    case "<":
      return bothNumeric ? cellNum < valueNum : cell < value;
    case "<=":
      return bothNumeric ? cellNum <= valueNum : cell <= value;
    case "contains":
      return cell.includes(value);
  }
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

function resolveOperand(operand: ExpressionOperand, row: Record<string, string>): string {
  return operand.type === "column" ? (row[operand.name] ?? "") : operand.value;
}

function evaluateExpression(row: Record<string, string>, expr: BinaryExpression): string {
  const leftRaw = resolveOperand(expr.left, row);
  const rightRaw = resolveOperand(expr.right, row);
  if (expr.operator === "concat") return `${leftRaw}${rightRaw}`;

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

/** Applies a single node's operation to its (already computed) upstream table. Not used for transform.join. */
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
      if (!cfg.column) return table;
      return {
        columns: table.columns,
        rows: table.rows.filter((row) => evaluateFilter(row[cfg.column], cfg.operator, cfg.value)),
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
          if (spec.alias) out[spec.alias] = evaluateExpression(row, spec.expression);
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
 * upstream inputs (one for most node types, two — left/right — for transform.join).
 * Memoized per call so shared upstream nodes aren't recomputed.
 */
export function computeNodeOutput(
  nodeId: string,
  nodes: PipelineNode[],
  edges: GraphEdge[],
  sourceTables: Record<string, ParsedCsv>,
  cache: Map<string, ParsedCsv | null> = new Map(),
): ParsedCsv | null {
  if (cache.has(nodeId)) return cache.get(nodeId) ?? null;
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  let result: ParsedCsv | null;
  if (node.type === "source.csv") {
    result = sourceTables[nodeId] ?? null;
  } else if (node.type === "transform.join") {
    const [leftId, rightId] = getOrderedParentIds(nodeId, edges);
    const left = leftId ? computeNodeOutput(leftId, nodes, edges, sourceTables, cache) : null;
    const right = rightId ? computeNodeOutput(rightId, nodes, edges, sourceTables, cache) : null;
    result = left && right ? applyJoin(left, right, node.config as unknown as JoinConfig) : null;
  } else {
    const [parentId] = getOrderedParentIds(nodeId, edges);
    const parentTable = parentId ? computeNodeOutput(parentId, nodes, edges, sourceTables, cache) : null;
    result = parentTable ? applyNode(parentTable, node) : null;
  }

  cache.set(nodeId, result);
  return result;
}
