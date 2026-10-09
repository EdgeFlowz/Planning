# Pipeline Builder: Project Status & Phase 3+ Roadmap

**Date:** October 6, 2026  
**Assessment Level:** Senior Software Engineer Review  
**Status:** MVP Persistence Layer Complete → Production Readiness Planning

---

## Executive Summary

We have successfully completed **Phases 1-2** of the Pipeline Builder project:
- ✅ Core execution engine with transformations and validation
- ✅ Full persistence layer (PostgreSQL ORM, repositories, migrations)
- ✅ 13 v1 API endpoints with backward compatibility
- ✅ React frontend with visual editor and database integration
- ✅ All 16 backend tests passing, frontend builds clean

**Assessment:** The foundation is solid and production-ready for *local/small-team usage*, but **not** production-ready for distributed/long-running pipelines or multi-tenant SaaS deployments.

**Key Blockers for Phase 3:**
1. Synchronous execution blocks API on long-running pipelines
2. No UI for run history or connection management
3. No multi-user safety or audit trail
4. Credentials not vaulted or encrypted

---

## Current State Breakdown

### Phase 1: Execution Engine ✅ COMPLETE

**What Works:**
- Pipeline definition validation (syntax, schema, connections)
- Node execution with transformation logic
- Error handling and reporting
- Example data and basic tests
- CLI execution for local testing

**Quality:** Production-grade validation and execution logic

---

### Phase 2: Persistence Layer ✅ COMPLETE

**Backend Implementation:**
- 5 SQLAlchemy ORM tables (pipelines, versions, runs, nodes, connections)
- Repository pattern with clean abstractions
- 13 v1 API endpoints:
  - 5 Pipeline CRUD endpoints
  - 3 Run history endpoints
  - 5 Connection management endpoints
- Alembic migrations (2 successfully applied to PostgreSQL)
- FastAPI dependency injection for session management
- Backward-compatible legacy endpoints

**Frontend Integration:**
- Type-safe API client (organized by resource)
- Zustand store with async database methods
- UI components (Save Pipeline button, File Upload)
- Pipeline serialization/deserialization
- Error handling and success messages

**Testing:**
- 16/16 backend tests passing
- 269 TypeScript modules, zero compilation errors
- End-to-end flow validated (create → save → execute → view results)

**Quality:** Clean architecture, well-tested, production-ready for small teams

---

## Critical Gaps (Production Blockers)

### 1. Synchronous Execution (BLOCKING)
**Severity:** 🔴 Critical  
**Current:** `POST /v1/pipelines/run` executes synchronously in API process

**Problems:**
- If pipeline takes 30+ seconds, HTTP client times out (30-60s limit)
- API instance becomes single point of failure
- No way to cancel or monitor long-running executions
- Can't scale to multiple workers
- Terrible UX: user sees spinner, no feedback

**Impact:** Can't run any realistic ETL pipeline (data processing typically takes 5-30 minutes)

**Solution Required:**
```
Frontend request → API enqueues job → returns job_id (fast)
                    ↓
                  Redis/Queue
                    ↓
              Background Worker picks up
                    ↓
              Worker executes pipeline
                    ↓
              Frontend polls job status every 2s
                    ↓
              Worker updates database with results
                    ↓
              Frontend detects completion, fetches results
```

**Estimated Effort:** 40-60 dev hours (includes job queue setup, worker service, polling UI)

---

### 2. No Run History UI (HIGH)
**Severity:** 🟠 High  
**Current:** Backend endpoints exist (`GET /v1/runs/*`), frontend has zero UI

**Problems:**
- Users can't see what they built/ran
- No visibility into failures or metrics
- Can't debug "why did the pipeline fail?"
- No audit trail of executions

**Solution Required:**
- Modal showing list of runs with status badges
- Run detail view with node-by-node metrics
- Error inspection and stack traces
- Timeline/duration charts

**Estimated Effort:** 20-30 dev hours (React components, API integration, charts)

---

### 3. Connection Management UI Missing (HIGH)
**Severity:** 🟠 High  
**Current:** Backend CRUD endpoints exist, zero frontend usage

**Problems:**
- Can't visually manage database/S3/API connections
- Credentials hardcoded in pipeline configs
- Can't reuse connections across pipelines
- No credential vaulting

**Solution Required:**
- Connection manager modal (list, create, edit, delete, test)
- Type-specific forms (Database, S3, API, etc.)
- Credential encryption at rest
- Connection selection in node config UI

**Estimated Effort:** 30-40 dev hours (forms, validation, encryption integration)

---

