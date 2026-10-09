import type { PipelineDefinition } from "../types/pipeline";
import type {
  Job,
  JobListResponse,
  NodeResult,
  Pipeline,
  PipelineCreated,
  PipelineListResponse,
  PipelineRun,
  PipelineVersionSaved,
  PipelineVersionDetail,
} from "../types/api";

// Vite proxies /api/* to the backend and strips the /api prefix (see vite.config.ts).
const BASE = "/api/v1";

export interface UploadResult {
  path: string;
}

export interface PipelineRunResult {
  run: PipelineRun;
  node_results: NodeResult[];
}

// FastAPI errors arrive as { detail: string | { message } | ValidationIssue[] }.
function errorMessage(body: unknown, fallback: string): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((d) => (d as { msg?: string; message?: string }).msg ?? (d as { message?: string }).message ?? JSON.stringify(d)).join("; ");
  }
  if (detail && typeof detail === "object") {
    const { message, details } = detail as { message?: string; details?: { message: string }[] };
    if (details?.length) return `${message ?? fallback}: ${details.map((d) => d.message).join("; ")}`;
    if (message) return message;
  }
  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(errorMessage(body, `API error: ${response.status} ${response.statusText}`));
  }
  return (await response.json()) as T;
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export const files = {
  upload(file: File): Promise<UploadResult> {
    const formData = new FormData();
    formData.append("file", file);
    return request<UploadResult>("/upload", { method: "POST", body: formData });
  },
};

export const execution = {
  run(definition: PipelineDefinition): Promise<PipelineRunResult> {
    return request<PipelineRunResult>("/pipelines/run", json("POST", definition));
  },
};

export const jobs = {
  submit(displayName: string, definition: PipelineDefinition): Promise<Job> {
    return request<Job>("/jobs", json("POST", { display_name: displayName, pipeline_definition: definition }));
  },
  get(id: string): Promise<Job> {
    return request<Job>(`/jobs/${encodeURIComponent(id)}`);
  },
  list(skip = 0, limit = 10, status?: Job["status"]): Promise<JobListResponse> {
    const query = new URLSearchParams({ skip: String(skip), limit: String(limit) });
    if (status) query.set("status", status);
    return request<JobListResponse>(`/jobs?${query}`);
  },
  // The endpoint takes a JSON body even though `reason` is optional, so always send one.
  cancel(id: string, reason?: string): Promise<{ job_id: string; cancelled: boolean; reason: string }> {
    return request(`/jobs/${encodeURIComponent(id)}`, json("DELETE", reason ? { reason } : {}));
  },
};

export const pipelines = {
  create(name: string, definition?: PipelineDefinition): Promise<PipelineCreated> {
    return request<PipelineCreated>("/pipelines", json("POST", { name, definition }));
  },
  /** Saves `definition` as the pipeline's next version (no-op if unchanged) and applies `name`. */
  saveVersion(id: string, name: string, definition: PipelineDefinition): Promise<PipelineVersionSaved> {
    return request<PipelineVersionSaved>(`/pipelines/${encodeURIComponent(id)}/versions`, json("POST", { name, definition }));
  },
  get(id: string): Promise<Pipeline> {
    return request<Pipeline>(`/pipelines/${encodeURIComponent(id)}`);
  },
  /** The pipeline's name and the definition from its most recent saved version. */
  latestVersion(id: string): Promise<PipelineVersionDetail> {
    return request<PipelineVersionDetail>(`/pipelines/${encodeURIComponent(id)}/versions/latest`);
  },
  list(skip = 0, limit = 10): Promise<PipelineListResponse> {
    return request<PipelineListResponse>(`/pipelines?skip=${skip}&limit=${limit}`);
  },
  /** Every saved pipeline, fetched page by page so callers can search and sort the full set. */
  async listAll(pageSize = 100): Promise<Pipeline[]> {
    const byId = new Map<string, Pipeline>();
    for (let skip = 0; ; skip += pageSize) {
      const page = await pipelines.list(skip, pageSize);
      for (const p of page.pipelines) byId.set(p.id, p);
      if (page.pipelines.length < pageSize || skip + pageSize >= page.total) break;
    }
    return [...byId.values()];
  },
  delete(id: string): Promise<{ deleted: boolean; pipeline_id: string }> {
    return request(`/pipelines/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};
