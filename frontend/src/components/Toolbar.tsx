import { useMemo, useState } from "react";
import { currentDefinition, snapshotOf, useEditorStore, type SaveOutcome } from "../store/editorStore";
import { useCatalogueStore } from "../store/catalogueStore";
import { validatePipeline } from "../lib/graph";
import { downloadJson } from "../lib/serialize";
import { parseCsvText } from "../lib/csv";
import { jobs } from "../lib/api";
import { useJobPolling } from "../hooks/useJobPolling";
import { JobHistory } from "./JobHistory";
import { AppNav } from "./AppNav";
import { hrefFor } from "../lib/route";
import type { PipelineDefinition } from "../types/pipeline";

const ACTIVE_STATUSES = ["queued", "running"];

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
  const savedPipelineId = useEditorStore((s) => s.savedPipelineId);
  const savedVersion = useEditorStore((s) => s.savedVersion);
  const savedSnapshot = useEditorStore((s) => s.savedSnapshot);
  const savePipeline = useEditorStore((s) => s.savePipeline);
  const savePipelineAsNew = useEditorStore((s) => s.savePipelineAsNew);
  const catalogueEntries = useCatalogueStore((s) => s.entries);

  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const { job, error: pollError } = useJobPolling(activeJobId);
  const jobIsActive = job !== null && ACTIVE_STATUSES.includes(job.status);

  const definition = useMemo(
    () => currentDefinition({ pipelineId, savedPipelineId, nodes, edges }),
    [pipelineId, savedPipelineId, nodes, edges],
  );

  const hasUnsavedChanges = useMemo(
    () => savedSnapshot !== snapshotOf({ pipelineId, savedPipelineId, nodes, edges }),
    [savedSnapshot, pipelineId, savedPipelineId, nodes, edges],
  );

  const saveStatus = !savedPipelineId
    ? { text: "Not saved", tone: "muted" }
    : hasUnsavedChanges
      ? { text: "Unsaved changes", tone: "warn" }
      : { text: `Saved · v${savedVersion}`, tone: "ok" };

  const issues = useMemo(
    () => validatePipeline(definition.nodes, definition.edges, catalogueEntries),
    [definition, catalogueEntries],
  );

  const handleExport = () => {
    downloadJson(`${pipelineId || "pipeline"}.json`, definition);
  };

  const describeSave = (outcome: SaveOutcome): string => {
    switch (outcome.kind) {
      case "created":
        return `Saved "${outcome.name}" as a new pipeline`;
      case "version":
        return `Saved "${outcome.name}" as version ${outcome.version}`;
      case "renamed":
        return `Renamed to "${outcome.name}" (still version ${outcome.version})`;
      case "unchanged":
        return `No changes since version ${outcome.version} of "${outcome.name}"`;
    }
  };

  const runSave = async (save: () => Promise<SaveOutcome>) => {
    if (!pipelineId.trim()) {
      setError("Please enter a pipeline name before saving");
      return;
    }

    setSaving(true);
    setError(null);
    setSaveSuccess(null);

    try {
      setSaveSuccess(describeSave(await save()));
      setTimeout(() => setSaveSuccess(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save pipeline");
    } finally {
      setSaving(false);
    }
  };

  const handleRunPipeline = async () => {
    setSubmitting(true);
    setError(null);
    setActiveJobId(null);

    try {
      const submitted = await jobs.submit(pipelineId || "Untitled Pipeline", definition);
      setActiveJobId(submitted.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit pipeline job");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelJob = async () => {
    if (!activeJobId) return;

    try {
      await jobs.cancel(activeJobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel job");
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

  const runButtonLabel = submitting
    ? "Submitting..."
    : job?.status === "queued"
      ? "⏳ Queued..."
      : job?.status === "running"
        ? "▶ Running..."
        : "▶ Run Pipeline";

  return (
    <header className="toolbar">
      <div className="toolbar-title">Pipeline Builder</div>
      <AppNav />
      <label className="toolbar-pipeline-id">
        <span className="toolbar-pipeline-label">
          Pipeline name
          <span className={`save-status save-status-${saveStatus.tone}`} aria-live="polite">
            {saveStatus.text}
          </span>
        </span>
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
        <button
          className={`toolbar-toggle${historyOpen ? " on" : ""}`}
          onClick={() => setHistoryOpen((o) => !o)}
          aria-pressed={historyOpen}
          title="View past job runs"
        >
          🕘 History
        </button>
        <button className="primary-button" onClick={handleExport}>
          Export JSON
        </button>
        <button
          className="primary-button"
          onClick={() => runSave(savePipeline)}
          disabled={saving}
          title={
            savedPipelineId
              ? `Save as the next version of "${pipelineId.trim() || "this pipeline"}"`
              : "Save this pipeline to the database"
          }
        >
          {saving ? "Saving..." : "💾 Save"}
        </button>
        {savedPipelineId && (
          <button
            onClick={() => runSave(savePipelineAsNew)}
            disabled={saving}
            title="Save a copy as a separate pipeline, leaving the original unchanged"
          >
            Save copy
          </button>
        )}
        <button
          className="primary-button"
          onClick={handleRunPipeline}
          disabled={submitting || jobIsActive || issues.length > 0}
          title={issues.length > 0 ? "Fix validation issues before running" : "Submit the pipeline for execution"}
        >
          {runButtonLabel}
        </button>
        {jobIsActive && (
          <button className="toolbar-toggle" onClick={handleCancelJob} title="Cancel the running job">
            ✕ Cancel
          </button>
        )}
      </div>

      {historyOpen && <JobHistory onClose={() => setHistoryOpen(false)} />}

      {issues.length > 0 && (
        <ul className="validation-issues">
          {issues.map((issue, i) => (
            <li key={i}>{issue.message}</li>
          ))}
        </ul>
      )}

      {(error || pollError || job?.error) && (
        <div className="execution-error">
          ❌ {error || pollError || job?.error}
        </div>
      )}

      {saveSuccess && (
        <div className="execution-success">
          {saveSuccess} — <a href={hrefFor("pipelines")}>view all pipelines</a>
        </div>
      )}

      {job?.status === "cancelled" && (
        <div className="execution-error">Job cancelled</div>
      )}

      {job?.status === "succeeded" && job.result && (
        <div className="execution-results">
          <h3>✓ Pipeline executed successfully</h3>
          <div className="results-grid">
            {job.result.node_results.map((result, i) => (
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

