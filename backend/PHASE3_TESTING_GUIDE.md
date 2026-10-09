# Phase 3.1 End-to-End Testing Guide

**What This Tests:** Complete async pipeline execution with Redis queue and background workers

**Prerequisites:**
- Backend API running on `http://localhost:8000`
- Redis server running on `localhost:6379`
- Worker service running (separate process)
- PostgreSQL database accessible

---

## Quick Start (5 minutes)

### 1. Start All Services

**Terminal 1 - Start Redis:**
```bash
cd /Users/ben/Planning/backend
docker-compose up redis
```

**Terminal 2 - Start API:**
```bash
cd /Users/ben/Planning/backend
uv run uvicorn app.main:app --port 8000
```

**Terminal 3 - Start Worker:**
```bash
cd /Users/ben/Planning/backend
uv run python -m worker.main --workers=1
```

### 2. Test Job Submission

**Terminal 4 - Run Quick Test:**
```bash
cd /Users/ben/Planning/backend

# Submit a job
uv run python scripts/test_jobs_cli.py submit "My First Pipeline"

# You'll see output like:
# ✓ Job submitted successfully
# ================================================================
# Job ID:          a1b2c3d4-e5f6-47d8-a1b2-c3d4e5f6a7b8
# Name:            My First Pipeline
# Status:          QUEUED
# ...
```

### 3. Check Job Status

```bash
# Replace with the job_id from above
uv run python scripts/test_jobs_cli.py status a1b2c3d4-e5f6-47d8-a1b2-c3d4e5f6a7b8

# Or wait for it to complete:
uv run python scripts/test_jobs_cli.py wait a1b2c3d4-e5f6-47d8-a1b2-c3d4e5f6a7b8
```

---

## Detailed Testing Scenarios

### Scenario 1: Basic Submission & Polling

**Test:** User submits a pipeline and checks status

```bash
# Submit
JOB_ID=$(uv run python scripts/test_jobs_cli.py submit "Test Run" | grep "Job ID:" | awk '{print $NF}')

# Check status
uv run python scripts/test_jobs_cli.py status $JOB_ID

# Expected Output:
# Status should be one of: QUEUED, RUNNING, SUCCEEDED, FAILED
```

**What's Happening:**
1. ✓ API validates pipeline definition
2. ✓ Job created in PostgreSQL with status=queued
3. ✓ Job enqueued to Redis queue
4. ✓ Worker picks it up from queue
5. ✓ Worker executes pipeline and updates database
6. ✓ User polls endpoint to see status

---

### Scenario 2: Long Running Pipeline

**Test:** Submitting a job that takes time to complete

```bash
# Submit
uv run python scripts/test_jobs_cli.py submit "Slow Pipeline"

# Watch status change over time
uv run python scripts/test_jobs_cli.py wait <job_id>

# Expected sequence:
# [HH:MM:SS] Status: QUEUED
# [HH:MM:SS] Status: RUNNING
# [HH:MM:SS] Status: SUCCEEDED
```

**What's Happening:**
1. ✓ Job submitted with status=queued
2. ✓ Worker starts processing (status changes to running)
3. ✓ Pipeline executes with node-by-node processing
4. ✓ Results collected and stored in database
5. ✓ Job marked as succeeded with results

---

### Scenario 3: Listing All Jobs

**Test:** View all submitted jobs with pagination

```bash
# List all jobs
uv run python scripts/test_jobs_cli.py list

# Expected output:
# ======================================================================
# Jobs (5 of 12 total)
# ======================================================================
# ⏳ [a1b2c3d4] Test Run 1                    queued       2026-10-06T...
# ▶️  [e5f6a7b8] Test Run 2                    running      2026-10-06T...
# ✓ [c3d4e5f6] Test Run 3                    succeeded    2026-10-06T...
# ✗ [7b8c9d0e] Test Run 4                    failed       2026-10-06T...
# ======================================================================
```

**Test Pagination:**
```bash
# API call with limit/skip
curl -X GET "http://localhost:8000/v1/jobs?limit=5&skip=0"
```

**Test Filtering by Status:**
```bash
# Only queued jobs
uv run python scripts/test_jobs_cli.py list --status queued

# Only running jobs
uv run python scripts/test_jobs_cli.py list --status running

# Only completed (succeeded or failed)
uv run python scripts/test_jobs_cli.py list --status succeeded
```

---

### Scenario 4: Job Cancellation

**Test:** Cancel a queued or running job

```bash
# Submit a job (won't execute immediately)
uv run python scripts/test_jobs_cli.py submit "Job to Cancel"

# Cancel it
uv run python scripts/test_jobs_cli.py cancel <job_id>

# Expected output:
# ✓ Job cancelled successfully
# Status: CANCELLED

# Verify in database
uv run python scripts/test_jobs_cli.py status <job_id>

# Should show:
# Status:          CANCELLED
# Reason: Cancelled by user via CLI
```

**What's Happening:**
1. ✓ Job status updated to cancelled in PostgreSQL
2. ✓ cancelled_at timestamp recorded
3. ✓ Audit trail preserved for compliance

