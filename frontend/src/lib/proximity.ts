import { Position, type Connection, type InternalNode, type Node, type NodeHandle } from "@xyflow/react";
import type { EditorEdge, EditorNode } from "../types/editor";
import type { NodeCatalogueEntry } from "../types/catalogue";
import { canConnect, type ConnectionContext } from "./connectionRules";

/**
 * How close two node *outlines* must be, in flow units, before they auto-connect. Measured
 * between bounding boxes rather than handles, so "near" means near the node from any side — a
 * handle-to-handle radius only fired when a node was dropped on the axis its handles face.
 * Flow space keeps the feel identical at every zoom level.
 */
export const PROXIMITY_RADIUS = 80;

/**
 * Distance between the two connected handle centres once a node snaps into place: enough for
 * the edge and its arrowhead to read clearly, short enough that the pair is visibly a unit.
 */
export const SNAP_GAP = 60;

/** Clear space kept around other nodes when a snapped node has to slide aside. */
const OBSTACLE_MARGIN = 16;

/**
 * Approximate rendered size of a node, used before a node exists (palette drag preview) or before
 * it has been measured. Real width varies (170–260px, see `.pipeline-node`), which is why newly
 * created nodes are re-snapped once measured.
 */
export const ESTIMATED_NODE_SIZE = { width: 180, height: 84 };

/** Rendered handle size (see `.pipeline-handle` in App.css), used for nodes that aren't measured. */
const HANDLE_SIZE = 9;

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

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Everything proximity needs to know about one node: where it is and where its handles are. */
export interface NodeGeometry {
  id: string;
  rect: Rect;
  points: HandlePoint[];
}

export interface ProximityCandidate {
  connection: Connection;
  distance: number;
  /** Id of the edge this candidate would displace, if any. */
  replacesEdgeId?: string;
  /** The moving node's end of the connection. */
  mine: HandlePoint;
  /** The stationary node's end of the connection. */
  theirs: HandlePoint;
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

/** A node's bounding box and handle centres, in flow coordinates. */
export function nodeGeometry(node: AnyInternalNode): NodeGeometry {
  const origin = node.internals.positionAbsolute;
  return {
    id: node.id,
    rect: {
      x: origin.x,
      y: origin.y,
      width: node.measured?.width ?? node.width ?? 0,
      height: node.measured?.height ?? node.height ?? 0,
    },
    points: collectHandlePoints(node),
  };
}

interface PortSlot {
  handleId: string | null;
  type: "source" | "target";
  /** Handle centre, relative to the node's top-left corner. */
  x: number;
  y: number;
  position: Position;
}

/** Where each port's handle sits on a node of `size`, mirroring PipelineNodeView and App.css. */
function portLayout(
  size: { width: number; height: number },
  ports: { inputs: string[]; outputs: string[] },
  direction: FlowDirection,
): PortSlot[] {
  const place = (index: number, count: number, type: "source" | "target"): PortSlot => {
    // Mirrors the 30%/70% offsets the stylesheet gives multi-port handles.
    const fraction = count === 1 ? 0.5 : 0.3 + (0.4 * index) / (count - 1);
    if (direction === "vertical") {
      return {
        handleId: null,
        type,
        x: size.width * fraction,
        y: type === "target" ? 0 : size.height,
        position: type === "target" ? Position.Top : Position.Bottom,
      };
    }
    return {
      handleId: null,
      type,
      x: type === "target" ? 0 : size.width,
      y: size.height * fraction,
      position: type === "target" ? Position.Left : Position.Right,
    };
  };

  return [
    ...ports.inputs.map((port, i) => ({
      ...place(i, ports.inputs.length, "target"),
      handleId: ports.inputs.length > 1 ? port : null,
    })),
    ...ports.outputs.map((port, i) => ({
      ...place(i, ports.outputs.length, "source"),
      handleId: ports.outputs.length > 1 ? port : null,
    })),
  ];
}

/**
 * Handle points for a node that doesn't exist yet — used while a palette item is being dragged
 * over the canvas, so the drop preview can be shown before the node is created.
 */
export function virtualHandlePoints(
  nodeId: string,
  topLeft: { x: number; y: number },
  size: { width: number; height: number },
  ports: { inputs: string[]; outputs: string[] },
  direction: FlowDirection,
): HandlePoint[] {
  return portLayout(size, ports, direction).map((slot) => ({
    nodeId,
    handleId: slot.handleId,
    type: slot.type,
    x: topLeft.x + slot.x,
    y: topLeft.y + slot.y,
  }));
}

/**
 * Explicit handle bounds for the palette-drag stand-in. Supplying them means React Flow can draw
 * the preview edge immediately instead of waiting to measure a node that is re-created on every
 * pointer move — and because they come from the same layout as `virtualHandlePoints`, the edge
 * lands exactly where the proximity search thinks the handle is.
 */
export function previewHandles(
  size: { width: number; height: number },
  ports: { inputs: string[]; outputs: string[] },
  direction: FlowDirection,
): NodeHandle[] {
  return portLayout(size, ports, direction).map((slot) => ({
    id: slot.handleId,
    type: slot.type,
    position: slot.position,
    x: slot.x - HANDLE_SIZE / 2,
    y: slot.y - HANDLE_SIZE / 2,
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
  }));
}

/** Shortest distance between two rectangles' outlines; 0 when they touch or overlap. */
function rectGap(a: Rect, b: Rect): number {
  const dx = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), 0);
  const dy = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height), 0);
  return Math.hypot(dx, dy);
}

