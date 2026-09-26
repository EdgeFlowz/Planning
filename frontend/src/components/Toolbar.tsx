import { useMemo, useState } from "react";
import { useEditorStore } from "../store/editorStore";
import { useCatalogueStore } from "../store/catalogueStore";
import { validatePipeline } from "../lib/graph";
import { toPipelineDefinition, downloadJson } from "../lib/serialize";
import { parseCsvText } from "../lib/csv";
import type { PipelineDefinition } from "../types/pipeline";
import type { NodeResult } from "../types/api";

export function Toolbar() {
  const pipelineId = useEditorStore((s) => s.pipelineId);
  const setPipelineId = useEditorStore((s) => s.setPipelineId);
  const nodes = useEditorStore((s) => s.nodes);
  const edges = useEditorStore((s) => s.edges);
  const loadPipeline = useEditorStore((s) => s.loadPipeline);
  const reset = useEditorStore((s) => s.reset);
  const flowDirection = useEditorStore((s) => s.flowDirection);
  const setFlowDirection = useEditorStore((s) => s.setFlowDirection);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const setSnapEnabled = useEditorStore((s) => s.setSnapEnabled);
  const catalogueEntries = useCatalogueStore((s) => s.entries);

  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<NodeResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const definition = useMemo(
    () => toPipelineDefinition(pipelineId, nodes, edges),
    [pipelineId, nodes, edges],
  );

  const issues = useMemo(
    () => validatePipeline(definition.nodes, definition.edges, catalogueEntries),
    [definition, catalogueEntries],
  );

  const handleExport = () => {
    downloadJson(`${pipelineId || "pipeline"}.json`, definition);
  };

  const handleRunPipeline = async () => {
    setRunning(true);
    setError(null);
    setResults(null);

    try {
      const response = await fetch("/api/pipelines/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(definition),
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { detail?: string };
        throw new Error(errorData.detail || `API error: ${response.statusText}`);
      }

      const data = (await response.json()) as { node_results: NodeResult[] };
      setResults(data.node_results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pipeline execution failed");
    } finally {
      setRunning(false);
    }
  };

  const handleLoadExample = async () => {
    const [definitionRes, csvRes] = await Promise.all([
      fetch("/examples/sales_pipeline.json"),
      fetch("/examples/sales.csv"),
    ]);
    const exampleDefinition = (await definitionRes.json()) as PipelineDefinition;
    const csvText = await csvRes.text();
    const table = parseCsvText(csvText);

    const sourceNode = exampleDefinition.nodes.find((n) => n.type === "source.csv");
    loadPipeline(exampleDefinition, sourceNode ? { [sourceNode.id]: table } : {});
  };

  return (
    <header className="toolbar">
      <div className="toolbar-title">Pipeline Builder</div>
      <label className="toolbar-pipeline-id">
        Pipeline ID
        <input value={pipelineId} onChange={(e) => setPipelineId(e.target.value)} />
      </label>

      <div className={`validation-badge ${issues.length === 0 ? "valid" : "invalid"}`}>
        {issues.length === 0 ? "Valid" : `${issues.length} issue${issues.length === 1 ? "" : "s"}`}
      </div>

      <div className="toolbar-actions">
        <button
          className={`toolbar-toggle${snapEnabled ? " on" : ""}`}
          onClick={() => setSnapEnabled(!snapEnabled)}
          aria-pressed={snapEnabled}
          title="Connect nodes automatically when dragged near each other"
        >
          🧲 Snap
        </button>
        <button
          className="toolbar-toggle"
          onClick={() => setFlowDirection(flowDirection === "vertical" ? "horizontal" : "vertical")}
          title={`Flow runs ${flowDirection === "vertical" ? "top to bottom" : "left to right"} — click to switch`}
        >
          {flowDirection === "vertical" ? "⇅ Vertical" : "⇄ Horizontal"}
        </button>
        <button onClick={handleLoadExample}>Load Example</button>
        <button onClick={reset}>Reset</button>
        <button className="primary-button" onClick={handleExport}>
          Export JSON
        </button>
        <button
          className="primary-button"
          onClick={handleRunPipeline}
          disabled={running || issues.length > 0}
          title={issues.length > 0 ? "Fix validation issues before running" : "Execute the pipeline"}
        >
          {running ? "Running..." : "▶ Run Pipeline"}
        </button>
      </div>

      {issues.length > 0 && (
        <ul className="validation-issues">
          {issues.map((issue, i) => (
            <li key={i}>{issue.message}</li>
          ))}
        </ul>
      )}

      {error && (
        <div className="execution-error">
          ❌ {error}
        </div>
      )}

      {results && (
        <div className="execution-results">
          <h3>✓ Pipeline executed successfully</h3>
          <div className="results-grid">
            {results.map((result, i) => (
              <div key={i} className="result-card">
                <div className="result-node">
                  <strong>{result.node_id}</strong> <small>({result.node_type})</small>
                </div>
                {result.port !== "output" && <div className="result-port">port: {result.port}</div>}
                <div className="result-stat">{result.rows.toLocaleString()} rows</div>
                <div className="result-columns">{result.columns.length} columns</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
