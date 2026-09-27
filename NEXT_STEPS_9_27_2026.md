# Next Steps: Requirements Gap Analysis & Roadmap

**Status:** Analyzed against requirements.md v0.1  
**Date:** 2026-09-27  
**Current Stage:** Proof of concept (Phase 1 complete, Phases 2-3 needed)

---

## Part 1: Completed Components ✅

### Core Execution Engine
- ✅ **Polars-based executor** (app/execution/executor.py)
- ✅ **DAG validation** (app/domain/validator.py)
- ✅ **Topological sorting** (app/execution/planner.py)
- ✅ **Connector interface** (app/connectors/base.py)
- ✅ **Transformation registry** (app/transformations/registry.py)
- ✅ **LazyFrame lazy evaluation** (preserved across nodes)

### Connectors & Transformations
- ✅ **Sources**: CSV, Parquet
- ✅ **Sinks**: CSV, Parquet
- ✅ **Transformations**: Filter, Select, Rename, Sort, Aggregate, Join, Limit, Deduplicate, Cast, Group By
- ✅ **Node catalog** (app/catalog.py)

### API Endpoints (Basic)
- ✅ `GET /nodes` — List available node types with config schemas
- ✅ `POST /upload` — File upload (multipart/form-data)
- ✅ `POST /pipelines/run` — Execute pipeline synchronously

### Frontend
- ✅ **Visual editor** (React Flow)
- ✅ **Node palette & drag/drop**
- ✅ **Configuration panel**
- ✅ **File upload widget**
- ✅ **Pipeline execution button**
- ✅ **Results display (metadata only)**
- ✅ **TypeScript types**

### Development Setup
- ✅ **Backend**: FastAPI, Pydantic v2, Polars, pytest
- ✅ **Frontend**: React 18, TypeScript, Vite, React Flow
- ✅ **Tests**: 14 passing unit tests (backend)
- ✅ **Docker**: Compose setup for local development

---

## Part 2: Critical Missing Components ❌

### 1. **Database / Metadata Store** (BLOCKING)
**Requirement:** PostgreSQL for immutable pipeline versions, run history, connections, credentials
**Current:** In-memory only; no persistence
**Impact:** Cannot save pipelines, no execution history, no versioning
**Status:** **PHASE 2 — HIGH PRIORITY**

**Needed:**
```
PostgreSQL tables:
  - pipelines (id, name, description, workspace_id)
  - pipeline_versions (id, pipeline_id, version_num, definition_json, checksum)
  - pipeline_runs (id, pipeline_id, version_id, status, started_at, error)
  - node_runs (id, run_id, node_id, status, rows_in, rows_out)
  - connections (id, type, config_encrypted, workspace_id)
  - artifacts (id, run_id, type, path/uri)
```

**Tasks:**
- [ ] Add SQLAlchemy 2.x + Alembic
- [ ] Define ORM models
- [ ] Create migration scripts
- [ ] API endpoints for CRUD operations
- [ ] Connection pooling

---

### 2. **Job Queue & Worker Process** (BLOCKING)
**Requirement:** Async execution in separate worker, not in FastAPI request handler
**Current:** Synchronous execution inline (violates requirement 2.3)
**Impact:** Long pipelines block API, no job status visibility, no cancellation
**Status:** **PHASE 2 — HIGH PRIORITY**

**Needed:**
```
Architecture:
  API → creates job in queue → returns job_id
  Worker polls queue → claims job → executes → updates status
  Frontend polls API for job status
```

**Tasks:**
- [ ] Choose queue backend (Redis or PostgreSQL-backed)
- [ ] Worker subprocess/daemon
- [ ] Job claim/status endpoints
- [ ] Async status polling on frontend
- [ ] Execution timeout handling
- [ ] Worker crash recovery

---

### 3. **Pipeline Versioning & Persistence** (BLOCKING)
**Requirement:** Immutable versions, draft/published states
**Current:** No versioning; pipeline executed as received
**Impact:** Cannot reproduce past runs, no audit trail
**Status:** **PHASE 2 — HIGH PRIORITY**

