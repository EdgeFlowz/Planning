import { useMemo } from "react";
import { useEditorStore } from "../store/editorStore";
import { toPipelineDefinition } from "../lib/serialize";

export function JsonPreview() {
  const pipelineId = useEditorStore((s) => s.pipelineId);
  const nodes = useEditorStore((s) => s.nodes);
  const edges = useEditorStore((s) => s.edges);

  const json = useMemo(
    () => JSON.stringify(toPipelineDefinition(pipelineId, nodes, edges), null, 2),
    [pipelineId, nodes, edges],
  );

  return (
    <section className="json-preview">
      <h2>Pipeline Definition</h2>
      <pre>{json}</pre>
    </section>
  );
}
