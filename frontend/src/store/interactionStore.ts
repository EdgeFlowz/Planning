import { create } from "zustand";
import type { ProximityCandidate } from "../lib/proximity";

/**
 * Transient canvas interaction state: what *would* happen if the user released right now.
 *
 * Deliberately separate from `editorStore`. That store holds the pipeline itself, and everything
 * in it flows into `toPipelineDefinition` and the JSON preview; a ghost connection that changes
 * on every mousemove must never reach either. Keeping it here also means components can subscribe
 * with narrow selectors, so a drag re-renders the two nodes involved rather than the whole canvas.
 */
interface InteractionState {
  /** The connection proximity snapping would commit on release. */
  ghost: ProximityCandidate | null;
  /** Edge currently targeted for a splice by a palette drag. */
  spliceEdgeId: string | null;
  /** Node type being dragged out of the palette — `dataTransfer` can't be read during `dragover`. */
  paletteDragType: string | null;
  /**
   * Stand-in node rendered at the cursor while a palette item is dragged over the canvas.
   * Without it the preview connection has no visible endpoint: React Flow silently drops an edge
   * whose source or target node doesn't exist, so the user would get no feedback until release.
   */
  dragPreview: { type: string; position: { x: number; y: number } } | null;

  setGhost: (candidate: ProximityCandidate | null) => void;
  setSpliceEdgeId: (id: string | null) => void;
  setPaletteDragType: (type: string | null) => void;
  setDragPreview: (preview: InteractionState["dragPreview"]) => void;
  clear: () => void;
}

export const useInteractionStore = create<InteractionState>((set) => ({
  ghost: null,
  spliceEdgeId: null,
  paletteDragType: null,
  dragPreview: null,

  setGhost: (ghost) => set({ ghost }),
  setSpliceEdgeId: (spliceEdgeId) => set({ spliceEdgeId }),
  setPaletteDragType: (paletteDragType) => set({ paletteDragType }),
  setDragPreview: (dragPreview) => set({ dragPreview }),
  clear: () => set({ ghost: null, spliceEdgeId: null, paletteDragType: null, dragPreview: null }),
}));

/** True when this node/handle is one end of the pending ghost connection. */
export function isGhostEndpoint(
  ghost: ProximityCandidate | null,
  nodeId: string,
  handleId: string | null,
  type: "source" | "target",
): boolean {
  if (!ghost) return false;
  const c = ghost.connection;
  return type === "source"
    ? c.source === nodeId && (c.sourceHandle ?? null) === handleId
    : c.target === nodeId && (c.targetHandle ?? null) === handleId;
}
