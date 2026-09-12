import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { EditorNode } from "../types/editor";
import {
  NODE_TYPE_LABELS,
  type DropConfig,
  type FilterConfig,
  type RenameConfig,
  type SelectConfig,
  type SourceCsvConfig,
} from "../types/pipeline";

const ICONS: Record<string, string> = {
  "source.csv": "\u{1F4C4}",
  "transform.select": "\u{1F3AF}",
  "transform.filter": "\u{1F50D}",
  "transform.rename": "✏️",
  "transform.drop": "\u{1F5D1}️",
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
    case "transform.drop": {
      const cfg = data.config as unknown as DropConfig;
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
    default:
      return "";
  }
}

export function PipelineNodeView({ id, data, selected }: NodeProps<EditorNode>) {
  const isSource = data.nodeType === "source.csv";

  return (
    <div className={`pipeline-node${selected ? " selected" : ""}`}>
      {!isSource && <Handle type="target" position={Position.Top} />}
      <div className="pipeline-node-header">
        <span className="pipeline-node-icon">{ICONS[data.nodeType]}</span>
        <span className="pipeline-node-title">{NODE_TYPE_LABELS[data.nodeType]}</span>
      </div>
      <div className="pipeline-node-id">{id}</div>
      <div className="pipeline-node-body">{summarize(data)}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
