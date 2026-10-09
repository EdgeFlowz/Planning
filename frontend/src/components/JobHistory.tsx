import { Fragment, useCallback, useEffect, useState } from "react";
import { jobs } from "../lib/api";
import type { Job } from "../types/api";

const PAGE_SIZE = 10;
const ACTIVE_STATUSES: Job["status"][] = ["queued", "running"];
const STATUS_OPTIONS: Array<Job["status"] | "all"> = [
  "all",
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
];
const STATUS_ICON: Record<Job["status"], string> = {
  queued: "⏳",
  running: "▶",
  succeeded: "✓",
  failed: "✗",
  cancelled: "⊘",
};

function formatDuration(job: Job): string {
  if (!job.started_at) return "—";
  const end = job.completed_at ? new Date(job.completed_at) : new Date();
  const seconds = Math.max(0, (end.getTime() - new Date(job.started_at).getTime()) / 1000);
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

interface JobHistoryProps {
  onClose: () => void;
}

export function JobHistory({ onClose }: JobHistoryProps) {
  const [statusFilter, setStatusFilter] = useState<Job["status"] | "all">("all");
  const [skip, setSkip] = useState(0);
  const [jobList, setJobList] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await jobs.list(skip, PAGE_SIZE, statusFilter === "all" ? undefined : statusFilter);
      setJobList(res.jobs);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load job history");
    } finally {
      setLoading(false);
    }
  }, [skip, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the list fresh while any visible job is still queued/running.
  useEffect(() => {
    if (!jobList.some((j) => ACTIVE_STATUSES.includes(j.status))) return;
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [jobList, load]);

  const handleCancel = async (jobId: string) => {
    setCancellingId(jobId);
    try {
      await jobs.cancel(jobId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel job");
    } finally {
      setCancellingId(null);
    }
  };

  const handleStatusFilterChange = (value: Job["status"] | "all") => {
    setStatusFilter(value);
    setSkip(0);
  };

  const canPrev = skip > 0;
  const canNext = skip + PAGE_SIZE < total;

  return (
    <div className="job-history-panel">
      <div className="job-history-header">
        <h3>Run History</h3>
        <div className="job-history-filters">
          <select
            value={statusFilter}
            onChange={(e) => handleStatusFilterChange(e.target.value as Job["status"] | "all")}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === "all" ? "All statuses" : s}
              </option>
            ))}
          </select>
          <button onClick={load} disabled={loading} title="Refresh">
            🔄
          </button>
          <button className="job-history-close" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
      </div>

      {error && <div className="execution-error">❌ {error}</div>}

      {!error && jobList.length === 0 && !loading && (
        <p className="config-panel-hint">No jobs yet. Run a pipeline to see it here.</p>
      )}

      {jobList.length > 0 && (
        <table className="job-history-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Name</th>
              <th>Created</th>
              <th>Duration</th>
              <th>Retries</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {jobList.map((job) => (
              <Fragment key={job.id}>
                <tr
                  className="job-history-row"
                  onClick={() => setExpandedId(expandedId === job.id ? null : job.id)}
                >
                  <td>
                    <span className={`job-status-badge job-status-${job.status}`}>
                      {STATUS_ICON[job.status]} {job.status}
                    </span>
                  </td>
                  <td>{job.display_name}</td>
                  <td>{new Date(job.created_at).toLocaleString()}</td>
                  <td>{formatDuration(job)}</td>
                  <td>
                    {job.retry_count}/{job.max_retries}
                  </td>
                  <td>
                    {ACTIVE_STATUSES.includes(job.status) && (
                      <button
                        className="toolbar-toggle"
                        disabled={cancellingId === job.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCancel(job.id);
                        }}
                      >
                        {cancellingId === job.id ? "Cancelling..." : "Cancel"}
                      </button>
                    )}
                  </td>
                </tr>
                {expandedId === job.id && (job.error || job.result) && (
                  <tr className="job-history-detail-row">
                    <td colSpan={6}>
                      {job.error && <pre className="job-history-error">{job.error}</pre>}
                      {job.result && (
                        <div className="results-grid">
                          {job.result.node_results.map((r, i) => (
                            <div key={i} className="result-card">
                              <div className="result-node">
                                <strong>{r.node_id}</strong> <small>({r.node_type})</small>
                              </div>
                              <div className="result-stat">{r.rows.toLocaleString()} rows</div>
                              <div className="result-columns">{r.columns.length} columns</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      <div className="job-history-pagination">
        <button disabled={!canPrev} onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}>
          ← Prev
        </button>
        <span>
          {total === 0 ? "0" : `${skip + 1}-${Math.min(skip + PAGE_SIZE, total)}`} of {total}
        </span>
        <button disabled={!canNext} onClick={() => setSkip(skip + PAGE_SIZE)}>
          Next →
        </button>
      </div>
    </div>
  );
}
