import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { EditorNode } from "../types/editor";
import { getSchemaIssues } from "../lib/schemaValidation";
import { summarizeConfig } from "../lib/jsonSchema";
import { iconForEntry, labelForEntry } from "../lib/catalogueDisplay";
import { useCatalogueStore } from "../store/catalogueStore";

export function PipelineNodeView({ id, data, selected }: NodeProps<EditorNode>) {
  const entry = useCatalogueStore((s) => s.entries.find((e) => e.type === data.nodeType));
  // Join is the one node shape the config schema can't describe: it needs two independent
  // upstream inputs (left/right), which is port topology, not config shape.
  const isJoin = data.nodeType === "transform.join";
  // Conditional is the mirror image: one input, but two named outputs (true/false branches).
  const isConditional = data.nodeType === "transform.conditional";
  const isSource = entry?.category === "source";
  const issues = entry ? getSchemaIssues(entry.config_schema, data.config) : [];

  return (
    <div className={`pipeline-node${selected ? " selected" : ""}${entry ? "" : " unsupported"}`}>
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
        <span className="pipeline-node-icon">{entry ? iconForEntry(entry) : "❓"}</span>
        <span className="pipeline-node-title">{labelForEntry(entry, data.nodeType)}</span>
      </div>
      <div className="pipeline-node-id">{id}</div>
      <div className="pipeline-node-body">
        {entry ? summarizeConfig(entry.config_schema, data.config) : "Unknown node type"}
      </div>
      {isConditional ? (
        <>
          <Handle type="source" position={Position.Bottom} id="true" className="handle-left" />
          <Handle type="source" position={Position.Bottom} id="false" className="handle-right" />
          <div className="pipeline-node-handle-labels pipeline-node-handle-labels-bottom">
            <span>T</span>
            <span>F</span>
          </div>
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} />
      )}
    </div>
  );
}
