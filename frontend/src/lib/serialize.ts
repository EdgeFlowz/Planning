import type { EditorEdge, EditorNode } from "../types/editor";
import type { NodeType, PipelineDefinition } from "../types/pipeline";
import { defaultConfigFor } from "../types/pipeline";

export function toPipelineDefinition(
  pipelineId: string,
  nodes: EditorNode[],
  edges: EditorEdge[],
): PipelineDefinition {
  return {
    schema_version: 1,
    pipeline_id: pipelineId,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.nodeType,
      config: n.data.config,
    })),
    edges: edges.map((e) => ({ source: e.source, target: e.target })),
  };
}

/** Simple vertical auto-layout for nodes loaded from a definition that has no positions. */
export function fromPipelineDefinition(definition: PipelineDefinition): {
  nodes: EditorNode[];
  edges: EditorEdge[];
} {
  const nodes: EditorNode[] = definition.nodes.map((n, index) => ({
    id: n.id,
    type: "pipelineNode",
    position: { x: 100, y: 80 + index * 140 },
    data: {
      nodeType: n.type as NodeType,
      config: { ...defaultConfigFor(n.type as NodeType), ...n.config },
    },
  }));

  const edges: EditorEdge[] = definition.edges.map((e) => ({
    id: `${e.source}->${e.target}`,
    source: e.source,
    target: e.target,
  }));

  return { nodes, edges };
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
