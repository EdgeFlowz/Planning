# Phase 3 Quick Start - Run Tests Now

**Estimated Time:** 30 minutes for full validation  
**Requirements:** Docker, Python 3.13+, uv package manager

---

## 1️⃣ Start the Services (5 minutes)

Open **4 separate terminal tabs** and run these commands in order:

### Terminal 1: Start Redis
```bash
cd /Users/ben/Planning/backend
docker-compose up redis
```
Expected output:
```
redis_1  | * Ready to accept connections
```

### Terminal 2: Start API Server
```bash
cd /Users/ben/Planning/backend
uv run uvicorn app.main:app --port 8000
```
Expected output:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
```

### Terminal 3: Start Worker
```bash
cd /Users/ben/Planning/backend
uv run python -m worker.main --workers=1
```
Expected output:
```
INFO:worker.main:Starting worker 'default' listening to queue: default
INFO:worker.main:Worker started
```

### Terminal 4: Verify Setup
```bash
cd /Users/ben/Planning/backend
# Just wait for the above 3 to be ready, then proceed to step 2
echo "Ready to test!"
```

---

## 2️⃣ Run Quick Validation (5 minutes)

In **Terminal 4**, run:

### Submit a Job
```bash
uv run python scripts/test_jobs_cli.py submit "My First Pipeline"
```

Expected output:
```
✓ Job submitted successfully
================================================================
Job ID:          a1b2c3d4-e5f6-47d8-a1b2-c3d4e5f6a7b8
Name:            My First Pipeline
Status:          QUEUED
Created:         2026-10-06T23:14:32.123456
================================================================
```

### Copy the Job ID and Check Status
```bash
JOB_ID="a1b2c3d4-e5f6-47d8-a1b2-c3d4e5f6a7b8"  # Use your actual ID
uv run python scripts/test_jobs_cli.py status $JOB_ID
```

Expected sequence:
```
First run:   Status: QUEUED
Few seconds: Status: RUNNING
Later:       Status: SUCCEEDED
```

### Wait for Completion
```bash
uv run python scripts/test_jobs_cli.py wait $JOB_ID
```

Expected output:
```
[00:00:05] Status: QUEUED
[00:00:07] Status: RUNNING
[00:00:12] Status: SUCCEEDED
✓ Job completed successfully
```

---

## 3️⃣ Run Unit Tests (5 minutes)

In **Terminal 4**:

```bash
cd /Users/ben/Planning/backend
uv run pytest tests/test_queue.py -v
```

Expected output:
```
tests/test_queue.py::TestJobQueueClient::test_enqueue_pipeline PASSED
tests/test_queue.py::TestJobQueueClient::test_get_job_status PASSED
tests/test_queue.py::TestJobQueueClient::test_get_job_result PASSED
tests/test_queue.py::TestJobQueueClient::test_cancel_job PASSED
tests/test_queue.py::TestJobQueueClient::test_get_queue_depth PASSED
tests/test_queue.py::TestJobQueueClient::test_get_failed_jobs_count PASSED

====== 6 passed in 0.07s ======
```

✅ **If all 6 pass:** Queue infrastructure working perfectly!

---

## 4️⃣ Run Integration Tests (10 minutes)

With all 3 services still running:

```bash
cd /Users/ben/Planning/backend
uv run pytest tests/test_jobs.py -v -s
```

Expected output:
```
tests/test_jobs.py::TestJobSubmission::test_submit_valid_pipeline PASSED
tests/test_jobs.py::TestJobSubmission::test_submit_invalid_pipeline PASSED
tests/test_jobs.py::TestJobPolling::test_get_job_immediately_after_submission PASSED
tests/test_jobs.py::TestJobListing::test_list_jobs_empty PASSED
...

