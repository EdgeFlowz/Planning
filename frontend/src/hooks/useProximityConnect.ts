import { useCallback, useEffect, useRef } from "react";
import { useReactFlow, useStoreApi, type Node } from "@xyflow/react";
import { useEditorStore } from "../store/editorStore";
import { useCatalogueStore } from "../store/catalogueStore";
import { useInteractionStore } from "../store/interactionStore";
import { findBestPair, nodeGeometry, sameCandidate, snapPosition, type NodeGeometry } from "../lib/proximity";

/**
 * Auto-connects nodes that are dragged near each other.
 *
 * While a node is being dragged we look for the closest legal handle pairing and publish it to
 * the interaction store as a "ghost"; on release, the ghost is committed through the store's
 * existing `onConnect`, which already replaces rather than stacks inputs, and the node is nudged
 * to sit a short, fixed distance from its new neighbour. Nothing is written to the pipeline until
 * the user lets go, so an aborted drag leaves no trace.
 */
export function useProximityConnect() {
  const storeApi = useStoreApi();
  const { getInternalNode } = useReactFlow();
  const onConnect = useEditorStore((s) => s.onConnect);
  const onNodesChange = useEditorStore((s) => s.onNodesChange);
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

  /** The dragged node's geometry, the best connection for where it is now, and everything else. */
  const evaluate = useCallback(
    (nodeId: string) => {
      const dragged = getInternalNode(nodeId);
      if (!dragged) return null;

      const geometry = nodeGeometry(dragged);
      if (geometry.points.length === 0) return null;

      const others: NodeGeometry[] = [];
      for (const other of storeApi.getState().nodeLookup.values()) {
        if (other.id !== nodeId) others.push(nodeGeometry(other));
      }

      const { nodes, edges, flowDirection } = useEditorStore.getState();
      const entries = useCatalogueStore.getState().entries;
      const candidate = findBestPair(geometry, others, { nodes, edges, entries }, flowDirection);
      return { geometry, others, candidate, flowDirection };
    },
    [getInternalNode, storeApi],
  );

  const onNodeDrag = useCallback(
    (_event: unknown, node: Node) => {
      if (!snapEnabled) return;
      if (frame.current !== null) return;

      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const candidate = evaluate(node.id)?.candidate ?? null;
        const current = useInteractionStore.getState().ghost;
        if (!sameCandidate(candidate, current)) setGhost(candidate);
      });
    },
    [snapEnabled, evaluate, setGhost],
  );

  const onNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      cancelFrame();
      setGhost(null);
      if (!snapEnabled) return;

      // Judge the release position itself rather than the last throttled frame, which can lag
      // the pointer by one frame.
      const result = evaluate(node.id);
      if (!result?.candidate) return;

      const { geometry, others, candidate, flowDirection } = result;
      onConnect(candidate.connection);
      const position = snapPosition(
        candidate,
        geometry.rect,
        flowDirection,
        others.map((g) => g.rect),
      );
      onNodesChange([{ type: "position", id: node.id, position }]);
    },
    [cancelFrame, setGhost, snapEnabled, evaluate, onConnect, onNodesChange],
  );

  return { onNodeDragStart, onNodeDrag, onNodeDragStop };
}
