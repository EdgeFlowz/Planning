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
import { defaultConfigFor, type NodeType, type PipelineDefinition } from "../types/pipeline";
import type { ParsedCsv } from "../lib/csv";
import { fromPipelineDefinition } from "../lib/serialize";

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
  addNode: (type: NodeType, position: { x: number; y: number }) => string;
  updateNodeConfig: (id: string, config: Record<string, unknown>) => void;
  setSelectedNode: (id: string | null) => void;
  removeNode: (id: string) => void;
  setSourceTable: (nodeId: string, table: ParsedCsv) => void;
  loadPipeline: (definition: PipelineDefinition, tables?: Record<string, ParsedCsv>) => void;
  reset: () => void;
}

function shortTypeName(type: NodeType): string {
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
    // Enforce single-input transforms: replace any existing edge into this target.
    const withoutExisting = get().edges.filter((e) => e.target !== connection.target);
    set({ edges: addEdge(connection, withoutExisting) });
  },

  addNode: (type, position) => {
    const short = shortTypeName(type);
    const nextCount = (get().idCounters[short] ?? 0) + 1;
    const id = `${short}_${nextCount}`;
    const node: EditorNode = {
      id,
      type: "pipelineNode",
      position,
      data: { nodeType: type, config: defaultConfigFor(type) },
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
