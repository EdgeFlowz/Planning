import type { Node as RFNode, Edge as RFEdge } from "@xyflow/react";
import type { NodeType } from "./pipeline";

export interface RFNodeData extends Record<string, unknown> {
  nodeType: NodeType;
  config: Record<string, unknown>;
}

export type EditorNode = RFNode<RFNodeData>;
export type EditorEdge = RFEdge;
