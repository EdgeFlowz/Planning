import { useEffect, useRef, useState } from "react";
import { jobs } from "../lib/api";
import { useJobPolling } from "../hooks/useJobPolling";
import type { Job } from "../types/api";

/** After this long still queued, the likeliest cause is that no worker is running. */
const SLOW_QUEUE_MS = 10_000;

const ACTIVE: Job["status"][] = ["queued", "running"];

function duration(job: Job): string | null {
  if (!job.started_at || !job.completed_at) return null;
  const seconds = (new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

/** The worker stores the full traceback; its first line is the actual error. */
function errorSummary(job: Job | null): string | undefined {
  return job?.error?.split("\n")[0].trim() || undefined;
}

function resultSummary(job: Job): string | undefined {
  if (!job.result) return undefined;
  return job.result.node_results
    .map((r) => `${r.node_id}: ${r.rows.toLocaleString()} rows, ${r.columns.length} columns`)
    .join("\n");
}

interface PipelineRunControlProps {
  pipelineName: string;
  /** The job started from this row, or null if it hasn't been run from this page. */
  jobId: string | null;
  /** True while the definition is being fetched and the job submitted. */
  starting: boolean;
  onRun: () => void;
  /** Reports a failed run or a failed stop request, for the page's error banner. */
  onError: (message: string) => void;
}

/** The ▶ Run / ■ Stop button for one pipeline row, plus the status of the run it started. */
export function PipelineRunControl({ pipelineName, jobId, starting, onRun, onError }: PipelineRunControlProps) {
  const { job, error: pollError } = useJobPolling(jobId);
  const [slow, setSlow] = useState(false);
  const [stopping, setStopping] = useState(false);
  const reportedFor = useRef<string | null>(null);

  // Until the first poll lands, a just-submitted job is queued.
  const status: Job["status"] | null = job?.status ?? (jobId ? "queued" : null);
  const active = status !== null && ACTIVE.includes(status);

  useEffect(() => {
    if (!jobId) return;
    const id = setTimeout(() => setSlow(true), SLOW_QUEUE_MS);
    return () => {
      clearTimeout(id);
      setSlow(false);
    };
  }, [jobId]);

  // Surface a failure once per job, in the page banner where there's room for the message.
  useEffect(() => {
    if (!job || reportedFor.current === job.id) return;
    if (job.status === "failed") {
      reportedFor.current = job.id;
      onError(`"${pipelineName}" failed: ${errorSummary(job) ?? "unknown error"}`);
    }
  }, [job, pipelineName, onError]);

  const handleStop = async () => {
    if (!jobId) return;
    setStopping(true);
    try {
      await jobs.cancel(jobId);
    } catch (err) {
      onError(`Couldn't stop "${pipelineName}": ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setStopping(false);
    }
  };

  let pill: { text: string; tone: Job["status"]; title?: string } | null = null;
  if (pollError) pill = { text: "Status unavailable", tone: "failed", title: pollError };
  else if (status === "queued" && slow)
    pill = { text: "Waiting for a worker…", tone: "queued", title: "Still queued — is the worker running? (scripts/dev.sh starts it)" };
  else if (status === "queued") pill = { text: "Queued", tone: "queued" };
  else if (status === "running" && job && job.retry_count > 0)
    // The worker retries failed attempts with backoff before giving up, which can take a while.
    pill = { text: `Retrying (${job.retry_count}/${job.max_retries})…`, tone: "running", title: errorSummary(job) };
  else if (status === "running") pill = { text: "Running…", tone: "running" };
  else if (status === "succeeded" && job)
    pill = { text: `Succeeded${duration(job) ? ` · ${duration(job)}` : ""}`, tone: "succeeded", title: resultSummary(job) };
  else if (status === "failed") pill = { text: "Failed", tone: "failed", title: errorSummary(job) };
  else if (status === "cancelled") pill = { text: "Cancelled", tone: "cancelled" };

  return (
    <span className="pipeline-run">
      {pill && (
        <span className={`pipeline-run-status run-${pill.tone}`} title={pill.title} aria-live="polite">
          {pill.text}
        </span>
      )}
      {active ? (
        <button className="pipeline-run-button stop" onClick={handleStop} disabled={stopping} aria-label={`Stop ${pipelineName}`}>
          {stopping ? "Stopping…" : "■ Stop"}
        </button>
      ) : (
        <button
          className="pipeline-run-button"
          onClick={onRun}
          disabled={starting}
          aria-label={`Run ${pipelineName}`}
          title="Run the latest saved version"
        >
          {starting ? "Starting…" : "▶ Run"}
        </button>
      )}
    </span>
  );
}
