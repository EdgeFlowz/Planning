# Phase 3.1: Async Job Queue Implementation Guide

This guide explains how to use the async job queue system for executing pipelines asynchronously.

## Architecture Overview

The job queue system consists of three components:

```
┌─────────────────────────────────┐
│  Frontend / API Client          │
│  - Submit pipeline              │
│  - Poll for status              │
└──────────────┬──────────────────┘
               │
┌──────────────▼──────────────────────┐
│  FastAPI Backend (/v1/jobs)         │
│  - Submit: POST /v1/jobs            │
│  - Poll:   GET  /v1/jobs/{job_id}  │
│  - Cancel: DELETE /v1/jobs/{job_id} │
│  - List:   GET  /v1/jobs            │
└──────────────┬──────────────────────┘
               │
        ┌──────▼───────┐
        │   Redis      │
        │   Queue      │
        └──────┬───────┘
               │
┌──────────────▼──────────────────────┐
│  Background Worker                  │
│  - Picks jobs from queue            │
│  - Executes pipelines               │
│  - Retries on failure               │
│  - Updates job status in DB         │
└─────────────────────────────────────┘
```

## Quick Start

### 1. Start Infrastructure (Redis + PostgreSQL)

```bash
cd /Users/ben/Planning/backend

# Start Redis and PostgreSQL
docker-compose up -d

# Verify services are running
docker-compose ps
```

Expected output:
```
CONTAINER ID   IMAGE           STATUS        PORTS
...            redis:7         Up (healthy)  0.0.0.0:6379->6379/tcp
...            postgres:15     Up (healthy)  0.0.0.0:5432->5432/tcp
```

### 2. Start Backend API

In a separate terminal:

```bash
cd /Users/ben/Planning/backend

# Install/sync dependencies
uv sync

# Start API server
uv run uvicorn app.main:app --port 8000 --reload

# Or with multiple worker threads (if you have uvicorn workers plugin)
# uv run uvicorn app.main:app --port 8000 --workers 2
```

Expected output:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO:     Application startup complete
```

### 3. Start Background Worker

In a separate terminal:

```bash
cd /Users/ben/Planning/backend

# Start worker (single process)
python -m worker.main

# Or start multiple workers (for higher throughput)
# python -m worker.main --workers 3
```

Expected output:
```
INFO - Starting 1 worker(s)...
INFO - Redis: localhost:6379
INFO - Database: postgresql://...
INFO - Job timeout: 14400s (4.0h)
INFO - Worker 'default' started, processing jobs...
```

The worker will now continuously process jobs from the queue.

### 4. Run End-to-End Test

In a separate terminal:

```bash
cd /Users/ben/Planning/backend

python -m tests.test_job_queue_end_to_end
```

This will:
1. ✅ Check API health
2. 🚀 Submit a test pipeline for execution
3. ⏳ Poll for job status (with exponential backoff)
4. ✅ Display results when complete

Expected output:
```
============================================================
ASYNC JOB QUEUE TEST
============================================================

🔍 Checking API health...
✅ API is healthy

📋 Test pipeline created:
   Nodes: ['source_1', 'transform_1']
   Edges: 1

🚀 Submitting pipeline for async execution...
✅ Job submitted successfully!
   Job ID: 550e8400-e29b-41d4-a716-446655440000
   Status: queued
   Display Name: Test Run #1

⏳ Polling job status (max 300.0s)...
   [1.0s] ⏳ Status: queued
   [3.0s] 🔄 Status: running
   [5.1s] ✅ Status: succeeded

✅ Job execution complete after 5.1s (3 polls)

============================================================
JOB EXECUTION RESULTS
============================================================

Job ID: 550e8400-e29b-41d4-a716-446655440000
Display Name: Test Run #1
Status: succeeded
Retries: 0/3

Timestamps:
  Created: 2026-10-06T15:30:00+00:00
  Started: 2026-10-06T15:30:01+00:00
  Completed: 2026-10-06T15:30:04+00:00

✅ SUCCESS

Execution Results:

  Node: source_1 (source.csv)
    Rows: 100
    Columns: Date, Product, Amount...

  Node: transform_1 (transform.select)
    Rows: 100
    Columns: Amount, Product...

============================================================
```

---

## API Usage

### Submit Job (Async)

Submit a pipeline for background execution and get a job_id immediately.

```bash
curl -X POST http://localhost:8000/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "Monthly Sales Report",
    "pipeline_definition": {
      "schema_version": 1,
      "pipeline_id": "sales-report",
      "nodes": [
        {
          "id": "source",
          "type": "source.csv",
          "config": {"path": "sales.csv"}
        }
      ],
      "edges": []
    }
  }'
