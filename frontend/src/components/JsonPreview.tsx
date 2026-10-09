import { useMemo } from "react";
import { currentDefinition, useEditorStore } from "../store/editorStore";

export function JsonPreview() {
  const pipelineId = useEditorStore((s) => s.pipelineId);
  const savedPipelineId = useEditorStore((s) => s.savedPipelineId);
  const nodes = useEditorStore((s) => s.nodes);
  const edges = useEditorStore((s) => s.edges);

  const json = useMemo(
    () => JSON.stringify(currentDefinition({ pipelineId, savedPipelineId, nodes, edges }), null, 2),
    [pipelineId, savedPipelineId, nodes, edges],
  );

  return (
    <section className="json-preview">
      <h2>Pipeline Definition</h2>
      <pre>{json}</pre>
    </section>
  );
}
