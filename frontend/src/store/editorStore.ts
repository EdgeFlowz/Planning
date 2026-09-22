import { create } from "zustand";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  reconnectEdge as applyReconnect,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import type { EditorEdge, EditorNode } from "../types/editor";
import type { PipelineDefinition } from "../types/pipeline";
import type { ParsedCsv } from "../lib/csv";
import { fromPipelineDefinition, PIPELINE_EDGE_TYPE } from "../lib/serialize";
import { useCatalogueStore } from "./catalogueStore";
import { buildDefaultConfig } from "../lib/jsonSchema";
import { portsForEntry } from "../lib/ports";
import { canConnect } from "../lib/connectionRules";

export type FlowDirection = "vertical" | "horizontal";

const DIRECTION_STORAGE_KEY = "pipeline-flow-direction";
const SNAP_STORAGE_KEY = "pipeline-proximity-snap";

function loadDirection(): FlowDirection {
  try {
    return localStorage.getItem(DIRECTION_STORAGE_KEY) === "horizontal" ? "horizontal" : "vertical";
  } catch {
    return "vertical";
  }
}

function loadSnapEnabled(): boolean {
  try {
    return localStorage.getItem(SNAP_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore — persistence is a nice-to-have, not a requirement
  }
}

interface EditorState {
  pipelineId: string;
  nodes: EditorNode[];
  edges: EditorEdge[];
  selectedNodeId: string | null;
  /** Parsed CSV data keyed by source.csv node id. Editor-only; never serialized into the pipeline JSON. */
  sourceTables: Record<string, ParsedCsv>;
  idCounters: Record<string, number>;
  /** Which way the pipeline reads on screen. Editor-only; never serialized. */
  flowDirection: FlowDirection;
  /** Whether dragging a node near another one auto-connects them. */
  snapEnabled: boolean;

  setPipelineId: (id: string) => void;
  onNodesChange: (changes: NodeChange<EditorNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  removeEdge: (id: string) => void;
  reconnectEdge: (oldEdge: EditorEdge, connection: Connection) => void;
  /** Drops `edgeId` and wires a freshly added node of `type` into the gap it leaves. */
  insertNodeOnEdge: (edgeId: string, type: string, position: { x: number; y: number }) => string | null;
  setFlowDirection: (direction: FlowDirection) => void;
  setSnapEnabled: (enabled: boolean) => void;
  addNode: (type: string, position: { x: number; y: number }) => string;
  updateNodeConfig: (id: string, config: Record<string, unknown>) => void;
  setSelectedNode: (id: string | null) => void;
  removeNode: (id: string) => void;
  /**
   * Cleans up editor-only state (source tables) for nodes removed some way other than
   * `removeNode` — e.g. React Flow's built-in Delete/Backspace shortcut, which updates
   * `nodes`/`edges` via onNodesChange/onEdgesChange directly rather than calling our action.
   * Node/edge removal itself is already handled by those change events; this just prevents
   * stale per-node data (like an uploaded CSV) from lingering under an id that no longer exists.
   */
  pruneRemovedNodes: (removedIds: string[]) => void;
  setSourceTable: (nodeId: string, table: ParsedCsv) => void;
  loadPipeline: (definition: PipelineDefinition, tables?: Record<string, ParsedCsv>) => void;
  reset: () => void;
}

function shortTypeName(type: string): string {
  return type.split(".")[1] ?? type.split(".")[0];
}

const initial = {
  pipelineId: "sales-example",
  nodes: [] as EditorNode[],
  edges: [] as EditorEdge[],
  selectedNodeId: null as string | null,
  sourceTables: {} as Record<string, ParsedCsv>,
  idCounters: {} as Record<string, number>,
};

/** Builds a node without committing it, so callers that also add edges can do both in one `set`. */
function makeNode(
  type: string,
  position: { x: number; y: number },
  idCounters: Record<string, number>,
): { node: EditorNode; idCounters: Record<string, number> } {
  const short = shortTypeName(type);
  const nextCount = (idCounters[short] ?? 0) + 1;
  const id = `${short}_${nextCount}`;
  const schema = useCatalogueStore.getState().entries.find((e) => e.type === type)?.config_schema ?? {};
  const config = buildDefaultConfig(schema) as Record<string, unknown>;
  return {
    node: { id, type: "pipelineNode", position, data: { nodeType: type, config } },
    idCounters: { ...idCounters, [short]: nextCount },
  };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  ...initial,
  flowDirection: loadDirection(),
  snapEnabled: loadSnapEnabled(),

  setPipelineId: (id) => set({ pipelineId: id }),

  onNodesChange: (changes) => set({ nodes: applyNodeChanges<EditorNode>(changes, get().nodes) }),

  onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),

  onConnect: (connection) => {
    const { nodes, edges } = get();
    const entries = useCatalogueStore.getState().entries;
    // Every interactive path (proximity snap, handle drag, palette drop) already gates on
    // `canConnect`; re-checking here keeps a programmatic caller from creating an illegal edge.
    const verdict = canConnect(connection, { nodes, edges, entries });
    if (!verdict.ok) return;

    // Enforce single-input transforms: replace any existing edge into the same target handle.
    // Join nodes have two handles ("left"/"right"), so a new "left" connection only replaces an existing "left" one.
    const withoutExisting = verdict.replacesEdgeId
      ? edges.filter((e) => e.id !== verdict.replacesEdgeId)
      : edges;
    set({ edges: addEdge({ ...connection, type: PIPELINE_EDGE_TYPE }, withoutExisting) });
  },

  removeEdge: (id) => set({ edges: get().edges.filter((e) => e.id !== id) }),

  reconnectEdge: (oldEdge, connection) => {
    const { nodes, edges } = get();
    const entries = useCatalogueStore.getState().entries;
    // Judge the new edge against the graph *without* the one being moved, so re-pointing an
    // edge at the same target isn't rejected as a duplicate of itself.
    const without = edges.filter((e) => e.id !== oldEdge.id);
    const verdict = canConnect(connection, { nodes, edges: without, entries });
    if (!verdict.ok) return;

    const displaced = verdict.replacesEdgeId
      ? edges.filter((e) => e.id !== verdict.replacesEdgeId)
      : edges;
    set({ edges: applyReconnect(oldEdge, connection, displaced) });
  },

  insertNodeOnEdge: (edgeId, type, position) => {
    const { nodes, edges, idCounters } = get();
    const entries = useCatalogueStore.getState().entries;
    const edge = edges.find((e) => e.id === edgeId);
    if (!edge) return null;

    const { node, idCounters: nextCounters } = makeNode(type, position, idCounters);
    const ports = portsForEntry(entries.find((e) => e.type === type));
    if (ports.inputs.length === 0 || ports.outputs.length === 0) return null;

    const inHandle = ports.inputs.length > 1 ? ports.inputs[0] : null;
    const outHandle = ports.outputs.length > 1 ? ports.outputs[0] : null;
    const remaining = edges.filter((e) => e.id !== edgeId);

    const upstream: EditorEdge = {
      id: `${edge.source}-${node.id}-${inHandle ?? "in"}`,
      type: PIPELINE_EDGE_TYPE,
      source: edge.source,
      sourceHandle: edge.sourceHandle ?? null,
      target: node.id,
      targetHandle: inHandle,
    };
    const downstream: EditorEdge = {
      id: `${node.id}-${edge.target}-${edge.targetHandle ?? "in"}`,
      type: PIPELINE_EDGE_TYPE,
      source: node.id,
      sourceHandle: outHandle,
      target: edge.target,
      targetHandle: edge.targetHandle ?? null,
    };

    set({
      nodes: [...nodes, node],
      edges: [...remaining, upstream, downstream],
      idCounters: nextCounters,
      selectedNodeId: node.id,
    });
    return node.id;
  },

  setFlowDirection: (direction) => {
    persist(DIRECTION_STORAGE_KEY, direction);
    set({ flowDirection: direction });
  },

  setSnapEnabled: (enabled) => {
    persist(SNAP_STORAGE_KEY, enabled ? "on" : "off");
    set({ snapEnabled: enabled });
  },

  addNode: (type, position) => {
    const { node, idCounters } = makeNode(type, position, get().idCounters);
    set({
      nodes: [...get().nodes, node],
      idCounters,
      selectedNodeId: node.id,
    });
    return node.id;
  },

  updateNodeConfig: (id, config) => {
    set({
      nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, config } } : n)),
    });
  },

  setSelectedNode: (id) => set({ selectedNodeId: id }),

  removeNode: (id) => {
    const { [id]: _removed, ...rest } = get().sourceTables;
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
      sourceTables: rest,
    });
  },

  pruneRemovedNodes: (removedIds) => {
    if (removedIds.length === 0) return;
    const removed = new Set(removedIds);
    const sourceTables = Object.fromEntries(
      Object.entries(get().sourceTables).filter(([nodeId]) => !removed.has(nodeId)),
    );
    set({
      sourceTables,
      selectedNodeId: removed.has(get().selectedNodeId ?? "") ? null : get().selectedNodeId,
    });
  },

  setSourceTable: (nodeId, table) => {
    set({ sourceTables: { ...get().sourceTables, [nodeId]: table } });
  },

  loadPipeline: (definition, tables) => {
    const { nodes, edges } = fromPipelineDefinition(definition, get().flowDirection);
    const idCounters: Record<string, number> = {};
    for (const n of nodes) {
      const short = shortTypeName(n.data.nodeType);
      const match = /_(\d+)$/.exec(n.id);
      const num = match ? Number(match[1]) : 0;
      idCounters[short] = Math.max(idCounters[short] ?? 0, num);
    }
    set({
      pipelineId: definition.pipeline_id,
      nodes,
      edges,
      selectedNodeId: null,
      sourceTables: tables ?? {},
      idCounters,
    });
  },

  reset: () => set({ ...initial, nodes: [], edges: [], sourceTables: {}, idCounters: {} }),
}));