**Needed:**
```
Lifecycle:
  User creates pipeline (draft state)
  → User publishes (creates immutable PipelineVersion)
  → User executes version (not draft)
  → New draft can be created from existing version
```

**Tasks:**
- [ ] Draft/Published states
- [ ] Version number incrementing
- [ ] Definition JSON checksum for reproducibility
- [ ] "New draft from version" UI action
- [ ] API to fetch specific version

---

### 4. **Connection Management** (HIGH PRIORITY)
**Requirement:** External connections (DB, S3, etc.) stored separately from pipeline
**Current:** Hard-coded file paths in node configs
**Impact:** Cannot reuse connections, no credential management
**Status:** **PHASE 2**

**Needed:**
```
Connection types:
  - PostgreSQL (host, port, user, password_ref, database)
  - S3/MinIO (endpoint, access_key_ref, secret_key_ref, bucket)
  - SFTP (host, port, user, private_key_ref)

Pipeline nodes reference: "connection_id": "conn_123"
Not: "path": "/absolute/path"
```

**Tasks:**
- [ ] Connection CRUD endpoints
- [ ] Credential encryption/vaulting
- [ ] Test connection functionality
- [ ] Connection UI (create, edit, test, delete)
- [ ] Update source/sink connectors to accept connection_id

---

### 5. **Schema System** (MEDIUM PRIORITY)
**Requirement:** Column discovery, type inference, preview schemas
**Current:** No schema awareness
**Impact:** No validation of column references before execution, no schema preview
**Status:** **PHASE 2-3**

**Needed:**
```
Per node:
  - Input schema (from upstream)
  - Output schema (computed from transformation)
  - Column validation (does "age" exist? is it numeric?)

Discovery:
  - read_schema() method on sources
  - schema derivation in transformations
```

**Tasks:**
- [ ] Schema model (Column, DataType, nullable, metadata)
- [ ] read_schema() on each source
- [ ] Schema derivation for each transform
- [ ] Schema validation in DAG validator
- [ ] Schema preview endpoint

---

### 6. **Data Preview System** (MEDIUM PRIORITY)
**Requirement:** Bounded preview execution with timeouts, row limits
**Current:** Only execution results returned (no data rows)
**Impact:** Users can't see intermediate data
**Status:** **PHASE 2-3**

**Needed:**
```
API endpoint:
  POST /pipelines/{id}/preview/{node_id}
  → Collect first N rows
  → Return as artifact
  → Cache with TTL
  → Timeout 10s
```

**Tasks:**
- [ ] Preview execution mode (bounded)
- [ ] Artifact storage (local/S3)
- [ ] Configurable row limit & timeout
- [ ] Preview UI component
- [ ] Cache management

---

### 7. **Scheduling** (MEDIUM PRIORITY)
**Requirement:** Cron schedules, enable/disable, overlap policies
**Current:** No scheduling
**Impact:** Can't run pipelines automatically
**Status:** **PHASE 3**

**Needed:**
```
Cron format: "0 8 * * MON" (every Monday at 8am)
Overlap policy: allow/skip/queue
Timezone support
```

**Tasks:**
- [ ] Schedule model & CRUD
- [ ] Scheduler service (APScheduler or similar)
- [ ] Schedule UI (calendar + cron builder)
- [ ] Manual trigger endpoint

---

### 8. **Run History & Monitoring** (MEDIUM PRIORITY)
**Requirement:** Record every execution with status, timing, metrics
**Current:** No run history
**Impact:** Can't see past executions, no SLA tracking
**Status:** **PHASE 2-3**

**Needed:**
```
Per run:
  - Overall status (queued/running/succeeded/failed)
  - Duration, start/end time
  - Rows read/written per node
  - Error summary
  - Logs (structured JSON)
```

**Tasks:**
- [ ] PipelineRun & NodeRun tables
- [ ] Structured logging
- [ ] Run history API
- [ ] Run details UI page

---

### 9. **API Versioning & Error Contract** (MEDIUM PRIORITY)
**Requirement:** All endpoints under `/api/v1/`, structured error responses
**Current:** Routes are `/api/*`, errors are raw Pydantic exceptions
**Impact:** Hard to evolve API, unclear error messages
**Status:** **PHASE 2**

