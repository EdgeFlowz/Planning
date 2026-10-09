import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jobs, pipelines as pipelinesApi } from "../lib/api";
import { navigate } from "../lib/route";
import { useEditorStore } from "../store/editorStore";
import type { Pipeline } from "../types/api";
import { AppNav } from "./AppNav";
import { PipelineRunControl } from "./PipelineRunControl";

type SortKey = "updated" | "created" | "name";

const SORT_LABELS: Record<SortKey, string> = {
  updated: "Last updated",
  created: "Recently created",
  name: "Name (A–Z)",
};

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["minute", 60],
  ["hour", 3600],
  ["day", 86400],
  ["week", 604800],
  ["month", 2629800],
  ["year", 31557600],
];

/** "just now", "5 minutes ago", "yesterday", … — the largest unit that fits. */
function relativeTime(iso: string, now: number): string {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  let [unit, size] = RELATIVE_UNITS[0];
  for (const [u, s] of RELATIVE_UNITS) if (abs >= s) [unit, size] = [u, s];
  return relativeFormat.format(Math.round(seconds / size), unit);
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fullTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

function sortPipelines(list: Pipeline[], key: SortKey): Pipeline[] {
  const sorted = [...list];
  if (key === "name") sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  else {
    const field = key === "updated" ? "updated_at" : "created_at";
    sorted.sort((a, b) => new Date(b[field]).getTime() - new Date(a[field]).getTime());
  }
  return sorted;
}

export function PipelinesPage() {
  const [items, setItems] = useState<Pipeline[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updated");

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  /** Job started from this page for each pipeline id; its row polls and shows the status. */
  const [runJobIds, setRunJobIds] = useState<Record<string, string>>({});
  const [startingRunId, setStartingRunId] = useState<string | null>(null);

  // Relative times ("5 minutes ago") are computed against this, refreshed each minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const searchRef = useRef<HTMLInputElement>(null);
  const editorHasWork = useEditorStore((s) => s.nodes.length > 0);
  const resetEditor = useEditorStore((s) => s.reset);
  const loadPipelineFromDatabase = useEditorStore((s) => s.loadPipelineFromDatabase);

  useEffect(() => {
    let cancelled = false;
    pipelinesApi.listAll().then(
      (list) => {
        if (cancelled) return;
        setItems(list);
        setLoadError(null);
        setLoading(false);
      },
      (err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load pipelines");
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // "/" jumps to search, as in most list views — unless the user is already typing somewhere.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.closest("input, textarea, select, [contenteditable='true']");
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const refresh = () => {
    setLoading(true);
    setActionError(null);
    setReloadKey((k) => k + 1);
  };

  const visible = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    const matches = q
      ? items.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
      : items;
    return sortPipelines(matches, sortKey);
  }, [items, query, sortKey]);

  const handleNewPipeline = () => {
    if (editorHasWork && !window.confirm("Clear the current canvas and start a new pipeline?")) return;
    resetEditor();
    navigate("editor");
  };

  const handleRun = async (pipeline: Pipeline) => {
    setStartingRunId(pipeline.id);
    setActionError(null);
    try {
      const saved = await pipelinesApi.latestVersion(pipeline.id);
      // The worker attaches the run to the pipeline whose id is in the definition. Older saves
      // stored the name there, so always send the database id.
      const job = await jobs.submit(saved.name, { ...saved.definition, pipeline_id: pipeline.id });
      setRunJobIds((current) => ({ ...current, [pipeline.id]: job.id }));
    } catch (err) {
      setActionError(`Couldn't run "${pipeline.name}": ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setStartingRunId(null);
    }
  };

  const reportRunError = useCallback((message: string) => setActionError(message), []);

  const handleOpen = async (pipeline: Pipeline) => {
    if (openingId) return;
    if (editorHasWork && !window.confirm(`Replace the current canvas with "${pipeline.name}"?`)) return;
    setOpeningId(pipeline.id);
    setActionError(null);
    try {
      await loadPipelineFromDatabase(pipeline.id);
      navigate("editor");
    } catch (err) {
      setActionError(`Couldn't open "${pipeline.name}": ${err instanceof Error ? err.message : "unknown error"}`);
      setOpeningId(null);
    }
  };

  const handleDelete = async (pipeline: Pipeline) => {
    setDeletingId(pipeline.id);
    setActionError(null);
    try {
      await pipelinesApi.delete(pipeline.id);
      setItems((list) => list?.filter((p) => p.id !== pipeline.id) ?? null);
      setConfirmingId(null);
    } catch (err) {
      setActionError(`Couldn't delete "${pipeline.name}": ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setDeletingId(null);
    }
  };

  const handleCopyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500);
    } catch {
      setActionError("Couldn't copy to the clipboard.");
    }
  };

  const total = items?.length ?? 0;
  const firstLoad = loading && items === null;

  return (
    <>
      <header className="toolbar">
        <div className="toolbar-title">Pipeline Builder</div>
        <AppNav />
        <div className="toolbar-actions">
          <button className="primary-button" onClick={handleNewPipeline}>
            ＋ New pipeline
          </button>
        </div>
      </header>

      <main className="pipelines-page">
        <div className="pipelines-container">
          <div className="pipelines-heading">
            <h1>Pipelines</h1>
            <p className="pipelines-subtitle">
              {firstLoad
                ? "Loading saved pipelines…"
                : items === null
                  ? "Saved pipelines couldn't be loaded."
                  : total === 0
                    ? "No saved pipelines yet."
                    : `${total} saved pipeline${total === 1 ? "" : "s"} · click one to open it in the editor`}
            </p>
          </div>

          {items !== null && total > 0 && (
            <div className="pipelines-controls">
              <div className="pipelines-search">
                <input
                  ref={searchRef}
                  type="search"
                  placeholder="Search by name or ID"
                  aria-label="Search pipelines"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setQuery("");
                  }}
                />
                {!query && <kbd className="pipelines-search-hint">/</kbd>}
              </div>
              <label className="pipelines-sort">
                Sort
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                  {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                    <option key={key} value={key}>
                      {SORT_LABELS[key]}
                    </option>
                  ))}
                </select>
              </label>
              <button className="pipelines-refresh" onClick={refresh} disabled={loading} title="Reload from the server">
                {loading ? "Refreshing…" : "↻ Refresh"}
              </button>
            </div>
          )}

          {actionError && (
            <div className="pipelines-banner error" role="alert">
              <span>{actionError}</span>
              <button onClick={() => setActionError(null)} aria-label="Dismiss">
                ✕
              </button>
            </div>
          )}

          {firstLoad && (
            <div className="pipelines-card" aria-busy="true" aria-label="Loading pipelines">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="pipelines-skeleton-row">
                  <span className="skeleton skeleton-name" />
                  <span className="skeleton skeleton-date" />
                  <span className="skeleton skeleton-date" />
                </div>
              ))}
            </div>
          )}

          {!loading && items === null && loadError && (
            <div className="pipelines-card pipelines-empty">
              <div className="pipelines-empty-icon" aria-hidden="true">⚠️</div>
              <h2>Couldn't reach the pipeline service</h2>
              <p>{loadError}</p>
              <p className="pipelines-empty-help">
                Check that the backend is running on port 8000 and Postgres is up (<code>docker compose up -d</code>).
              </p>
              <button className="pipelines-primary" onClick={refresh}>
                Try again
              </button>
            </div>
          )}

          {items !== null && loadError && (
            <div className="pipelines-banner error" role="alert">
              <span>Refresh failed: {loadError}. Showing the last loaded list.</span>
            </div>
          )}

          {items !== null && total === 0 && (
            <div className="pipelines-card pipelines-empty">
              <div className="pipelines-empty-icon" aria-hidden="true">🗂️</div>
              <h2>No pipelines saved yet</h2>
              <p>Build a pipeline in the editor and click “Save Pipeline” — it will show up here.</p>
              <button className="pipelines-primary" onClick={() => navigate("editor")}>
                Open the editor
              </button>
            </div>
          )}

          {items !== null && total > 0 && visible.length === 0 && (
            <div className="pipelines-card pipelines-empty">
              <h2>No pipelines match “{query.trim()}”</h2>
              <p>Try a different name, or search by pipeline ID.</p>
              <button className="pipelines-secondary" onClick={() => setQuery("")}>
                Clear search
              </button>
            </div>
          )}

          {visible.length > 0 && (
            <div className="pipelines-card">
              <table className="pipelines-table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Last updated</th>
                    <th scope="col">Created</th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => {
                    const confirming = confirmingId === p.id;
                    const deleting = deletingId === p.id;
                    const opening = openingId === p.id;
                    const rowClass = ["pipeline-row", confirming && "confirming", opening && "opening"]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      // The whole row opens the pipeline for pointer users; the name button is the
                      // keyboard/screen-reader equivalent, so the row itself isn't a tab stop.
                      <tr key={p.id} className={rowClass} onClick={() => !confirming && handleOpen(p)}>
                        <td>
                          <button
                            className="pipeline-name"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpen(p);
                            }}
                            disabled={confirming || openingId !== null}
                            title="Open in the editor"
                          >
                            {p.name}
                            {opening && <span className="pipeline-opening"> Opening…</span>}
                          </button>
                          <button
                            className="pipeline-id"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyId(p.id);
                            }}
                            title={`${p.id} — click to copy`}
                          >
                            {copiedId === p.id ? "Copied ✓" : p.id.slice(0, 8)}
                          </button>
                        </td>
                        <td title={fullTimestamp(p.updated_at)}>{relativeTime(p.updated_at, now)}</td>
                        <td title={fullTimestamp(p.created_at)}>{shortDate(p.created_at)}</td>
                        <td className="pipeline-actions" onClick={(e) => e.stopPropagation()}>
                          {confirming ? (
                            <span className="pipeline-confirm">
                              <span>Delete this pipeline and its run history?</span>
                              <button className="danger" onClick={() => handleDelete(p)} disabled={deleting}>
                                {deleting ? "Deleting…" : "Delete"}
                              </button>
                              <button onClick={() => setConfirmingId(null)} disabled={deleting}>
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <>
                              <PipelineRunControl
                                pipelineName={p.name}
                                jobId={runJobIds[p.id] ?? null}
                                starting={startingRunId === p.id}
                                onRun={() => handleRun(p)}
                                onError={reportRunError}
                              />
                              <button
                                className="pipeline-delete"
                                onClick={() => setConfirmingId(p.id)}
                                aria-label={`Delete ${p.name}`}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