---

### Scenario 5: Error Handling & Retries

**Test:** Pipeline execution with errors

**Setup:** Create a pipeline with invalid configuration:
```bash
# Via curl (invalid node type)
curl -X POST "http://localhost:8000/v1/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "Invalid Pipeline",
    "pipeline_definition": {
      "schema_version": 1,
      "pipeline_id": "test",
      "nodes": [{
        "id": "bad_node",
        "type": "invalid.type",
        "config": {}
      }],
      "edges": []
    }
  }'

# Expected:
# HTTP 422 - Pipeline validation failed before job created
```

**Setup: Runtime Error:**
```bash
# Submit pipeline with invalid CSV path
uv run python scripts/test_jobs_cli.py submit "Bad CSV Path"

# Wait for execution
uv run python scripts/test_jobs_cli.py wait <job_id>

# Expected:
# Status: FAILED
# Error: FileNotFoundError: No such file or directory: 'nonexistent.csv'
# Retries: 1/3
```

**What's Happening:**
1. ✓ Validation happens before job creation (fast fail)
2. ✓ Runtime errors caught in worker
3. ✓ Job retried automatically (up to max_retries=3)
4. ✓ Error message stored for debugging
5. ✓ User can see error in results

---

### Scenario 6: Concurrent Job Execution

**Test:** Multiple jobs executing in parallel

**Setup: Multiple Workers:**
```bash
# Start 3 worker processes
uv run python -m worker.main --workers=3
```

**Submit Multiple Jobs:**
```bash
for i in {1..10}; do
  uv run python scripts/test_jobs_cli.py submit "Parallel Job $i" &
done
wait

# List all jobs
uv run python scripts/test_jobs_cli.py list

# Expected:
# Multiple jobs in RUNNING state simultaneously (up to worker count)
```

**Monitor Queue Depth:**
```bash
# Via Redis CLI
docker exec pipeline_builder_redis redis-cli -c "LLEN rq:queue:default"

# Via API (future enhancement)
# GET /v1/metrics/queue_depth
```

---

### Scenario 7: Job Polling Timeout

**Test:** Polling with exponential backoff (frontend feature)

**Simulate with curl:**
```bash
# Submit job
JOB_ID=$(curl -s -X POST "http://localhost:8000/v1/jobs" \
  -H "Content-Type: application/json" \
  -d '{"display_name":"Test", "pipeline_definition":{...}}' | jq -r '.id')

# Poll with increasing intervals
# 1st poll: 1 second delay
sleep 1 && curl "http://localhost:8000/v1/jobs/$JOB_ID"

# 2nd poll: 2 second delay
sleep 2 && curl "http://localhost:8000/v1/jobs/$JOB_ID"

# 3rd poll: 4 second delay
sleep 4 && curl "http://localhost:8000/v1/jobs/$JOB_ID"

# 4th poll: 5 second delay (max)
sleep 5 && curl "http://localhost:8000/v1/jobs/$JOB_ID"
```

**Expected:** No performance degradation with frequent polling

---

### Scenario 8: Queue Under Load

**Test:** System behavior with many jobs

```bash
# Submit 50 jobs rapidly
for i in {1..50}; do
  uv run python scripts/test_jobs_cli.py submit "Load Test $i" &
  if [ $((i % 10)) -eq 0 ]; then
    echo "Submitted $i jobs"
    sleep 1
  fi
done
wait

# Monitor
uv run python scripts/test_jobs_cli.py list

# Check worker logs for errors
docker logs pipeline_builder_worker 2>&1 | tail -20
```

**Expected:**
- ✓ All jobs queued successfully
- ✓ Workers process queue without errors
- ✓ No data loss or corruption
- ✓ Graceful degradation if queue grows

---

## API Testing with curl

### Submit Job
```bash
curl -X POST "http://localhost:8000/v1/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "Test Pipeline",
    "pipeline_definition": {
      "schema_version": 1,
      "pipeline_id": "test-123",
      "nodes": [
        {
          "id": "source_1",
          "type": "source.csv",
          "config": {"path": "example_data/sales.csv"}
        }
      ],
      "edges": []
    }
  }'
```

### Get Job Status
```bash
JOB_ID="a1b2c3d4-e5f6-47d8-a1b2-c3d4e5f6a7b8"
curl -X GET "http://localhost:8000/v1/jobs/$JOB_ID"
```

### List Jobs
```bash
# All jobs
curl -X GET "http://localhost:8000/v1/jobs"

# With pagination
curl -X GET "http://localhost:8000/v1/jobs?limit=5&skip=10"

# Filter by status
curl -X GET "http://localhost:8000/v1/jobs?status=running"
```

### Cancel Job
```bash
JOB_ID="a1b2c3d4-e5f6-47d8-a1b2-c3d4e5f6a7b8"
curl -X DELETE "http://localhost:8000/v1/jobs/$JOB_ID" \
  -H "Content-Type: application/json" \
  -d '{"reason": "User cancelled"}'
```

---

## Unit Testing

Run the comprehensive test suite:

