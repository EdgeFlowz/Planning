import { useCallback, useEffect, useRef } from "react";
import { useReactFlow, useStoreApi, type Node } from "@xyflow/react";
import { useEditorStore } from "../store/editorStore";
import { useCatalogueStore } from "../store/catalogueStore";
import { useInteractionStore } from "../store/interactionStore";
import { collectHandlePoints, findBestPair, sameCandidate, type HandlePoint } from "../lib/proximity";

/**
 * Auto-connects nodes that are dragged near each other.
 *
 * While a node is being dragged we look for the closest legal handle pairing and publish it to
 * the interaction store as a "ghost"; on release, the ghost is committed through the store's
 * existing `onConnect`, which already replaces rather than stacks inputs. Nothing is written to
 * the pipeline until the user lets go, so an aborted drag leaves no trace.
 */
export function useProximityConnect() {
  const storeApi = useStoreApi();
  const { getInternalNode } = useReactFlow();
  const onConnect = useEditorStore((s) => s.onConnect);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const setGhost = useInteractionStore((s) => s.setGhost);

  // rAF-throttled: onNodeDrag fires on every mousemove, and the pairing search touches every
  // handle on the canvas.
  const frame = useRef<number | null>(null);

  const cancelFrame = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, []);

  useEffect(() => cancelFrame, [cancelFrame]);

  const onNodeDragStart = useCallback(() => {
    cancelFrame();
    setGhost(null);
  }, [cancelFrame, setGhost]);

  const onNodeDrag = useCallback(
    (_event: unknown, node: Node) => {
      if (!snapEnabled) return;
      if (frame.current !== null) return;

      frame.current = requestAnimationFrame(() => {
        frame.current = null;

        const dragged = getInternalNode(node.id);
        if (!dragged) return;

        const { nodes, edges, flowDirection } = useEditorStore.getState();
        const entries = useCatalogueStore.getState().entries;

        const draggedPoints = collectHandlePoints(dragged);
        if (draggedPoints.length === 0) return;

        const others: HandlePoint[] = [];
        for (const other of storeApi.getState().nodeLookup.values()) {
          if (other.id === node.id) continue;
          others.push(...collectHandlePoints(other));
        }

        const candidate = findBestPair(draggedPoints, others, { nodes, edges, entries }, flowDirection);
        const current = useInteractionStore.getState().ghost;
        if (!sameCandidate(candidate, current)) setGhost(candidate);
      });
    },
    [snapEnabled, getInternalNode, storeApi, setGhost],
  );

  const onNodeDragStop = useCallback(() => {
    cancelFrame();
    const ghost = useInteractionStore.getState().ghost;
    setGhost(null);
    if (ghost) onConnect(ghost.connection);
  }, [cancelFrame, setGhost, onConnect]);

  return { onNodeDragStart, onNodeDrag, onNodeDragStop };
}
