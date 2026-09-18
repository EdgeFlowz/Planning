import type { EditorEdge, EditorNode } from "../types/editor";
import type { PipelineDefinition } from "../types/pipeline";
import { useCatalogueStore } from "../store/catalogueStore";
import { buildDefaultConfig } from "./jsonSchema";

/**
 * Builds the canonical pipeline definition from the editor's current canvas state only.
 * Deliberately stateless — no history, no record of past edits or removed nodes. As a hard
 * guarantee against stale references (e.g. an edge left pointing at a node id that no longer
 * exists), edges are dropped unless both endpoints are present in `nodes` right now.
 */
export function toPipelineDefinition(
  pipelineId: string,
  nodes: EditorNode[],
  edges: EditorEdge[],
): PipelineDefinition {
  const liveNodeIds = new Set(nodes.map((n) => n.id));

  return {
    schema_version: 1,
    pipeline_id: pipelineId,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.nodeType,
      config: n.data.config,
    })),
    edges: edges
      .filter((e) => liveNodeIds.has(e.source) && liveNodeIds.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        // Only meaningful for multi-port nodes (join's left/right inputs, conditional's
        // true/false outputs) — omitted entirely for the common single-port case.
        ...(e.targetHandle ? { input: e.targetHandle } : {}),
        ...(e.sourceHandle ? { output: e.sourceHandle } : {}),
      })),
  };
}

/** Simple vertical auto-layout for nodes loaded from a definition that has no positions. */
export function fromPipelineDefinition(definition: PipelineDefinition): {
  nodes: EditorNode[];
  edges: EditorEdge[];
} {
  const entries = useCatalogueStore.getState().entries;
  const nodes: EditorNode[] = definition.nodes.map((n, index) => {
    const schema = entries.find((e) => e.type === n.type)?.config_schema ?? {};
    const defaults = buildDefaultConfig(schema) as Record<string, unknown>;
    return {
      id: n.id,
      type: "pipelineNode",
      position: { x: 100, y: 80 + index * 140 },
      data: { nodeType: n.type, config: { ...defaults, ...n.config } },
    };
  });

  const edges: EditorEdge[] = definition.edges.map((e) => ({
    id: `${e.source}->${e.target}`,
    source: e.source,
    target: e.target,
    targetHandle: e.input ?? null,
    sourceHandle: e.output ?? null,
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
