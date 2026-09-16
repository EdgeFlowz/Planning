import { getSchemaIssues } from "./schemaValidation";
import type { NodeCatalogueEntry } from "../types/catalogue";
import type { PipelineEdge, PipelineNode } from "../types/pipeline";

/** An edge as seen by the editor, retaining which handle it connects into (needed for join's two inputs). */
export interface GraphEdge extends PipelineEdge {
  targetHandle?: string | null;
}

export function getIncomingEdges(nodeId: string, edges: GraphEdge[]): GraphEdge[] {
  return edges.filter((e) => e.target === nodeId);
}

/**
 * Returns the source ids feeding a node, ordered so a "left" targetHandle comes before "right".
 * For single-input nodes this is just `[parentId]` (or `[]` if unconnected).
 */
export function getOrderedParentIds(nodeId: string, edges: GraphEdge[]): string[] {
  const rank = (handle?: string | null) => (handle === "right" ? 1 : 0);
  return getIncomingEdges(nodeId, edges)
    .slice()
    .sort((a, b) => rank(a.targetHandle) - rank(b.targetHandle))
    .map((e) => e.source);
}

export function detectCycle(nodes: PipelineNode[], edges: PipelineEdge[]): boolean {
  const adjacency = new Map<string, string[]>();
  nodes.forEach((n) => adjacency.set(n.id, []));
  edges.forEach((e) => adjacency.get(e.source)?.push(e.target));

  const UNVISITED = 0;
  const VISITING = 1;
  const DONE = 2;
  const state = new Map(nodes.map((n) => [n.id, UNVISITED]));
  let hasCycle = false;

  function visit(id: string) {
    if (hasCycle) return;
    state.set(id, VISITING);
    for (const next of adjacency.get(id) ?? []) {
      const nextState = state.get(next);
      if (nextState === VISITING) {
        hasCycle = true;
        return;
      }
      if (nextState === UNVISITED) visit(next);
    }
    state.set(id, DONE);
  }

  for (const n of nodes) {
    if (state.get(n.id) === UNVISITED) visit(n.id);
  }

  return hasCycle;
}

export interface ValidationIssue {
  nodeId?: string;
  message: string;
}

export function validatePipeline(
  nodes: PipelineNode[],
  edges: PipelineEdge[],
  catalogueEntries: NodeCatalogueEntry[] = [],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (nodes.length === 0) {
    issues.push({ message: "Pipeline has no nodes." });
    return issues;
  }

  if (detectCycle(nodes, edges)) {
    issues.push({ message: "Pipeline contains a cycle." });
  }

  const incomingCount = new Map(nodes.map((n) => [n.id, 0]));
  edges.forEach((e) => {
    incomingCount.set(e.target, (incomingCount.get(e.target) ?? 0) + 1);
    if (!nodes.some((n) => n.id === e.source)) {
      issues.push({ message: `Edge references unknown source node "${e.source}".` });
    }
    if (!nodes.some((n) => n.id === e.target)) {
      issues.push({ message: `Edge references unknown target node "${e.target}".` });
    }
  });

  for (const node of nodes) {
    const incoming = incomingCount.get(node.id) ?? 0;
    if (node.type === "source.csv") {
      if (incoming !== 0) {
        issues.push({ nodeId: node.id, message: `Source node "${node.id}" must not have an incoming connection.` });
      }
    } else if (node.type === "transform.join") {
      if (incoming !== 2) {
        issues.push({
          nodeId: node.id,
          message: `Join node "${node.id}" requires exactly two upstream inputs (left and right); found ${incoming}.`,
        });
      }
    } else {
      if (incoming === 0) {
        issues.push({ nodeId: node.id, message: `Node "${node.id}" has no upstream input.` });
      }
      if (incoming > 1) {
        issues.push({ nodeId: node.id, message: `Node "${node.id}" has more than one upstream input.` });
      }
    }

    const schema = catalogueEntries.find((e) => e.type === node.type)?.config_schema;
    for (const message of getSchemaIssues(schema, node.config)) {
      issues.push({ nodeId: node.id, message: `${node.id}: ${message}` });
    }
  }

  return issues;
}
