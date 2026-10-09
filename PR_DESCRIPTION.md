# Pull Request: Phase 3 async jobs, infrastructure, history, and metrics

## Summary

Implement the Phase 3 background job workflow end-to-end: local service setup, PostgreSQL-backed job records, Redis/RQ queueing, a separate worker, versioned job API endpoints, frontend submission and monitoring, run history, and Prometheus HTTP metrics. Fix the retry failure path so exhausted jobs are written as `failed` instead of being left indefinitely as `running`.

## What’s included

### Local infrastructure and configuration

- Add `backend/docker-compose.yml` services for Redis 7 and optional PostgreSQL 15.
- Configure container health checks, named data volumes, ports, and a dedicated network.
- Add `backend/.env.example` with placeholder-only database and Redis settings; no real credentials are included.
- Declare Redis, RQ, PostgreSQL driver, SQLAlchemy/Alembic, and Prometheus client dependencies in the `uv` project configuration.
- Document the `uv` setup, environment-file, migration, API, and worker commands in the root, backend, and frontend READMEs.

### PostgreSQL job persistence

- Add the `jobs` table and Alembic migration, including pipeline JSON, status, result/error, retry counters, and lifecycle timestamps.
- Add the `Job`/`JobStatus` domain model and API response/request schemas.
- Add `JobRepository` operations for create, lookup, status/result updates, retry-count increments, listing/filtering, and deletion.
- Add a status/creation-time index for job-list queries.

### Redis/RQ queue and worker

- Add a `JobQueueClient` abstraction for enqueueing jobs, reading status/results/errors, cancellation, and queue/registry counts.
- Add Redis configuration and a worker entry point that consumes the `default` queue and supports a configurable worker count.
- Use RQ `SimpleWorker` to avoid the macOS fork-related crash encountered with Polars/SQLAlchemy.
- Enqueue jobs with a four-hour execution timeout and persist worker progress/results/errors to PostgreSQL.
- Replace the broken bare-raise retry assumption with in-process retries and exponential backoff, capped at 30 seconds. Validation failures are not retried; the final outcome is persisted. Re-check cancellation between attempts.

### Job API

- `POST /v1/jobs` — validate, persist, and enqueue a pipeline; return the queued job.
- `GET /v1/jobs/{job_id}` — return status, timestamps, retry information, result, or error.
- `GET /v1/jobs` — return a paginated job list with optional status filtering.
- `DELETE /v1/jobs/{job_id}` — cancel an eligible job and record the cancellation reason/time.

### Frontend job workflow and run history

- Wire the toolbar’s Run action to asynchronous job submission and polling; show queued/running state, errors/results, and cancellation.
- Add a Run History panel with status filtering, pagination, refresh, and automatic refresh while listed jobs are active.
- Allow cancellation from history and expand rows to inspect error details or node-result summaries.
- Keep the client-side job and response types aligned with the API.

### Prometheus metrics

- Expose Prometheus text metrics at `/metrics`, `/v1/metrics`, and `/api/v1/metrics` for direct and frontend-proxy access.
- Record HTTP request totals by method/route/status, request-duration histograms, and in-progress request count.
- Exclude metrics scrapes from their own observations and use bounded route labels.

### Filter literal type stopgap

- Add a Text/Number/Yes-No selector for fixed filter operands to avoid treating numeric and boolean literals as strings.
- Automatic inference from the selected column’s dtype remains deferred.

## Local setup

From `backend/` (or use an existing reachable PostgreSQL instance):

1. Install dependencies with `uv sync`.
2. Copy `.env.example` to `.env`. For the Compose PostgreSQL service, set `DATABASE_URL` to `postgresql+psycopg://postgres:postgres@localhost:5432/pipeline_builder`; otherwise use the connection string for your existing database. Redis defaults to `localhost:6379/0`.
3. Start Redis with `docker-compose up redis`. If using the Compose PostgreSQL service instead of an existing database, start it too with `docker-compose up postgres`.
4. Apply migrations with `uv run alembic upgrade head`.
5. Run the API with `uv run uvicorn app.main:app --port 8000 --reload` and the worker with `uv run python -m worker.main` in separate terminals.
6. Start the frontend with `npm install` and `npm run dev` from `frontend/`.

The API docs are available at `/docs`; Prometheus metrics are available at `/metrics`.

## Verification

- Retry regression check: a job with a nonexistent source file reached `failed`, recorded `retry_count=3/3`, and set `completed_at` instead of remaining `running`.
- Job queue/API tests (`tests/test_queue.py`, `tests/test_jobs.py`): 30 passed.
- Metrics and pipeline API tests (`tests/test_metrics.py`, `tests/test_api.py`): 3 passed.
- Frontend TypeScript check completed successfully. Oxlint reports a `react(set-state-in-effect)` warning for the initial Run History data load.
- Browser verification covered job submission/polling/cancellation and Run History listing, pagination, row details, and panel open/close.
- Metrics endpoint was verified after a fresh server start: requesting `/health` then scraping `/metrics` produced the expected request counter and latency histogram sample.

## Out of scope / follow-up

- WebSocket progress updates (the frontend currently polls).
- Worker/job-level Prometheus metrics and a performance dashboard for queue depth/job timing.
- Manual retry action from Run History.
- Hard interruption/partial-result preservation for an already executing cancelled job.
- Automatic filter-literal type inference from column schema.
