import { useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import { useEditorStore } from "../store/editorStore";
import { useInteractionStore } from "../store/interactionStore";

/**
 * The canvas edge: a bezier with an arrow marker and a delete button that appears on hover.
 *
 * Registered for every edge (see PIPELINE_EDGE_TYPE in lib/serialize.ts) so loaded pipelines get
 * the same affordances as freshly drawn ones.
 */
export function PipelineEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  selected,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false);
  const removeEdge = useEditorStore((s) => s.removeEdge);
  const isSpliceTarget = useInteractionStore((s) => s.spliceEdgeId === id);

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const showButton = hovered || selected;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={style}
        className={isSpliceTarget ? "edge-splice-target" : undefined}
      />
      {/* A wide transparent stroke over the visible one — the rendered edge is ~1.5px, which is
          far too thin to hover reliably. */}
      <path
        d={path}
        fill="none"
        strokeWidth={20}
        stroke="transparent"
        className="edge-hover-target"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      {showButton && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="edge-delete-button"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={(event) => {
              event.stopPropagation();
              removeEdge(id);
            }}
            aria-label="Remove connection"
            title="Remove connection"
          >
            ×
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