**Needed:**
```json
Structured error (current missing):
{
  "error": {
    "code": "PIPELINE_VALIDATION_FAILED",
    "message": "...",
    "details": [...],
    "request_id": "req_123"
  }
}
```

**Tasks:**
- [ ] Prefix all routes with `/api/v1/`
- [ ] Custom exception handlers
- [ ] Error code enum
- [ ] Request ID correlation

---

### 10. **Workspaces & Authorization** (LOWER PRIORITY for MVP)
**Requirement:** Multi-workspace, per-resource authorization
**Current:** Single implicit workspace
**Impact:** Can't support multiple users/teams
**Status:** **PHASE 3 — Optional for single-user MVP**

**Needed:**
```
- Workspace CRUD
- Workspace membership
- Role-based access (admin/editor/viewer)
- Resource-level ACLs
```

---

## Part 3: Phase-Based Roadmap

### **Phase 1: ✅ COMPLETE (Current)**
**Goal:** Prove core execution + file upload + UI integration

**Deliverables:**
- [x] Executor engine (Polars LazyFrame)
- [x] Basic sources/sinks/transforms
- [x] Frontend visual editor
- [x] File upload endpoint
- [x] Synchronous pipeline execution
- [x] 14 passing tests

**Not in scope:** Database, versioning, scheduling, monitoring

---

### **Phase 2: NEXT (2-3 weeks, ~80-120 hours)**
**Goal:** Production-ready single-user MVP

**Priority 1 (BLOCKING):**
1. [ ] PostgreSQL integration + migrations
2. [ ] Pipeline persistence (save/load)
3. [ ] Job queue + worker process
4. [ ] Pipeline versioning (draft/published)
5. [ ] Structured error responses
6. [ ] API versioning (`/api/v1/`)

**Priority 2 (IMPORTANT):**
7. [ ] Connection management (DB/S3 credentials)
8. [ ] Run history persistence
9. [ ] Schema system (discovery + inference)
10. [ ] Data preview (bounded execution)

**Estimated effort per task:**
- PostgreSQL + ORM: 12-16h
- Job queue + worker: 16-20h
- Versioning: 8-10h
- Connections: 12-16h
- Schema system: 12-16h
- Preview system: 8-12h
- Testing & integration: 20-24h

**Not in scope:** Scheduling, workspaces, credentials vaulting

---

### **Phase 3: LATER (3-4 weeks, ~60-80 hours)**
**Goal:** Multi-user, scheduled, monitored platform

**Features:**
- [ ] Scheduling (cron + overlap policies)
- [ ] Audit logging
- [ ] Workspaces + authorization
- [ ] Advanced data quality checks
- [ ] Additional sources (SQL, REST API)
- [ ] Credentials vault integration
- [ ] Artifact retention policies

---

## Part 4: Immediate Next Steps (This Week)

### **Step 1: Set Up Database (Priority 1)**
**Estimated:** 12-16 hours

```bash
uv add sqlalchemy alembic psycopg[binary]
# Create models for: Pipeline, PipelineVersion, PipelineRun, NodeRun, Connection, Artifact
# Create Alembic migration scaffolding
# Update docker-compose.yml to include PostgreSQL 15
```

**Files to create:**
- `backend/app/infrastructure/database.py` — SQLAlchemy setup
- `backend/app/domain/models_db.py` — ORM models
- `backend/alembic/` — Migration directory
- `backend/tests/test_database.py` — Database tests

**Outcomes:**
- PostgreSQL running in docker-compose
- Migration system ready
- ORM models defined and tested

---

### **Step 2: Implement Job Queue (Priority 1)**
**Estimated:** 16-20 hours

**Decision:** Use Redis-backed Celery or PostgreSQL-backed job queue?

**Recommendation:** PostgreSQL-backed initially (no new service dependency)
- Use `python-rq` (Redis) — simpler
- Or `APScheduler` with SQL backend