function overlaps(a: Rect, b: Rect, margin: number): boolean {
  return (
    a.x < b.x + b.width + margin &&
    b.x < a.x + a.width + margin &&
    a.y < b.y + b.height + margin &&
    b.y < a.y + a.height + margin
  );
}

function distance(a: HandlePoint, b: HandlePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * True when the producing node sits upstream of the consuming one along the flow axis — i.e. the
 * connection runs the way the layout reads. Side-by-side counts as with the flow. Backwards pairs
 * are still allowed, just scored worse, so dragging a node up into a chain still snaps sensibly.
 */
function runsWithFlow(from: Rect, to: Rect, direction: FlowDirection): boolean {
  return direction === "vertical"
    ? to.y + to.height / 2 >= from.y + from.height / 2
    : to.x + to.width / 2 >= from.x + from.width / 2;
}

const AGAINST_FLOW_PENALTY = 60;

/** Weight of handle distance in the score — only enough to break ties between equally near nodes. */
const HANDLE_TIEBREAK = 0.05;

/**
 * The connection that should be made if the user released the node right now, or null if no
 * node with a compatible port is within `radius` of it.
 *
 * Considers the dragged node as both producer and consumer, so dropping a filter *below* a source
 * and dropping a source *above* a filter both do the obvious thing.
 */
export function findBestPair(
  dragged: NodeGeometry,
  others: NodeGeometry[],
  ctx: ConnectionContext,
  direction: FlowDirection,
  radius: number = PROXIMITY_RADIUS,
): ProximityCandidate | null {
  let best: ProximityCandidate | null = null;

  for (const other of others) {
    if (other.id === dragged.id) continue;
    const gap = rectGap(dragged.rect, other.rect);
    if (gap > radius) continue;

    for (const mine of dragged.points) {
      for (const theirs of other.points) {
        if (mine.type === theirs.type) continue;

        const draggedIsProducer = mine.type === "source";
        const from = draggedIsProducer ? mine : theirs;
        const to = draggedIsProducer ? theirs : mine;
        const connection: Connection = {
          source: from.nodeId,
          sourceHandle: from.handleId,
          target: to.nodeId,
          targetHandle: to.handleId,
        };

        const verdict = canConnect(connection, ctx);
        if (!verdict.ok) continue;

        const withFlow = draggedIsProducer
          ? runsWithFlow(dragged.rect, other.rect, direction)
          : runsWithFlow(other.rect, dragged.rect, direction);
        const score =
          gap + (withFlow ? 0 : AGAINST_FLOW_PENALTY) + distance(mine, theirs) * HANDLE_TIEBREAK;
        if (!best || score < best.distance) {
          best = { connection, distance: score, replacesEdgeId: verdict.replacesEdgeId, mine, theirs };
        }
      }
    }
  }

  return best;
}

/**
 * Where to move a node so that its end of `candidate` sits SNAP_GAP from the other end along the
 * flow axis, lined up with it across the axis. If that spot is taken, the node slides sideways —
 * towards whichever side it was dropped on first — until it's clear.
 *
 * `rect` is the moving node's current box; `candidate.mine` must be measured against it.
 */
export function snapPosition(
  candidate: Pick<ProximityCandidate, "mine" | "theirs">,
  rect: Rect,
  direction: FlowDirection,
  obstacles: Rect[],
): { x: number; y: number } {
  const { mine, theirs } = candidate;
  const downstream = mine.type === "target" ? 1 : -1;
  const anchor =
    direction === "vertical"
      ? { x: theirs.x, y: theirs.y + downstream * SNAP_GAP }
      : { x: theirs.x + downstream * SNAP_GAP, y: theirs.y };
  const base = { x: rect.x + anchor.x - mine.x, y: rect.y + anchor.y - mine.y };

  const vertical = direction === "vertical";
  const step = (vertical ? rect.width : rect.height) + OBSTACLE_MARGIN;
  const preferred = (vertical ? rect.x + rect.width / 2 >= theirs.x : rect.y + rect.height / 2 >= theirs.y) ? 1 : -1;

  for (const offset of [0, 1, -1, 2, -2, 3, -3]) {
    const shift = offset * preferred * step;
    const position = vertical ? { x: base.x + shift, y: base.y } : { x: base.x, y: base.y + shift };
    const box = { ...position, width: rect.width, height: rect.height };
    if (!obstacles.some((o) => overlaps(box, o, OBSTACLE_MARGIN))) return position;
  }
  return base;
}

/** What releasing a palette item at a given point would do. */
export type PaletteDropPlan =
  | { kind: "splice"; edgeId: string; position: { x: number; y: number } }
  | { kind: "connect"; candidate: ProximityCandidate; position: { x: number; y: number } }
  | { kind: "place"; position: { x: number; y: number } };

/**
 * Decides what a palette drop at `centre` would do. Both the drag preview and the drop itself
 * call this with the pointer position, so what the user sees while dragging is exactly what
 * they get on release — the drop never depends on state left behind by an earlier event.
 *
 * `others` must not include the stand-in node rendered for the preview.
 */
export function planPaletteDrop(args: {
  previewId: string;
  nodeType: string;
  centre: { x: number; y: number };
  size: { width: number; height: number };
  ports: { inputs: string[]; outputs: string[] };
  direction: FlowDirection;
  others: NodeGeometry[];
  nodes: EditorNode[];
  edges: EditorEdge[];
  entries: NodeCatalogueEntry[];
}): PaletteDropPlan {
  const { previewId, nodeType, centre, size, ports, direction, others, nodes, edges, entries } = args;
  const rect = { x: centre.x - size.width / 2, y: centre.y - size.height / 2, ...size };
  const position = { x: rect.x, y: rect.y };

  // Dropping onto an existing connection splices the node into it — but only if the node has
  // both an input and an output to splice with.
  if (ports.inputs.length > 0 && ports.outputs.length > 0) {
    const byNode = new Map(others.map((g) => [g.id, g.points]));
    const hitEdge = findEdgeNearPoint(centre, edges, byNode, direction);
    if (hitEdge) return { kind: "splice", edgeId: hitEdge.id, position };
  }

  const preview: NodeGeometry = {
    id: previewId,
    rect,
    points: virtualHandlePoints(previewId, position, size, ports, direction),
  };
  const previewNode: EditorNode = {
    id: previewId,
    type: "pipelineNode",
    position,
    data: { nodeType, config: {} },
  };
  const candidate = findBestPair(preview, others, { nodes: [...nodes, previewNode], edges, entries }, direction);
  if (!candidate) return { kind: "place", position };

  return {
    kind: "connect",
    candidate,
    position: snapPosition(candidate, rect, direction, others.map((g) => g.rect)),
  };
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
