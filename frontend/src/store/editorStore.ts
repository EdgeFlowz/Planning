import { create } from "zustand";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import type { EditorEdge, EditorNode } from "../types/editor";
import type { PipelineDefinition } from "../types/pipeline";
import type { ParsedCsv } from "../lib/csv";
import { fromPipelineDefinition } from "../lib/serialize";
import { useCatalogueStore } from "./catalogueStore";
import { buildDefaultConfig } from "../lib/jsonSchema";

interface EditorState {
  pipelineId: string;
  nodes: EditorNode[];
  edges: EditorEdge[];
  selectedNodeId: string | null;
  /** Parsed CSV data keyed by source.csv node id. Editor-only; never serialized into the pipeline JSON. */
  sourceTables: Record<string, ParsedCsv>;
  idCounters: Record<string, number>;

  setPipelineId: (id: string) => void;
  onNodesChange: (changes: NodeChange<EditorNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
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

export const useEditorStore = create<EditorState>((set, get) => ({
  ...initial,

  setPipelineId: (id) => set({ pipelineId: id }),

  onNodesChange: (changes) => set({ nodes: applyNodeChanges<EditorNode>(changes, get().nodes) }),

  onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),

  onConnect: (connection) => {
    if (!connection.source || !connection.target) return;
    // Enforce single-input transforms: replace any existing edge into the same target handle.
    // Join nodes have two handles ("left"/"right"), so a new "left" connection only replaces an existing "left" one.
    const withoutExisting = get().edges.filter(
      (e) => !(e.target === connection.target && (e.targetHandle ?? null) === (connection.targetHandle ?? null)),
    );
    set({ edges: addEdge(connection, withoutExisting) });
  },

  addNode: (type, position) => {
    const short = shortTypeName(type);
    const nextCount = (get().idCounters[short] ?? 0) + 1;
    const id = `${short}_${nextCount}`;
    const schema = useCatalogueStore.getState().entries.find((e) => e.type === type)?.config_schema ?? {};
    const config = buildDefaultConfig(schema) as Record<string, unknown>;
    const node: EditorNode = {
      id,
      type: "pipelineNode",
      position,
      data: { nodeType: type, config },
    };
    set({
      nodes: [...get().nodes, node],
      idCounters: { ...get().idCounters, [short]: nextCount },
      selectedNodeId: id,
    });
    return id;
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
    const { nodes, edges } = fromPipelineDefinition(definition);
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