### 4. No Authentication/Authorization (MEDIUM)
**Severity:** 🟡 Medium  
**Current:** API completely open, any client can access any data

**Problems:**
- Multi-user scenarios impossible
- No workspace isolation
- No way to share pipelines with team
- No audit trail (who ran what when)

**Solution Required:**
- OAuth2/JWT authentication
- RBAC (admin, editor, viewer roles)
- Workspace-level isolation
- Audit logging

**Estimated Effort:** 50-80 dev hours (auth integration, RBAC design, audit infrastructure)

---

## Recommended Roadmap

### Phase 3: Async Execution & Observability (Weeks 1-3)
**Goal:** Make long-running pipelines production-ready

#### 3.1 Job Queue Infrastructure
**What:** Redis + background worker service
**Files to Create:**
- `app/queue/` – Job queue wrapper
- `app/workers/` – Background worker (separate service)
- `app/jobs/` – Job models and status tracking

**Backend Changes:**
- Convert `POST /v1/pipelines/run` to enqueue job (returns job_id immediately)
- Add `GET /v1/jobs/{job_id}` for status polling
- Add `DELETE /v1/jobs/{job_id}` for cancellation
- Update ORM to track job_id on runs

**Frontend Changes:**
- Update Toolbar.tsx to use job polling instead of awaiting response
- Add progress bar during execution
- Add "Cancel Run" button

**Acceptance Criteria:**
- Can submit 30+ minute pipeline
- UI shows progress every 2 seconds
- Can view results after completion

**Effort:** 40-60 hours | **Timeline:** Week 1

---

#### 3.2 Run History UI
**What:** Modal showing execution history with metrics

**Files to Create:**
- `frontend/src/components/RunHistoryModal.tsx`
- `frontend/src/components/RunDetailView.tsx`

**Features:**
- List all runs for a pipeline (sorted by date)
- Status badges (queued, running, succeeded, failed)
- Click row to see node-by-node metrics
- View error messages and stack traces
- Duration and row count per node

**Acceptance Criteria:**
- Can see all past runs for a pipeline
- Can inspect why a run failed
- Shows rows processed and time taken per node

**Effort:** 20-30 hours | **Timeline:** Week 2

---

#### 3.3 Enhanced Error Handling
**What:** Better error messages and recovery options

**Backend Changes:**
- Structured error responses (code, message, details)
- Node-level error capture
- Partial success tracking (e.g., 3/5 nodes succeeded)

**Frontend Changes:**
- Error detail view in RunDetailView
- "Retry" button for failed runs
- Suggested fixes based on error code

**Acceptance Criteria:**
- See clear error message when run fails
- Can retry without re-uploading files

**Effort:** 10-15 hours | **Timeline:** Week 2-3

**Phase 3 Total:** 70-105 hours (~2-3 weeks with pair programming)

---

### Phase 4: Configuration & Credentials (Weeks 4-5)
**Goal:** Enable production deployments with secure configs

#### 4.1 Connection Management UI
**What:** Visual manager for database, S3, API connections

**Files to Create:**
- `frontend/src/components/ConnectionManagerModal.tsx`
- `frontend/src/components/ConnectionForm.tsx`
- `backend/app/connections/` – Connection type registry

**Features:**
- CRUD modal for connections
- Type-specific forms (PostgreSQL, MySQL, S3, HTTP, etc.)
- Test connection button
- Encrypt sensitive fields
- Connection selection in node config UI

**Backend Changes:**
- Add connection type registry
- Implement type-specific validation
- Add connection test endpoint

**Acceptance Criteria:**
- Create PostgreSQL connection without writing code
- Reuse same connection across multiple pipelines
- Connection secrets encrypted in database

**Effort:** 30-40 hours | **Timeline:** Week 4

---

#### 4.2 Credentials Vaulting
**What:** Encrypt sensitive fields at rest and in transit

**Backend Implementation:**
- Add `encrypted_config` field to Connection ORM
- Implement encryption/decryption middleware
- Environment variable substitution support

**Frontend Changes:**
- Hide sensitive fields in UI
- Show masked values (e.g., `****...****`)

**Acceptance Criteria:**
- Database passwords encrypted in database
- Can't read encrypted values without decryption key
- Support env var substitution (e.g., `$DB_PASSWORD`)

**Effort:** 15-20 hours | **Timeline:** Week 5

**Phase 4 Total:** 45-60 hours (~1-2 weeks)

---

### Phase 5: Multi-Workspace & Auth (Weeks 6-8)
**Goal:** Multi-tenant SaaS ready

#### 5.1 Authentication
**What:** OAuth2/JWT with support for multiple identity providers