**Files to create:**
- `backend/app/execution/worker.py` — Worker main loop
- `backend/app/infrastructure/queue.py` — Queue interface
- `backend/app/infrastructure/job_store.py` — Job persistence
- `docker-compose.yml` — Worker service

**Outcomes:**
- Worker process runs independently
- API returns job_id instead of blocking
- Frontend polls job status

---

### **Step 3: Add Pipeline Versioning (Priority 1)**
**Estimated:** 8-10 hours

**Approach:**
1. Add `PipelineVersion` table
2. Modify pipeline create/run flow
3. Update executor to accept version_id
4. Add "Publish" button to frontend

**Files to modify:**
- `backend/app/main.py` — New publish endpoint
- `backend/app/infrastructure/pipeline_store.py` — Version CRUD
- `frontend/src/components/Toolbar.tsx` — Publish button

**Outcomes:**
- Pipelines stored in draft state
- Users can publish to create immutable versions
- Runs reference specific versions

---

### **Step 4: Refactor API & Add Error Contract (Priority 1)**
**Estimated:** 4-6 hours

**Changes:**
- Move all routes under `/api/v1/`
- Create `app/api/errors.py` with structured exceptions
- Add error response model to all endpoints

**Outcomes:**
- Consistent error responses
- API versioning ready for future changes

---

## Part 5: Validation Checklist (Post-Phase 2)

Before Phase 3, validate:
- [ ] Local dev can start with `docker compose up`
- [ ] Backend + worker + frontend all run
- [ ] Can create & publish pipeline
- [ ] Can execute pipeline (queued + worker runs)
- [ ] Can view past runs & metrics
- [ ] Can handle connection credentials safely
- [ ] Can preview intermediate nodes
- [ ] All errors are structured
- [ ] 30+ integration tests passing
- [ ] No blocking performance issues

---

## Part 6: Architecture Evolution

### Current (Phase 1)
```
React UI
   ↓
FastAPI (sync)
   ↓
Executor (Polars)
   ↓
Local files
```

### Phase 2 Target
```
React UI ← [status polling]
   ↓
FastAPI (async)
   ├→ PostgreSQL (metadata)
   ├→ Job Queue
   ↓
Worker Process
   ↓
Executor (Polars)
   ├→ Connectors (DB, S3, local)
   └→ Artifact Storage
```

### Phase 3 Target
```
React UI
   ↓
API Gateway / Auth
   ├→ FastAPI (multiple instances)
   ├→ PostgreSQL
   ├→ Redis (queue + cache)
   ├→ Worker Pool
   ├→ Credentials Vault
   └→ S3 (artifacts)
```

---

## Summary: Dependencies & Order

| Phase | Component | Depends On | Effort | Owner |
|-------|-----------|-----------|--------|-------|
| 2 | PostgreSQL setup | (none) | 16h | Backend |
| 2 | ORM models | PostgreSQL | 12h | Backend |
| 2 | Job queue | ORM | 20h | Backend |
| 2 | Versioning | ORM | 10h | Backend |
| 2 | Connections | ORM, ORM | 16h | Backend |
| 2 | Schema system | (none) | 16h | Backend |
| 2 | Preview API | Worker, Storage | 12h | Backend |
| 2 | Error contract | (none) | 6h | Backend |
| 2 | API versioning | (none) | 4h | Backend |
| 2 | Run history UI | Job queue, ORM | 12h | Frontend |
| 2 | Connection UI | Connections API | 10h | Frontend |
| 2 | Testing & integration | All above | 24h | Both |

**Estimated Phase 2 total: 80-120 hours** (2-3 weeks full-time)

---

## Success Metrics

After Phase 2, the app should:
- ✅ Store pipelines durably (no data loss on restart)
- ✅ Handle long-running jobs without blocking API
- ✅ Support multiple versions of a pipeline
- ✅ Show structured error messages
- ✅ Display run history + execution metrics
- ✅ Pass 40+ integration tests
- ✅ Be deployable with `docker compose up`

After Phase 3:
- ✅ Support scheduled automatic execution
- ✅ Separate multi-user workspaces
- ✅ Audit trail of all changes
- ✅ Advanced data quality checks
