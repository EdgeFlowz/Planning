import type { Connection, InternalNode, Node } from "@xyflow/react";
import type { EditorEdge } from "../types/editor";
import { canConnect, type ConnectionContext } from "./connectionRules";

/**
 * How close two handles must be, in *flow* units, before they snap together. Measured in flow
 * space rather than screen space so the feel is identical at every zoom level.
 */
export const PROXIMITY_RADIUS = 120;

/** How close the cursor must come to an edge (flow units) to target it for a splice. */
export const EDGE_HIT_TOLERANCE = 30;

export type FlowDirection = "vertical" | "horizontal";

export interface HandlePoint {
  nodeId: string;
  handleId: string | null;
  type: "source" | "target";
  x: number;
  y: number;
}

export interface ProximityCandidate {
  connection: Connection;
  distance: number;
  /** Id of the edge this candidate would displace, if any. */
  replacesEdgeId?: string;
}

type AnyInternalNode = InternalNode<Node>;

/** Centre points, in flow coordinates, of every rendered handle on a node. */
export function collectHandlePoints(node: AnyInternalNode): HandlePoint[] {
  const origin = node.internals.positionAbsolute;
  const bounds = node.internals.handleBounds;
  if (!bounds) return [];

  const points: HandlePoint[] = [];
  for (const type of ["source", "target"] as const) {
    for (const handle of bounds[type] ?? []) {
      points.push({
        nodeId: node.id,
        handleId: handle.id ?? null,
        type,
        x: origin.x + handle.x + handle.width / 2,
        y: origin.y + handle.y + handle.height / 2,
      });
    }
  }
  return points;
}

/**
 * Handle points for a node that doesn't exist yet — used while a palette item is being dragged
 * over the canvas, so the drop preview can be shown before the node is created.
 */
export function virtualHandlePoints(
  nodeId: string,
  centre: { x: number; y: number },
  size: { width: number; height: number },
  ports: { inputs: string[]; outputs: string[] },
  direction: FlowDirection,
): HandlePoint[] {
  const left = centre.x - size.width / 2;
  const top = centre.y - size.height / 2;

  const place = (index: number, count: number, type: "source" | "target"): { x: number; y: number } => {
    // Mirrors the 30%/70% offsets the stylesheet gives multi-port handles.
    const fraction = count === 1 ? 0.5 : 0.3 + (0.4 * index) / (count - 1);
    if (direction === "vertical") {
      return { x: left + size.width * fraction, y: type === "target" ? top : top + size.height };
    }
    return { x: type === "target" ? left : left + size.width, y: top + size.height * fraction };
  };

  return [
    ...ports.inputs.map((port, i) => ({
      nodeId,
      handleId: ports.inputs.length > 1 ? port : null,
      type: "target" as const,
      ...place(i, ports.inputs.length, "target"),
    })),
    ...ports.outputs.map((port, i) => ({
      nodeId,
      handleId: ports.outputs.length > 1 ? port : null,
      type: "source" as const,
      ...place(i, ports.outputs.length, "source"),
    })),
  ];
}