**Backend Implementation:**
- Add Auth0/Cognito integration
- JWT token validation middleware
- Refresh token rotation

**Frontend Implementation:**
- Login page
- Token storage (secure)
- Auto-logout on expiration
- Redirect to login on 401

**Database Changes:**
- Add `workspace_id` to all major tables
- Add `user_id` to audit tables

**Acceptance Criteria:**
- Users must log in to access app
- Tokens refresh automatically
- Logout clears all state

**Effort:** 40-50 hours | **Timeline:** Week 6-7

---

#### 5.2 RBAC & Workspace Isolation
**What:** Role-based access control with workspace separation

**Roles:**
- **Admin:** Full access, can invite users, manage billing
- **Editor:** Create/edit/delete pipelines, run them
- **Viewer:** Read-only access to pipelines and runs

**Backend Changes:**
- Add `role` field to user-workspace join table
- Filter all queries by workspace_id
- Add permission checks to endpoints

**Frontend Changes:**
- Hide actions based on role (delete, edit disabled for viewers)
- Show role badge in users list

**Acceptance Criteria:**
- User A creates workspace, User B can't see it
- User B can join with invitation link
- User B as viewer can't delete pipelines

**Effort:** 30-40 hours | **Timeline:** Week 7-8

---

#### 5.3 Audit Logging
**What:** Track who ran what pipeline and when

**Implementation:**
- Add `audit_log` table
- Log all significant actions (create, update, delete, execute)
- Include user_id, timestamp, action, resource_id

**Frontend:**
- Audit log viewer (who did what when)
- Export audit logs for compliance

**Acceptance Criteria:**
- Audit log shows all actions by user
- Can export logs for compliance audit
- Can't delete audit logs

**Effort:** 15-20 hours | **Timeline:** Week 8

**Phase 5 Total:** 85-110 hours (~2-3 weeks)

---

### Phase 6: Advanced Features (Ongoing)
**Low Priority - Do After Phase 5**

- **Scheduling:** Cron expressions or UI date/time picker for recurring runs
- **Notifications:** Slack/Email alerts on run completion or failure
- **Versioning:** Full version history with rollback
- **Collaboration:** Comments/annotations on pipelines
- **Templates:** Pre-built pipeline templates for common tasks
- **Performance Monitoring:** Dashboards showing pipeline performance trends

---

## Technical Architecture Decisions

### Job Queue Technology
**Options:**
1. **Redis + RQ** ✅ Recommended
   - Simple setup
   - Good Python integration
   - Battle-tested at scale
   - No additional database needed

2. **Postgres LISTEN/NOTIFY**
   - Already have Postgres
   - More complex to implement
   - Less scalable than Redis

3. **Celery**
   - More powerful but overkill for this phase
   - Complexity not justified yet

**Decision:** Redis + RQ for Phase 3, migrate to Celery if needed in Phase 6

---

### Credentials Encryption
**Implementation:**
- Use `cryptography` library with Fernet (symmetric encryption)
- Encryption key stored in environment variable
- Encrypt sensitive fields before database insert
- Decrypt on retrieval

---

### Authentication Provider
**Options:**
1. **Auth0** ✅ Recommended
   - Handles all OAuth flows
   - Multi-factor authentication built-in
   - Compliance ready (SOC2, GDPR)
   - Easy role management

2. **Custom JWT**
   - More control but more maintenance
   - Have to implement MFA yourself

**Decision:** Auth0 for Phase 5

---

## Current Test Coverage

| Component | Coverage | Status |
|-----------|----------|--------|
| Backend Core | 16/16 tests | ✅ 100% |
| Frontend TypeScript | 269 modules | ✅ Compiles clean |
| API Endpoints | 13/13 manual | ✅ Tested |
| End-to-End | Pipeline save → run | ✅ Validated |
| Unit Tests | Domain logic | ✅ Good |
| Integration Tests | API + Database | 🟡 Minimal |
| UI Tests | Components | 🔴 None |
| E2E Tests | Full workflows | 🔴 None |

**Phase 3 addition:** E2E tests for job queue (Cypress or Playwright)

---

## Deployment Considerations

### Current (Development)
```
Frontend (npm run dev) → Vite proxy → API (uvicorn)
All running on localhost
SQLite or test database
```

### Phase 3 (Production)
```
Frontend (npm run build) → Nginx/CDN
API (uvicorn + gunicorn) → Load balancer
Redis (for queue)
PostgreSQL (primary + replica)
Worker service (separate instances)
```