====== 20+ passed in ~30s ======
```

✅ **If all tests pass:** API endpoints working perfectly!

---

## 5️⃣ Test All Scenarios (10 minutes)

Run these CLI commands and observe the outputs:

### Scenario 1: List All Jobs
```bash
uv run python scripts/test_jobs_cli.py list
```

Expected output:
```
======================================================================
Jobs (X of Y total)
======================================================================
⏳ [a1b2c3d4] My First Pipeline              queued       2026-10-06T...
▶️  [e5f6a7b8] My Second Pipeline             running      2026-10-06T...
✓ [c3d4e5f6] My Third Pipeline              succeeded    2026-10-06T...
======================================================================
```

### Scenario 2: List Only Running Jobs
```bash
uv run python scripts/test_jobs_cli.py list --status running
```

### Scenario 3: Submit and Cancel
```bash
# Submit
JOB_ID=$(uv run python scripts/test_jobs_cli.py submit "To Cancel" | grep "Job ID:" | awk '{print $NF}')

# Immediately cancel (before it runs)
uv run python scripts/test_jobs_cli.py cancel $JOB_ID

# Check status
uv run python scripts/test_jobs_cli.py status $JOB_ID
```

Expected:
```
Status: CANCELLED
```

---

## 6️⃣ Verify with curl (Optional)

### Submit a Job via HTTP
```bash
curl -X POST "http://localhost:8000/v1/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "Curl Test",
    "pipeline_definition": {
      "schema_version": 1,
      "pipeline_id": "test",
      "nodes": [{"id": "n1", "type": "source.csv", "config": {"path": "../example_data/sales.csv"}}],
      "edges": []
    }
  }'
```

### Get Job Status
```bash
JOB_ID="<paste ID from above>"
curl -X GET "http://localhost:8000/v1/jobs/$JOB_ID"
```

### List All Jobs
```bash
curl -X GET "http://localhost:8000/v1/jobs?limit=5"
```

---

## Expected Results Summary

✅ All unit tests passing (6/6)  
✅ All integration tests passing (20+/20+)  
✅ CLI tool submits jobs successfully  
✅ Status updates from queued → running → succeeded  
✅ Job listing works with filtering  
✅ Cancellation works  
✅ API responds to curl commands  

**If all ✅:** Phase 3.1 & 3.2 ready for Week 3 frontend development!

---

## Troubleshooting Quick Reference

| Issue | Solution |
|-------|----------|
| "Connection refused" on API | Make sure Terminal 2 is running `uvicorn app.main:app` |
| "Worker not picking up jobs" | Make sure Terminal 3 is running `python -m worker.main` |
| "Redis connection error" | Make sure Terminal 1 is running `docker-compose up redis` |
| "Job stuck in QUEUED" | Check worker logs in Terminal 3 for errors |
| "pytest: command not found" | Run `uv sync` first to install dependencies |
| "Missing environment variables" | Check `.env` file has `DATABASE_URL` set |

---

## Files You Can Explore

- 📄 [Testing Guide](./PHASE3_TESTING_GUIDE.md) - 500+ line comprehensive guide
- 📄 [Completion Summary](./PHASE3_COMPLETION_SUMMARY.md) - What was built
- 📄 [Verification Checklist](./PHASE3_VERIFICATION_CHECKLIST.md) - Full checklist of items
- 📁 [Test Suite](./backend/tests/test_queue.py) - Unit tests
- 📁 [Integration Tests](./backend/tests/test_jobs.py) - Integration tests  
- 📁 [CLI Tool](./backend/scripts/test_jobs_cli.py) - End-user testing tool
- 📁 [API Code](./backend/app/main.py) - All 4 endpoints

---

## Next Steps After Testing

✅ **If all tests pass:**
1. Proceed to Week 3 frontend development
2. Create `useJobPolling()` React hook
3. Update Toolbar.tsx to use `/v1/jobs` endpoint
4. Add job status indicator component

❌ **If tests fail:**
1. Check troubleshooting section above
2. Review PHASE3_TESTING_GUIDE.md for detailed debugging
3. Check service logs (Terminal 1-3) for error messages

---

**Estimated Total Time:** 30 minutes  
**Status:** ✅ Ready to Test  
**Next Phase:** Week 3 Frontend Integration