```

Response:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "display_name": "Monthly Sales Report",
  "status": "queued",
  "result": null,
  "error": null,
  "retry_count": 0,
  "max_retries": 3,
  "created_at": "2026-10-06T15:30:00+00:00",
  "started_at": null,
  "completed_at": null,
  "cancelled_at": null
}
```

### Poll Job Status

Use the `job_id` to poll for status and results. Use exponential backoff (1s, 2s, 4s..., max 5s).

```bash
# Check status every 2 seconds
curl http://localhost:8000/v1/jobs/550e8400-e29b-41d4-a716-446655440000
```

Status values:
- `queued` - Job is waiting in the queue
- `running` - Job is currently executing
- `succeeded` - Job completed successfully
- `failed` - Job failed after all retries
- `cancelled` - Job was cancelled by user

Response:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "display_name": "Monthly Sales Report",
  "status": "running",
  "result": null,
  "error": null,
  "retry_count": 0,
  "max_retries": 3,
  "created_at": "2026-10-06T15:30:00+00:00",
  "started_at": "2026-10-06T15:30:01+00:00",
  "completed_at": null,
  "cancelled_at": null
}
```

When `status` is `succeeded`, `result` will contain execution results:

```json
{
  "result": {
    "pipeline_definition_id": "sales-report",
    "node_results": [
      {
        "node_id": "source",
        "node_type": "source.csv",
        "port": "output",
        "rows": 1000,
        "columns": ["Date", "Product", "Amount", "Region"]
      }
    ]
  }
}
```

### List All Jobs

Get a paginated list of all jobs (useful for monitoring).

```bash
# Get first 10 jobs
curl "http://localhost:8000/v1/jobs?skip=0&limit=10"

# Filter by status
curl "http://localhost:8000/v1/jobs?skip=0&limit=10&status=succeeded"
```

Status filter options: `queued`, `running`, `succeeded`, `failed`, `cancelled`

Response:
```json
{
  "jobs": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "display_name": "Monthly Sales Report",
      "status": "succeeded",
      ...
    }
  ],
  "total": 42,
  "skip": 0,
  "limit": 10
}
```

### Cancel Job

Cancel a queued or running job.

```bash
curl -X DELETE http://localhost:8000/v1/jobs/550e8400-e29b-41d4-a716-446655440000 \
  -H "Content-Type: application/json" \
  -d '{"reason": "User cancelled"}'
```

Response:
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "cancelled": true,
  "reason": "User cancelled"
}
```

---

## Frontend Integration

### React Hook for Job Polling

Use in your React components:

