import type { PipelineDefinition } from "../types/pipeline";
import type { NodeResult, Pipeline, PipelineListResponse, PipelineRun } from "../types/api";

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

export const pipelines = {
  create(name: string, definition?: PipelineDefinition): Promise<Pipeline> {
    return request<Pipeline>("/pipelines", json("POST", { name, definition }));
  },
  get(id: string): Promise<Pipeline> {
    return request<Pipeline>(`/pipelines/${encodeURIComponent(id)}`);
  },
  list(skip = 0, limit = 10): Promise<PipelineListResponse> {
    return request<PipelineListResponse>(`/pipelines?skip=${skip}&limit=${limit}`);
  },
  delete(id: string): Promise<{ deleted: boolean; pipeline_id: string }> {
    return request(`/pipelines/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};
