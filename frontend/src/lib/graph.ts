import type { PipelineEdge, PipelineNode } from "../types/pipeline";

export function getParentId(nodeId: string, edges: PipelineEdge[]): string | undefined {
  return edges.find((e) => e.target === nodeId)?.source;
}

/** Walks backwards from nodeId to its root ancestor, returns root-first chain. */
export function getAncestorChain(
  nodeId: string,
  nodes: PipelineNode[],
  edges: PipelineEdge[],
): PipelineNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chain: PipelineNode[] = [];
  const visited = new Set<string>();
  let current: string | undefined = nodeId;

  while (current) {
    if (visited.has(current)) break;
    visited.add(current);
    const node = byId.get(current);
    if (!node) break;
    chain.unshift(node);
    current = getParentId(current, edges);
  }

  return chain;
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

export function validatePipeline(nodes: PipelineNode[], edges: PipelineEdge[]): ValidationIssue[] {
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
    } else {
      if (incoming === 0) {
        issues.push({ nodeId: node.id, message: `Node "${node.id}" has no upstream input.` });
      }
      if (incoming > 1) {
        issues.push({ nodeId: node.id, message: `Node "${node.id}" has more than one upstream input.` });
      }
    }
  }

  return issues;
}