function distance(a: HandlePoint, b: HandlePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * True when `from` (an output) sits upstream of `to` (an input) along the flow axis — i.e. the
 * connection runs the way the layout reads. Backwards pairs are still allowed, just scored worse,
 * so a user dragging a node up into a chain still gets a sensible snap.
 */
function runsWithFlow(from: HandlePoint, to: HandlePoint, direction: FlowDirection): boolean {
  return direction === "vertical" ? to.y >= from.y : to.x >= from.x;
}

const AGAINST_FLOW_PENALTY = 60;

/**
 * The connection that should be made if the user released the node right now, or null if nothing
 * compatible is within `radius`.
 *
 * Considers the dragged node as both producer and consumer, so dropping a filter *below* a source
 * and dropping a source *above* a filter both do the obvious thing.
 */
export function findBestPair(
  draggedPoints: HandlePoint[],
  otherPoints: HandlePoint[],
  ctx: ConnectionContext,
  direction: FlowDirection,
  radius: number = PROXIMITY_RADIUS,
): ProximityCandidate | null {
  let best: ProximityCandidate | null = null;

  for (const mine of draggedPoints) {
    for (const theirs of otherPoints) {
      if (mine.nodeId === theirs.nodeId) continue;
      if (mine.type === theirs.type) continue;

      const gap = distance(mine, theirs);
      if (gap > radius) continue;

      const from = mine.type === "source" ? mine : theirs;
      const to = mine.type === "source" ? theirs : mine;
      const connection: Connection = {
        source: from.nodeId,
        sourceHandle: from.handleId,
        target: to.nodeId,
        targetHandle: to.handleId,
      };

      const verdict = canConnect(connection, ctx);
      if (!verdict.ok) continue;

      const score = gap + (runsWithFlow(from, to, direction) ? 0 : AGAINST_FLOW_PENALTY);
      if (!best || score < best.distance) {
        best = { connection, distance: score, replacesEdgeId: verdict.replacesEdgeId };
      }
    }
  }

  return best;
}

/** Whether two candidates describe the same connection, so the ghost isn't re-set every frame. */
export function sameCandidate(a: ProximityCandidate | null, b: ProximityCandidate | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const x = a.connection;
  const y = b.connection;
  return (
    x.source === y.source &&
    x.target === y.target &&
    (x.sourceHandle ?? null) === (y.sourceHandle ?? null) &&
    (x.targetHandle ?? null) === (y.targetHandle ?? null)
  );
}

function cubicPoint(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

const EDGE_SAMPLES = 24;

/**
 * The edge whose rendered curve passes closest to `point`, within `tolerance`.
 *
 * Approximates each edge by sampling the cubic bezier between its two handle centres using the
 * same control-point convention React Flow draws with, rather than measuring the real SVG path —
 * this keeps the function pure and usable during a `dragover`, before anything is committed.
 */
export function findEdgeNearPoint(
  point: { x: number; y: number },
  edges: EditorEdge[],
  handlePointsByNode: Map<string, HandlePoint[]>,
  direction: FlowDirection,
  tolerance: number = EDGE_HIT_TOLERANCE,
): EditorEdge | null {
  let best: { edge: EditorEdge; gap: number } | null = null;

  for (const edge of edges) {
    const from = (handlePointsByNode.get(edge.source) ?? []).find(
      (h) => h.type === "source" && h.handleId === (edge.sourceHandle ?? null),
    );
    const to = (handlePointsByNode.get(edge.target) ?? []).find(
      (h) => h.type === "target" && h.handleId === (edge.targetHandle ?? null),
    );
    if (!from || !to) continue;

    const offset = direction === "vertical" ? Math.abs(to.y - from.y) / 2 : Math.abs(to.x - from.x) / 2;
    const c1 =
      direction === "vertical" ? { x: from.x, y: from.y + offset } : { x: from.x + offset, y: from.y };
    const c2 = direction === "vertical" ? { x: to.x, y: to.y - offset } : { x: to.x - offset, y: to.y };

    for (let i = 0; i <= EDGE_SAMPLES; i++) {
      const t = i / EDGE_SAMPLES;
      const gap = Math.hypot(
        cubicPoint(t, from.x, c1.x, c2.x, to.x) - point.x,
        cubicPoint(t, from.y, c1.y, c2.y, to.y) - point.y,
      );
      if (gap <= tolerance && (!best || gap < best.gap)) best = { edge, gap };
    }
  }

  return best?.edge ?? null;
}

/** Whether a node dropped onto `edge` could legally take its place in the chain. */
export function canSpliceInto(
  edge: EditorEdge,
  ports: { inputs: string[]; outputs: string[] },
): boolean {
  return ports.inputs.length > 0 && ports.outputs.length > 0 && edge.source !== edge.target;
}

export { canConnect };
