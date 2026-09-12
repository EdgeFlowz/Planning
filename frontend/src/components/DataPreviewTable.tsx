import { useMemo } from "react";
import { useEditorStore } from "../store/editorStore";
import type { GraphEdge } from "../lib/graph";
import { computeNodeOutput } from "../lib/transform";
import type { PipelineNode } from "../types/pipeline";

const PREVIEW_ROW_LIMIT = 15;

export function DataPreviewTable() {
  const nodes = useEditorStore((s) => s.nodes);
  const edges = useEditorStore((s) => s.edges);
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const sourceTables = useEditorStore((s) => s.sourceTables);

  const pipelineNodes: PipelineNode[] = useMemo(
    () => nodes.map((n) => ({ id: n.id, type: n.data.nodeType, config: n.data.config })),
    [nodes],
  );
  const graphEdges: GraphEdge[] = useMemo(
    () => edges.map((e) => ({ source: e.source, target: e.target, targetHandle: e.targetHandle })),
    [edges],
  );

  const targetId = selectedNodeId ?? nodes[nodes.length - 1]?.id;

  const table = useMemo(() => {
    if (!targetId) return null;
    return computeNodeOutput(targetId, pipelineNodes, graphEdges, sourceTables);
  }, [targetId, pipelineNodes, graphEdges, sourceTables]);

  return (
    <section className="data-preview">
      <div className="data-preview-header">
        <h2>Data Preview{targetId ? ` — ${targetId}` : ""}</h2>
        {table && (
          <span className="data-preview-meta">
            {table.rows.length} row{table.rows.length === 1 ? "" : "s"} &middot; {table.columns.length} column
            {table.columns.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {!table && <p className="config-panel-hint">Upload a CSV in a source node to see a live preview.</p>}
      {table && (
        <div className="data-preview-table-wrapper">
          <table>
            <thead>
              <tr>
                {table.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.slice(0, PREVIEW_ROW_LIMIT).map((row, i) => (
                <tr key={i}>
                  {table.columns.map((c) => (
                    <td key={c}>{row[c]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {table.rows.length > PREVIEW_ROW_LIMIT && (
            <p className="data-preview-truncated">
              Showing first {PREVIEW_ROW_LIMIT} of {table.rows.length} rows.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
