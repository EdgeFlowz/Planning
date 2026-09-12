import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { EditorNode } from "../types/editor";
import { getNodeConfigIssues } from "../lib/configValidation";
import { isKnownNodeType, labelForType } from "../types/pipeline";
import type {
  AggregateConfig,
  CastConfig,
  DeduplicateConfig,
  ExpressionConfig,
  FilterConfig,
  JoinConfig,
  RenameConfig,
  SelectConfig,
  SortConfig,
  SourceCsvConfig,
} from "../types/pipeline";

const ICONS: Record<string, string> = {
  "source.csv": "\u{1F4C4}",
  "transform.select": "\u{1F3AF}",
  "transform.filter": "\u{1F50D}",
  "transform.rename": "✏️",
  "transform.cast": "\u{1F501}",
  "transform.join": "\u{1F517}",
  "transform.aggregate": "Σ",
  "transform.sort": "↕️",
  "transform.deduplicate": "\u{1F9F9}",
  "transform.expression": "\u{1F9EE}",
};

function summarize(data: EditorNode["data"]): string {
  switch (data.nodeType) {
    case "source.csv": {
      const cfg = data.config as unknown as SourceCsvConfig;
      return cfg.path || "no file selected";
    }
    case "transform.select": {
      const cfg = data.config as unknown as SelectConfig;
      return cfg.columns?.length ? cfg.columns.join(", ") : "no columns selected";
    }
    case "transform.filter": {
      const cfg = data.config as unknown as FilterConfig;
      return cfg.column ? `${cfg.column} ${cfg.operator} ${cfg.value}` : "not configured";
    }
    case "transform.rename": {
      const cfg = data.config as unknown as RenameConfig;
      const entries = Object.entries(cfg.mapping ?? {});
      return entries.length ? entries.map(([a, b]) => `${a} → ${b}`).join(", ") : "no renames";
    }
    case "transform.cast": {
      const cfg = data.config as unknown as CastConfig;
      const entries = Object.entries(cfg.columns ?? {});
      return entries.length ? entries.map(([a, b]) => `${a}: ${b}`).join(", ") : "no casts";
    }
    case "transform.join": {
      const cfg = data.config as unknown as JoinConfig;
      const key = cfg.on ? String(cfg.on) : `${cfg.left_on ?? "?"} = ${cfg.right_on ?? "?"}`;
      return cfg.how === "cross" ? "cross join" : `${cfg.how} on ${key}`;
    }
    case "transform.aggregate": {
      const cfg = data.config as unknown as AggregateConfig;
      const groupPart = cfg.group_by?.length ? `by ${cfg.group_by.join(", ")}` : "no grouping";
      return `${groupPart} — ${cfg.aggregations?.length ?? 0} aggregation(s)`;
    }
    case "transform.sort": {
      const cfg = data.config as unknown as SortConfig;
      return cfg.by?.length ? cfg.by.join(", ") : "not configured";
    }
    case "transform.deduplicate": {
      const cfg = data.config as unknown as DeduplicateConfig;
      const subsetPart = cfg.subset?.length ? cfg.subset.join(", ") : "all columns";
      return `keep ${cfg.keep} — ${subsetPart}`;
    }
    case "transform.expression": {
      const cfg = data.config as unknown as ExpressionConfig;
      return cfg.columns?.length ? cfg.columns.map((c) => c.alias).join(", ") : "no columns";
    }
    default:
      return JSON.stringify(data.config);
  }
}

export function PipelineNodeView({ id, data, selected }: NodeProps<EditorNode>) {
  const known = isKnownNodeType(data.nodeType);
  const isSource = data.nodeType === "source.csv";
  const isJoin = data.nodeType === "transform.join";
  const issues = known ? getNodeConfigIssues(data.nodeType, data.config) : [];

  return (
    <div className={`pipeline-node${selected ? " selected" : ""}${known ? "" : " unsupported"}`}>
      {issues.length > 0 && (
        <div className="pipeline-node-warning" title={issues.join("\n")}>
          &#9888;
        </div>
      )}
      {isJoin ? (
        <>
          <Handle type="target" position={Position.Top} id="left" className="handle-left" />
          <Handle type="target" position={Position.Top} id="right" className="handle-right" />
          <div className="pipeline-node-handle-labels">
            <span>L</span>
            <span>R</span>
          </div>
        </>
      ) : (
        !isSource && <Handle type="target" position={Position.Top} />
      )}
      <div className="pipeline-node-header">
        <span className="pipeline-node-icon">{known ? ICONS[data.nodeType] : "❓"}</span>
        <span className="pipeline-node-title">{labelForType(data.nodeType)}</span>
      </div>
      <div className="pipeline-node-id">{id}</div>
      <div className="pipeline-node-body">{known ? summarize(data) : "Unsupported node type"}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
