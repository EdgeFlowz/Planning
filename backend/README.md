# Backend — Pipeline Builder API & Worker

FastAPI service + background worker for defining, validating, and executing data pipelines
(Polars-based transforms), backed by PostgreSQL (metadata) and Redis/RQ (async job queue).

## Prerequisites

- Python 3.13+ and [`uv`](https://docs.astral.sh/uv/)
- Docker (for Redis, and optionally a local Postgres)
- A reachable PostgreSQL database

## Setup

```bash
uv sync                      # install dependencies into .venv
cp .env.example .env         # then edit .env — set DATABASE_URL at minimum
uv run alembic upgrade head  # create/update schema
```

`.env` keys (see `.env.example`):
- `DATABASE_URL` — SQLAlchemy connection string, e.g.
  `postgresql+psycopg://user:password@localhost:5432/planning`
- `REDIS_HOST` / `REDIS_PORT` / `REDIS_DB` — default to `localhost:6379/0`, matching
  `docker-compose.yml`

## Running

Each of these runs in the foreground — use separate terminals (or `&` to background them).

```bash
# Redis (required by the job queue)
docker-compose up redis

# API server
uv run uvicorn app.main:app --port 8000 --reload

# Worker (processes jobs from the queue)
uv run python -m worker.main
```

API docs are served at `http://localhost:8000/docs` once the server is running.

### Prometheus metrics

The API exposes Prometheus-formatted HTTP metrics at `http://localhost:8000/metrics`.
`/v1/metrics` is also available for clients using the versioned API route convention
(including the frontend's `/api` proxy):

- `pipeline_api_http_requests_total` — request count by method, matched route, and status code
- `pipeline_api_http_request_duration_seconds` — request latency histogram by method and route
- `pipeline_api_http_requests_in_progress` — current number of in-flight requests

The `/metrics` scrape endpoint is excluded from its own measurements. Unmatched paths use a
single `__unmatched__` route label to avoid high-cardinality labels.

## Testing

```bash
uv run pytest tests/ -v
```

`tests/conftest.py` wraps each test in a transaction/SAVEPOINT that's rolled back at teardown, so
tests are safe to run against the same database configured in `.env` — no separate test database
or schema create/drop is required (and none should be added; see repo notes on this).

## Manual job-queue validation

[`../QUICK_START_TESTING.md`](../QUICK_START_TESTING.md) has a full manual checklist (CLI tool,
curl examples, expected statuses) for exercising the async job queue end-to-end. There's also a
CLI helper for ad-hoc testing:

```bash
uv run python scripts/test_jobs_cli.py submit "My Pipeline"
uv run python scripts/test_jobs_cli.py status <job_id>
uv run python scripts/test_jobs_cli.py wait <job_id>
uv run python scripts/test_jobs_cli.py list [--status running]
uv run python scripts/test_jobs_cli.py cancel <job_id>
```

## Project layout

```
app/
  main.py            FastAPI app, routes, job submission
  config.py           Settings (reads .env)
  domain/              Pipeline/validation domain models
  execution/           Pipeline executor
  transformations/      Transform registry + expression DSL
  connectors/           Source/sink connectors
worker/
  main.py              Worker entrypoint (RQ SimpleWorker — see note below)
  executor.py           Job execution + retry logic
alembic/                DB migrations (`uv run alembic revision --autogenerate -m "..."`)
scripts/test_jobs_cli.py  Manual job-queue testing CLI
tests/                  Unit + integration tests
```

**Note:** the worker uses RQ's `SimpleWorker` (in-process, no `fork()`) rather than the default
`Worker`, because forking after Polars/SQLAlchemy have started background threads crashes with
SIGABRT on macOS. Don't switch this back to `Worker` without addressing that first.

## Further docs

- [PHASE3_JOB_QUEUE_GUIDE.md](./PHASE3_JOB_QUEUE_GUIDE.md) — job queue design/implementation guide
- [PHASE3_TESTING_GUIDE.md](./PHASE3_TESTING_GUIDE.md) — detailed testing guide
- [../requirements.md](../requirements.md) — full product/technical requirements
