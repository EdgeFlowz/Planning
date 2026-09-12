import type { ParsedCsv } from "./csv";
import type {
  DropConfig,
  FilterConfig,
  FilterOperator,
  PipelineNode,
  RenameConfig,
  SelectConfig,
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

/** Applies a single node's operation to an upstream table. source.csv is a passthrough here. */
export function applyNode(table: ParsedCsv, node: PipelineNode): ParsedCsv {
  switch (node.type) {
    case "source.csv":
      return table;

    case "transform.select": {
      const cfg = node.config as unknown as SelectConfig;
      return pickColumns(table, cfg.columns ?? []);
    }

    case "transform.drop": {
      const cfg = node.config as unknown as DropConfig;
      const drop = new Set(cfg.columns ?? []);
      return pickColumns(
        table,
        table.columns.filter((c) => !drop.has(c)),
      );
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

    case "transform.filter": {
      const cfg = node.config as unknown as FilterConfig;
      if (!cfg.column) return table;
      return {
        columns: table.columns,
        rows: table.rows.filter((row) => evaluateFilter(row[cfg.column], cfg.operator, cfg.value)),
      };
    }

    default:
      return table;
  }
}

/** Runs a root-first chain of nodes (as produced by getAncestorChain) against the parsed source table. */
export function computeChainOutput(
  chain: PipelineNode[],
  sourceTables: Record<string, ParsedCsv>,
): ParsedCsv | null {
  if (chain.length === 0) return null;
  const [root, ...rest] = chain;
  if (root.type !== "source.csv") return null;

  let table = sourceTables[root.id];
  if (!table) return null;

  for (const node of rest) {
    table = applyNode(table, node);
  }
  return table;
}
