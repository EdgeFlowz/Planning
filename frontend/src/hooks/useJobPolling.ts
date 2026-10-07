import { useEffect, useState } from "react";
import { jobs } from "../lib/api";
import type { Job } from "../types/api";

const POLL_MIN_INTERVAL_MS = 1000;
const POLL_MAX_INTERVAL_MS = 5000;
const TERMINAL_STATUSES: Job["status"][] = ["succeeded", "failed", "cancelled"];

/**
 * Polls GET /v1/jobs/{id} with exponential backoff (1s -> 5s) until the job
 * reaches a terminal status. Pass null to stop/reset polling.
 */
export function useJobPolling(jobId: string | null): { job: Job | null; error: string | null } {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setJob(null);
    setError(null);

    if (!jobId) {
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    let interval = POLL_MIN_INTERVAL_MS;

    const poll = async () => {
      try {
        const result = await jobs.get(jobId);
        if (cancelled) return;

        setJob(result);

        if (TERMINAL_STATUSES.includes(result.status)) {
          return;
        }

        interval = Math.min(interval * 2, POLL_MAX_INTERVAL_MS);
        timeoutId = setTimeout(poll, interval);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to poll job status");
      }
    };

    timeoutId = setTimeout(poll, interval);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [jobId]);

  return { job, error };
}
