import type {
  AggregateConfig,
  BinaryExpression,
  CastConfig,
  DeduplicateConfig,
  ExpressionConfig,
  ExpressionOperand,
  FilterConfig,
  JoinConfig,
  NodeType,
  RenameConfig,
  SelectConfig,
  SortConfig,
  SourceCsvConfig,
} from "../types/pipeline";

function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value.trim() === "";
}

function keyCount(spec: string | string[] | null | undefined): number {
  if (!spec) return 0;
  return Array.isArray(spec) ? spec.length : 1;
}

/** Null when the operand is filled in; otherwise a short label of what's missing ("left", "right"). */
function operandIssue(operand: ExpressionOperand | undefined): string | null {
  if (!operand) return "missing";
  if (operand.type === "column") return isBlank(operand.name) ? "no column chosen" : null;
  return operand.value === "" || operand.value === undefined ? "value is empty" : null;
}

function expressionIssues(expr: BinaryExpression | undefined, prefix: string): string[] {
  if (!expr) return [`${prefix} has no expression configured.`];
  const issues: string[] = [];
  const leftIssue = operandIssue(expr.left);
  const rightIssue = operandIssue(expr.right);
  if (leftIssue) issues.push(`${prefix}: left side ${leftIssue}.`);
  if (rightIssue) issues.push(`${prefix}: right side ${rightIssue}.`);
  return issues;
}

/**
 * Field-level problems with a single node's own config — missing/empty required values, duplicate
 * output column names, etc. Deliberately independent of upstream schema, so it works even before
 * any CSV is uploaded. Used by the config panel, the canvas node badge, and the overall pipeline
 * validation count, so all three stay in sync.
 */
export function getNodeConfigIssues(type: NodeType, config: Record<string, unknown>): string[] {
  const issues: string[] = [];

  switch (type) {
    case "source.csv": {
      const cfg = config as unknown as SourceCsvConfig;
      if (isBlank(cfg.path)) issues.push("Path is required.");
      break;
    }

    case "transform.select": {
      const cfg = config as unknown as SelectConfig;
      if (!cfg.columns?.length) issues.push("Select at least one column.");
      break;
    }

    case "transform.filter": {
      const cfg = config as unknown as FilterConfig;
      issues.push(...expressionIssues(cfg.expression, "Filter condition"));
      break;
    }

    case "transform.rename": {
      const cfg = config as unknown as RenameConfig;
      if (!Object.keys(cfg.mapping ?? {}).length) {
        issues.push("No renames configured yet — this node currently passes data through unchanged.");
      }
      break;
    }

    case "transform.cast": {
      const cfg = config as unknown as CastConfig;
      if (!Object.keys(cfg.columns ?? {}).length) {
        issues.push("No columns selected to cast — this node currently passes data through unchanged.");
      }
      break;
    }

    case "transform.join": {
      const cfg = config as unknown as JoinConfig;
      if (cfg.how !== "cross") {
        const hasOn = keyCount(cfg.on) > 0;
        const hasLeftRight = keyCount(cfg.left_on) > 0 && keyCount(cfg.right_on) > 0;
        if (!hasOn && !hasLeftRight) issues.push("Choose a join column for both sides.");
      }
      break;
    }

    case "transform.aggregate": {
      const cfg = config as unknown as AggregateConfig;
      if (!cfg.aggregations?.length) {
        issues.push("Add at least one aggregation.");
      } else {
        const seenAliases = new Set<string>();
        cfg.aggregations.forEach((agg, i) => {
          if (isBlank(agg.column)) {
            issues.push(`Aggregation #${i + 1} is missing a column.`);
            return;
          }
          const alias = agg.alias?.trim() || `${agg.function}_${agg.column}`;
          if (seenAliases.has(alias)) issues.push(`Aggregation #${i + 1} produces a duplicate column name "${alias}".`);
          seenAliases.add(alias);
        });
      }
      break;
    }

    case "transform.sort": {
      const cfg = config as unknown as SortConfig;
      if (!cfg.by?.length) issues.push("Add at least one sort column.");
      break;
    }

    case "transform.deduplicate": {
      const cfg = config as unknown as DeduplicateConfig;
      if (!cfg.keep) issues.push("Choose a keep policy.");
      break;
    }

    case "transform.expression": {
      const cfg = config as unknown as ExpressionConfig;
      if (!cfg.columns?.length) {
        issues.push("Add at least one calculated column.");
      } else {
        const seenAliases = new Set<string>();
        cfg.columns.forEach((spec, i) => {
          if (isBlank(spec.alias)) {
            issues.push(`Calculated column #${i + 1} needs a name.`);
          } else if (seenAliases.has(spec.alias)) {
            issues.push(`Duplicate column name "${spec.alias}".`);
          } else {
            seenAliases.add(spec.alias);
          }
          issues.push(...expressionIssues(spec.expression, `Calculated column #${i + 1}`));
        });
      }
      break;
    }
  }

  return issues;
}
