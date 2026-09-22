import type { Connection } from "@xyflow/react";
import type { EditorEdge, EditorNode } from "../types/editor";
import type { NodeCatalogueEntry } from "../types/catalogue";
import { portsForEntry, hasPort } from "./ports";
import { detectCycle } from "./graph";

export interface ConnectionContext {
  nodes: EditorNode[];
  edges: EditorEdge[];
  entries: NodeCatalogueEntry[];
}

export interface ConnectionVerdict {
  ok: boolean;
  /** Human-readable reason the connection was rejected. Only set when `ok` is false. */
  reason?: string;
  /**
   * Id of the edge this connection would displace. Occupying an already-filled target handle is
   * legal — `onConnect` (store/editorStore.ts) replaces rather than stacks — so this is reported
   * for UI ("replaces existing input"), not treated as a rejection.
   */
  replacesEdgeId?: string;
}

const OK: ConnectionVerdict = { ok: true };

function reject(reason: string): ConnectionVerdict {
  return { ok: false, reason };
}

function sameHandle(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

/**
 * The interactive gate for every connection the user can make: proximity snapping, handle
 * dragging (`isValidConnection`), palette drops, and edge splicing all route through here so
 * they cannot disagree about what is legal.
 *
 * `validatePipeline` (lib/graph.ts) remains the authority for the toolbar's validity badge —
 * it judges the finished graph (e.g. "join has only one input yet"), which is a legitimate
 * intermediate state while building. This function judges a single prospective edge.
 */
export function canConnect(connection: Connection, ctx: ConnectionContext): ConnectionVerdict {
  const { source, target, sourceHandle, targetHandle } = connection;
  if (!source || !target) return reject("Incomplete connection.");
  if (source === target) return reject("A node can't connect to itself.");

  const sourceNode = ctx.nodes.find((n) => n.id === source);
  const targetNode = ctx.nodes.find((n) => n.id === target);
  if (!sourceNode || !targetNode) return reject("Unknown node.");

  const sourcePorts = portsForEntry(ctx.entries.find((e) => e.type === sourceNode.data.nodeType));
  const targetPorts = portsForEntry(ctx.entries.find((e) => e.type === targetNode.data.nodeType));

  if (sourcePorts.outputs.length === 0) return reject(`"${source}" has no output.`);
  if (targetPorts.inputs.length === 0) return reject(`"${target}" accepts no input.`);
  if (!hasPort(sourcePorts.outputs, sourceHandle)) return reject(`"${source}" has no output port "${sourceHandle}".`);
  if (!hasPort(targetPorts.inputs, targetHandle)) return reject(`"${target}" has no input port "${targetHandle}".`);

  const duplicate = ctx.edges.some(
    (e) =>
      e.source === source &&
      e.target === target &&
      sameHandle(e.sourceHandle, sourceHandle) &&
      sameHandle(e.targetHandle, targetHandle),
  );
  if (duplicate) return reject("These ports are already connected.");

  // The edge this one would displace, if the target port is already fed. Not a rejection.
  const occupying = ctx.edges.find((e) => e.target === target && sameHandle(e.targetHandle, targetHandle));

  // Cycle check runs against the graph as it would be *after* the replacement, so re-routing an
  // input isn't rejected for a cycle that the displaced edge was solely responsible for.
  const prospective = ctx.edges
    .filter((e) => e.id !== occupying?.id)
    .map((e) => ({ source: e.source, target: e.target }))
    .concat({ source, target });
  const pipelineNodes = ctx.nodes.map((n) => ({ id: n.id, type: n.data.nodeType, config: n.data.config }));
  if (detectCycle(pipelineNodes, prospective)) return reject("That would create a cycle.");

  return occupying ? { ok: true, replacesEdgeId: occupying.id } : OK;
}