```bash
# Install test dependencies
uv run pytest

# Run all job queue tests
uv run pytest tests/test_jobs.py -v

# Run specific test class
uv run pytest tests/test_jobs.py::TestJobSubmission -v

# Run with detailed output
uv run pytest tests/test_jobs.py -vvs

# Run with coverage
uv run pytest tests/test_jobs.py --cov=app.queue --cov=app.persistence.repositories.jobs
```

**Expected Output:**
```
tests/test_jobs.py::TestJobSubmission::test_submit_valid_pipeline PASSED
tests/test_jobs.py::TestJobSubmission::test_submit_invalid_pipeline PASSED
tests/test_jobs.py::TestJobPolling::test_get_job_immediately_after_submission PASSED
tests/test_jobs.py::TestJobListing::test_list_jobs_empty PASSED
...

===== 25 passed in 3.42s =====
```

---

## Integration Testing (With Real Services)

**Start Full Stack:**
```bash
# Terminal 1
docker-compose up

# Terminal 2
uv run uvicorn app.main:app --port 8000

# Terminal 3
uv run python -m worker.main --workers=3

# Terminal 4
uv run pytest tests/test_integration_jobs.py -v -s
```

---

## Performance Testing

### Measure Job Throughput
```bash
# How many jobs can complete per minute?
time for i in {1..100}; do
  uv run python scripts/test_jobs_cli.py submit "Perf Test $i" > /dev/null
done

# Monitor completion rate
uv run python scripts/test_jobs_cli.py list | grep succeeded | wc -l
```

### Measure Latency
```bash
# Time from submission to completion
uv run python -c "
import time
import httpx
import json

client = httpx.Client(base_url='http://localhost:8000')
start = time.time()

# Submit
resp = client.post('/v1/jobs', json={
  'display_name': 'Latency Test',
  'pipeline_definition': {...}
})
job_id = resp.json()['id']

# Poll until complete
while True:
  job = client.get(f'/v1/jobs/{job_id}').json()
  if job['status'] in ['succeeded', 'failed']:
    break
  time.sleep(0.1)

elapsed = time.time() - start
print(f'Total time: {elapsed:.2f}s')
"
```

---

## Troubleshooting

### Jobs Stay in "QUEUED" Status
**Symptom:** Jobs submitted but never execute
**Cause:** Worker not running
**Fix:**
```bash
# Start worker
uv run python -m worker.main
```

**Verify Worker Started:**
```bash
# Should see log lines like:
# INFO:worker.main:Starting worker 'default' listening to queue: ...
# INFO:worker.main:Worker 'default' started, processing jobs...
```

### "Failed to enqueue job: Connection refused"
**Symptom:** Submit endpoint returns 503
**Cause:** Redis not running
**Fix:**
```bash
docker-compose up redis
# or
docker run -d -p 6379:6379 redis:7-alpine
```

### "Job not found" When Getting Status
**Symptom:** Job submitted but GET /v1/jobs/{id} returns 404
**Cause:** Database session not committed
**Fix:** This shouldn't happen - open issue if seen

### Worker Logs Show No Error But Job Fails
**Symptom:** Job status is FAILED but worker logs are clean
**Cause:** Error might be in pipeline validation or execution
**Fix:** Check job error message:
```bash
uv run python scripts/test_jobs_cli.py status <job_id>
# Look at "Error:" field
```

---

## Monitoring

### Check Redis Queue Status
```bash
# Number of jobs waiting
docker exec pipeline_builder_redis redis-cli LLEN rq:queue:default

# Redis memory usage
docker exec pipeline_builder_redis redis-cli INFO memory
```

### Check Worker Logs
```bash
# Follow logs in real-time
docker logs -f pipeline_builder_redis

# See recent errors
uv run python -m worker.main 2>&1 | grep ERROR
```

### Check Database
```bash
# Number of jobs by status
uv run python -c "
from sqlalchemy import create_engine, func, text
from app.config import settings
from app.persistence.models import Job

engine = create_engine(settings.database_url)
with engine.connect() as conn:
  result = conn.execute(text('SELECT status, COUNT(*) FROM jobs GROUP BY status'))
  for row in result:
    print(f'{row[0]:12} {row[1]:5} jobs')
"
```

---

## Next Steps (Week 3)

After verifying Week 2 works:
- Implement frontend job polling component
- Add progress indicator to UI
- Update Toolbar.tsx to use /v1/jobs instead of synchronous /v1/pipelines/run
- Implement Run History UI to show past executions

---

## Summary Checklist

After running all scenarios, verify:

- [ ] Jobs can be submitted via API
- [ ] Jobs appear in database with correct status
- [ ] Worker picks up and executes jobs
- [ ] Status updates from queued → running → completed
- [ ] Results stored in database
- [ ] Polling returns current status
- [ ] Job listing works with pagination
- [ ] Filtering by status works
- [ ] Cancellation works for queued jobs
- [ ] Errors are captured and displayed
- [ ] Retries work automatically
- [ ] Multiple workers can run concurrently
- [ ] Queue can handle many jobs
- [ ] No data loss or corruption

✅ **All verified → Ready for Week 3 Frontend Integration**
