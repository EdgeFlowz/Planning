import { Handle, Position, useConnection, type NodeProps } from "@xyflow/react";
import type { EditorNode } from "../types/editor";
import { getSchemaIssues } from "../lib/schemaValidation";
import { summarizeConfig } from "../lib/jsonSchema";
import { iconForEntry, labelForEntry } from "../lib/catalogueDisplay";
import { portsForEntry, handleIdFor } from "../lib/ports";
import { useCatalogueStore } from "../store/catalogueStore";
import { useEditorStore } from "../store/editorStore";
import { useInteractionStore, isGhostEndpoint } from "../store/interactionStore";
import { canConnect } from "../lib/connectionRules";

/** Short labels for the named ports of multi-port nodes, so "left"/"true" don't crowd the node. */
const PORT_LABELS: Record<string, string> = {
  left: "L",
  right: "R",
  true: "T",
  false: "F",
};

function portLabel(port: string): string {
  return PORT_LABELS[port] ?? port.slice(0, 3).toUpperCase();
}

export function PipelineNodeView({ id, data, selected }: NodeProps<EditorNode>) {
  const entry = useCatalogueStore((s) => s.entries.find((e) => e.type === data.nodeType));
  const direction = useEditorStore((s) => s.flowDirection);

  // Port topology comes from the catalogue (transform.join declares left/right inputs,
  // transform.conditional true/false outputs) with a category-derived fallback, so no node type
  // is special-cased here.
  const ports = portsForEntry(entry);
  const horizontal = direction === "horizontal";
  const targetPosition = horizontal ? Position.Left : Position.Top;
  const sourcePosition = horizontal ? Position.Right : Position.Bottom;

  const issues = entry ? getSchemaIssues(entry.config_schema, data.config) : [];

  // Narrow selector: a pending ghost re-renders only the two nodes it touches, not the canvas.
  const ghost = useInteractionStore((s) =>
    s.ghost && (s.ghost.connection.source === id || s.ghost.connection.target === id) ? s.ghost : null,
  );

  // While a handle drag is in flight, grey out the ports this connection could never land on.
  // Reading the graph imperatively is safe here: it can't change mid-drag, and subscribing would
  // re-render every node on every edge change.
  const connection = useConnection();
  const dragFromNodeId = connection.inProgress ? connection.fromNode?.id : undefined;
  const isOtherNodeDragging = Boolean(dragFromNodeId) && dragFromNodeId !== id;
  const dragWantsTarget = connection.inProgress && connection.fromHandle?.type === "source";

  const verdictFor = (type: "source" | "target", handleId: string | null): "open" | "blocked" => {
    if (!connection.inProgress || !connection.fromNode) return "blocked";
    // A drag out of a source handle is looking for targets, and vice versa.
    if (dragWantsTarget !== (type === "target")) return "blocked";
    const fromHandle = connection.fromHandle?.id ?? null;
    const candidate = dragWantsTarget
      ? { source: connection.fromNode.id, sourceHandle: fromHandle, target: id, targetHandle: handleId }
      : { source: id, sourceHandle: handleId, target: connection.fromNode.id, targetHandle: fromHandle };
    const { nodes, edges } = useEditorStore.getState();
    const entries = useCatalogueStore.getState().entries;
    return canConnect(candidate, { nodes, edges, entries }).ok ? "open" : "blocked";
  };

  const renderHandles = (type: "source" | "target") => {
    const list = type === "target" ? ports.inputs : ports.outputs;
    if (list.length === 0) return null;
    const position = type === "target" ? targetPosition : sourcePosition;

    return (
      <>
        {list.map((port, index) => {
          const handleId = handleIdFor(list, port);
          const classes = ["pipeline-handle"];
          if (list.length > 1) classes.push(`handle-port-${index}`);
          if (isGhostEndpoint(ghost, id, handleId ?? null, type)) classes.push("handle-ghost");
          if (isOtherNodeDragging) classes.push(`handle-${verdictFor(type, handleId ?? null)}`);

          return (
            <Handle
              key={port}
              type={type}
              position={position}
              // Single-port sides stay anonymous: toPipelineDefinition only writes input/output
              // into the exported JSON when a handle id is set, and that shape must not change.
              id={handleId}
              className={classes.join(" ")}
            />
          );
        })}
        {list.length > 1 && (
          <div className={`pipeline-node-handle-labels labels-${type}`}>
            {list.map((port) => (
              <span key={port}>{portLabel(port)}</span>
            ))}
          </div>
        )}
      </>
    );
  };

  // Hitting a 6px dot is the worst part of connecting by hand, so while a connection is being
  // dragged toward a node with a single input, that one handle's hit area is stretched over the
  // whole node body (a CSS concern — adding a second Handle would duplicate its id and corrupt
  // React Flow's handle bounds). Multi-port nodes are left alone: which of join's two inputs you
  // meant can't be inferred from a drop on the body.
  const bodyTarget = isOtherNodeDragging && dragWantsTarget && ports.inputs.length === 1;

  return (
    <div
      className={[
        "pipeline-node",
        selected ? "selected" : "",
        entry ? "" : "unsupported",
        horizontal ? "dir-horizontal" : "dir-vertical",
        ghost ? "ghost-endpoint" : "",
        bodyTarget ? "body-target" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {issues.length > 0 && (
        <div className="pipeline-node-warning" title={issues.join("\n")}>
          &#9888;
        </div>
      )}

      {renderHandles("target")}

      <div className="pipeline-node-header">
        <span className="pipeline-node-icon">{entry ? iconForEntry(entry) : "❓"}</span>
        <span className="pipeline-node-title">{labelForEntry(entry, data.nodeType)}</span>
      </div>
      <div className="pipeline-node-id">{id}</div>
      <div className="pipeline-node-body">
        {entry ? summarizeConfig(entry.config_schema, data.config) : "Unknown node type"}
      </div>

      {renderHandles("source")}
    </div>
  );
}