### Phase 5 (SaaS)
```
+ Auth0 integration
+ Workspace isolation at database/API level
+ Audit logging
+ Encryption at rest
+ Separate environments (staging/prod)
```

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Job queue fails to start | **High** | Unit test queue setup, staging environment |
| Long-running jobs cause worker crash | **High** | Timeout handling, dead-letter queue |
| Encryption keys leaked | **Critical** | Use AWS Secrets Manager, never commit keys |
| Auth token expiration not handled | **Medium** | Auto-refresh middleware, clear error messages |
| Database performance with workspace isolation | **Medium** | Index on (workspace_id, created_at), load testing |

---

## Success Metrics

### Phase 3 Success
- [ ] Can execute 60-minute pipeline without timeout
- [ ] Run history shows 100+ past runs with full metrics
- [ ] Error messages clearly explain what failed
- [ ] UI remains responsive during long execution

### Phase 4 Success
- [ ] 20+ connection configurations stored securely
- [ ] Zero hardcoded credentials in pipeline definitions
- [ ] Rotation of credentials doesn't require pipeline edits

### Phase 5 Success
- [ ] 2+ users in separate workspaces, can't see each other's data
- [ ] Audit log shows all 10,000+ actions for compliance
- [ ] 99.9% uptime in production

---

## Budget & Timeline Estimate

| Phase | Effort (Hours) | Duration | Team Size |
|-------|----------------|----------|-----------|
| 3 (Async/Observability) | 70-105 | 2-3 weeks | 2 engineers |
| 4 (Config/Credentials) | 45-60 | 1-2 weeks | 1-2 engineers |
| 5 (Auth/RBAC) | 85-110 | 2-3 weeks | 2 engineers |
| **Total to Production** | **200-275** | **5-8 weeks** | **2 engineers** |

**Parallel Work Possible:**
- Week 1-3: Engineer A works on Phase 3 (async), Engineer B works on Phase 4 (UI)
- Week 4-5: Combined effort on Phase 4 completion
- Week 6-8: Full team on Phase 5 (auth/RBAC is complex)

---

## Next Immediate Steps (This Sprint)

### Priority 1: Job Queue Setup (Days 1-3)
- [ ] Add Redis to project (docker-compose or managed service)
- [ ] Install RQ library
- [ ] Create job queue wrapper (`app/queue/`)
- [ ] Write unit tests for queue

### Priority 2: Worker Service (Days 4-7)
- [ ] Create separate worker service
- [ ] Implement job pickup and execution
- [ ] Update database with job status
- [ ] Handle failures and retries

### Priority 3: Frontend Job Polling (Days 8-10)
- [ ] Update Toolbar run button to use job queue
- [ ] Add progress bar during execution
- [ ] Implement polling logic (2s interval)
- [ ] Show "Cancel" button

### Priority 4: Bug Fixes & Testing (Days 11-14)
- [ ] Test file upload with real CSV files
- [ ] Verify save pipeline end-to-end
- [ ] Test long-running pipeline (simulate with sleep)
- [ ] Integration tests for queue + worker

---

## Dependencies to Add

### Phase 3
```bash
pip install redis rq python-rq
```

### Phase 4
```bash
pip install cryptography
```

### Phase 5
```bash
pip install python-jose[cryptography] passlib[bcrypt]
# And Auth0 SDK
pip install auth0-python
```

---

## Documentation to Update

- [ ] API docs with async execution flow
- [ ] Architecture guide (diagram of queue system)
- [ ] Setup guide for Redis + workers
- [ ] Deployment guide for production
- [ ] Troubleshooting guide (common issues)

---

## Open Questions for Review

1. **Job Queue Storage:** Use Redis or Postgres LISTEN/NOTIFY?
2. **Worker Scaling:** How many workers should production run? (Recommend 3-5)
3. **Job Retention:** How long to keep completed job records? (Recommend 30 days)
4. **Auth Provider:** Auth0 or self-hosted JWT? (Recommend Auth0)
5. **Encryption Key Rotation:** How often? How to handle rotation? (Recommend AWS Secrets Manager)

---

## Conclusion

The Pipeline Builder has a **solid foundation** (Phases 1-2) and is **ready for Phase 3 development**. The focus should be on:

1. **Making it production-grade** (async execution, observability)
2. **Making it secure** (auth, encryption, audit logs)
3. **Making it multi-tenant** (workspace isolation, RBAC)

With a focused 2-engineer team, we can reach production-ready SaaS status in **5-8 weeks**.

---

**Document Version:** 1.0  
**Last Updated:** October 6, 2026  
**Next Review:** After Phase 3 completion
