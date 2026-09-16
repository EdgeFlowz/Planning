import type { Node as RFNode, Edge as RFEdge } from "@xyflow/react";

export interface RFNodeData extends Record<string, unknown> {
  nodeType: string;
  config: Record<string, unknown>;
}

export type EditorNode = RFNode<RFNodeData>;
export type EditorEdge = RFEdge;