```typescript
import { useState, useEffect } from 'react';

interface JobStatus {
  id: string;
  display_name: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  result?: any;
  error?: string;
  retry_count: number;
  max_retries: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

export function useJobPolling(jobId: string, onComplete?: (job: JobStatus) => void) {
  const [job, setJob] = useState<JobStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;

    let backoff = 1000; // Start at 1 second
    const maxBackoff = 5000; // Max 5 seconds
    let isMounted = true;

    const poll = async () => {
      try {
        const response = await fetch(`/api/v1/jobs/${jobId}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        if (isMounted) setJob(data);

        // If complete, stop polling
        if (data.status in ['succeeded', 'failed', 'cancelled']) {
          setLoading(false);
          onComplete?.(data);
          return;
        }

        // Otherwise, schedule next poll with exponential backoff
        setTimeout(poll, backoff);
        backoff = Math.min(backoff * 2, maxBackoff);
      } catch (err) {
        if (isMounted) {
          setError((err as Error).message);
          setLoading(false);
        }
      }
    };

    poll();

    return () => {
      isMounted = false;
    };
  }, [jobId, onComplete]);

  return { job, loading, error };
}
```

Usage in a component:

```typescript
export function PipelineRunner({ pipelineDefinition }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const { job, loading, error } = useJobPolling(jobId);

  const handleSubmit = async () => {
    const response = await fetch('/api/v1/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: `Run at ${new Date().toLocaleString()}`,
        pipeline_definition: pipelineDefinition
      })
    });
    
    const data = await response.json();
    setJobId(data.id);
  };

  return (
    <div>
      <button onClick={handleSubmit} disabled={!!jobId}>
        Submit Pipeline
      </button>

      {jobId && (
        <div>
          <p>Job ID: {jobId}</p>
          <p>Status: {job?.status || 'pending...'}</p>
          
          {loading && <p>Executing...</p>}
          
          {job?.status === 'succeeded' && (
            <pre>{JSON.stringify(job.result, null, 2)}</pre>
          )}
          
          {job?.status === 'failed' && (
            <p style={{ color: 'red' }}>Error: {job.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
```

---

## Advanced Configuration

### Worker Options

```bash
# Multiple worker processes (for higher throughput)
python -m worker.main --workers 3

# Custom worker name
python -m worker.main --name "production-worker-1"

# Custom job timeout (in seconds, default 14400 = 4 hours)
python -m worker.main --timeout 3600  # 1 hour max
```

### Environment Variables

Set in `.env` file:

```env
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pipeline_builder

# Redis
WORKER_REDIS_HOST=localhost
WORKER_REDIS_PORT=6379
WORKER_REDIS_DB=0

# Worker behavior
WORKER_NAME=default
WORKER_TIMEOUT=14400
WORKER_LOG_LEVEL=INFO
```

### Retry Logic

Jobs automatically retry on failure:
- Max retries: 3 (configurable in Job ORM)
- Strategy: Exponential backoff (automatic via RQ)
- Retry count is tracked in database

---

## Monitoring & Debugging

### View Job Logs

Worker logs go to console. For persistence, redirect to a file:

```bash
python -m worker.main > worker.log 2>&1 &
tail -f worker.log
```

### Check Redis Queue Status

```bash
# Connect to Redis CLI
redis-cli

# View queue stats
> KEYS *
> LLEN rq:queue:default      # Jobs in queue
> ZCARD rq:failed            # Failed jobs
> ZCARD rq:scheduled         # Scheduled jobs
```

### Check Database Job Status

```bash
# Connect to PostgreSQL
psql -U postgres -d pipeline_builder

# View jobs
SELECT id, display_name, status, created_at FROM jobs ORDER BY created_at DESC LIMIT 10;

# View failed jobs
SELECT id, display_name, error FROM jobs WHERE status = 'failed';
```

### Common Issues

**Problem: "Job queue unavailable" error**
- Check Redis is running: `redis-cli ping` (should return PONG)
- Check Redis connection: `docker logs pipeline_builder_redis`

**Problem: Jobs stuck in "running" status**
- Worker crashed or hung up
- Check worker logs for errors
- Restart worker: `python -m worker.main`

**Problem: Jobs not being picked up**
- Check worker is running and connected to Redis
- Check database connectivity from worker
- View worker logs for connection errors

---

## Testing Your Integration

### Unit Test (Fast)

```bash
cd /Users/ben/Planning/backend
uv run pytest tests/test_queue.py -v
```

### Integration Test (Database + Redis)

Requires Docker and PostgreSQL running:

```bash
cd /Users/ben/Planning/backend
docker-compose up -d
uv run pytest tests/test_queue.py -v -m integration
```

### End-to-End Test (Full System)

Requires API, Redis, and Worker all running:

```bash
# Terminal 1
cd /Users/ben/Planning/backend
docker-compose up

# Terminal 2
cd /Users/ben/Planning/backend
uv run uvicorn app.main:app --port 8000

# Terminal 3
cd /Users/ben/Planning/backend
python -m worker.main

# Terminal 4
cd /Users/ben/Planning/backend
python -m tests.test_job_queue_end_to_end
```

---

## Performance Characteristics

### Latency

- **Job submission**: < 100ms (sync operation, just enqueues)
- **Time to start**: 100-500ms (worker picks up from queue)
- **Job polling**: < 50ms per request (database lookup)

### Throughput

- **Single worker**: ~1-10 jobs/min (depends on pipeline complexity)
- **3 workers**: ~3-30 jobs/min
- **10 workers**: ~10-100 jobs/min

### Storage

- **Database**: ~1KB per job + result size
- **Redis**: ~100 bytes per queued job (temporary)

### Limits (Phase 3)

- **Max job size**: 100MB (pipeline definition + config)
- **Max execution time**: 4 hours (configurable)
- **Max concurrent workers**: Horizontal scaling (add more worker processes/machines)
- **Job retention**: 30 days (older jobs auto-deleted)

---

## What's Next (Phase 3.2)

- [ ] Run history UI component
- [ ] Real-time progress updates (WebSocket)
- [ ] Job cancellation with partial results
- [ ] Job retry UI (manual retry button)
- [ ] Performance dashboard (job timing, queue depth)

---

## References

- [RQ Documentation](https://python-rq.org/)
- [Redis Documentation](https://redis.io/docs/)
- [FastAPI Async](https://fastapi.tiangolo.com/async-sql-databases/)

---

**Questions?** Check the Phase 3 implementation guide or contact the team.
