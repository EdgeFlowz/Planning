# Data Pipeline Builder — Product & Technical Requirements

**Status:** Draft / v0.1  
**Audience:** Founders, architects, backend/frontend engineers, future contributors  
**Primary goal:** Define the product scope, architecture, requirements, and implementation roadmap for a visual, user-defined ETL/data pipeline platform.

---

## 1. Product Overview

We are building a self-service data pipeline platform that allows users to visually define, configure, validate, execute, monitor, and version data pipelines without writing an entire ETL application from scratch.

A user should be able to:

1. Define one or more data inputs.
2. Inspect the input schema and sample records.
3. Add transformation steps using configurable components.
4. Connect transformations into a directed acyclic graph (DAG).
5. Validate the pipeline before execution.
6. Preview data at intermediate stages.
7. Define one or more outputs.
8. Execute the pipeline manually or through a schedule.
9. Monitor execution status, logs, metrics, and failures.
10. Save and version the pipeline so a previous definition can be reproduced.

The initial implementation will use:

- **Backend:** Python + FastAPI + Pydantic
- **Data engine:** Polars
- **Frontend:** React + TypeScript
- **Pipeline editor:** React Flow / `@xyflow/react`
- **Metadata store:** PostgreSQL
- **Job execution:** Dedicated worker process(es), not the API process
- **Object/file storage:** Local filesystem for development; S3-compatible storage for production
- **Containerization:** Docker

The platform should be designed so additional connectors, transformations, execution backends, and deployment models can be added without changing the core domain model.

---

## 2. Product Principles

### 2.1 Declarative before imperative

A pipeline definition should describe **what** the user wants to happen rather than storing arbitrary executable Python code as the primary representation.

The canonical pipeline representation should be JSON-compatible and versionable.

### 2.2 Typed components

Every node should declare:

- Input port(s)
- Output port(s)
- Configuration schema
- Input requirements
- Output schema behavior
- Capabilities/limitations
- Version

This enables the application to validate a pipeline before running it.

### 2.3 Execution is separate from API/UI

The FastAPI service should orchestrate requests and metadata operations, but long-running data processing must happen in isolated worker processes.

Do not run arbitrary or long-running Polars jobs inside API request handlers.

### 2.4 Previewability is a first-class feature

Users should be able to inspect a limited sample of data at important points in a pipeline without executing the entire production workload.

### 2.5 Reproducibility

A run must be associated with an immutable pipeline version and the configuration used for that run.

### 2.6 Safe extensibility

Connector and transformation extensions should use explicit plugin interfaces. Arbitrary Python execution should not be enabled in the first production release.

### 2.7 Simple deployment first

The first deployment should be understandable and operable by a small team. Avoid introducing Kubernetes, Kafka, distributed schedulers, or a large microservice fleet unless actual requirements justify them.

---

# 3. Goals and Non-Goals

## 3.1 Initial Goals

- Visual DAG editor.
- Configurable input/output connectors.
- Common relational/data-frame transformations.
- Polars-based execution engine.
- Schema discovery and validation.
- Data previews.
- Pipeline validation before execution.
- Manual execution.
- Scheduled execution.
- Execution history and logs.
- Pipeline versioning.
- Basic secrets/credential management.
- API-driven architecture.
- Automated unit/integration/end-to-end testing.
- Local Docker-based development environment.

## 3.2 Explicit Non-Goals for MVP

The following should **not** become initial requirements:

- Full enterprise data catalog.
- Real-time event streaming.
- Exactly-once processing across arbitrary external systems.
- Distributed computation across hundreds of machines.
- Arbitrary untrusted user Python execution.
- Full-featured SQL IDE.
- Machine-learning workflow management.
- Complex data governance/cataloging.
- Multi-region deployment.
- Kubernetes-first deployment.
- Replacing dedicated orchestration platforms for very large workloads.

These may become future capabilities after real usage demonstrates the need.

---

# 4. Core Domain Model

The system should revolve around the following entities.

## 4.1 Workspace

A logical namespace containing users, pipelines, connections, schedules, and execution history.

Properties:

- `id`
- `name`
- `created_at`
- `updated_at`

## 4.2 Pipeline

A logical workflow owned by a workspace.

Properties:

- `id`
- `workspace_id`
- `name`
- `description`
- `status`
- `current_version_id`
- `created_by`
- `created_at`
- `updated_at`

A Pipeline itself is mutable metadata; each published version is immutable.

## 4.3 PipelineVersion

An immutable snapshot of a pipeline definition.

Properties should include:

- `id`
- `pipeline_id`
- `version_number`
- `definition_json`
- `created_by`
- `created_at`
- `published_at`
- `checksum`

The `definition_json` is the canonical DAG representation.

## 4.4 Node

A single operation in a pipeline.

Example node types:

- `source.csv`
- `source.parquet`
- `source.sql`
- `transform.select`
- `transform.filter`
- `transform.rename`
- `transform.cast`
- `transform.join`
- `transform.aggregate`
- `transform.sort`
- `transform.deduplicate`
- `transform.expression`
- `sink.parquet`
- `sink.csv`
- `sink.sql`

## 4.5 Edge

A connection from an output port to an input port.

Minimum properties:

- `source_node_id`
- `source_port`
- `target_node_id`
- `target_port`

## 4.6 Connection

A stored external-system configuration such as a database, S3 bucket, API, or file location.

Credentials must never be stored directly in pipeline definitions.

## 4.7 PipelineRun

One execution attempt against one immutable PipelineVersion.

Properties should include:

- `id`
- `pipeline_id`
- `pipeline_version_id`
- `trigger_type`
- `status`
- `started_at`
- `completed_at`
- `requested_by`
- `error_summary`

Statuses:

- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`
- `timed_out`

## 4.8 NodeRun

Execution metadata for an individual node during a pipeline run.

Useful properties:

- `id`
- `pipeline_run_id`
- `node_id`
- `status`
- `started_at`
- `completed_at`
- `rows_in`
- `rows_out`
- `bytes_read`
- `bytes_written`
- `error_summary`

## 4.9 Artifact

A data or diagnostic object generated by a run.

Examples:

- Preview dataset
- Materialized intermediate dataset
- Query plan
- Execution log
- Error report
- Output file

Artifacts should be addressable independently of UI state.

---

# 5. Canonical Pipeline Definition

The pipeline definition must be independent of React Flow's internal representation.

React Flow is a UI/editor implementation detail. The backend should own the canonical format.

Example:

```json
{
  "schema_version": "1.0",
  "nodes": [
    {
      "id": "source_1",
      "type": "source.csv",
      "version": "1.0",
      "config": {
        "connection_id": "conn_123",
        "path": "sales.csv",
        "has_header": true
      }
    },
    {
      "id": "filter_1",
      "type": "transform.filter",
      "version": "1.0",
      "config": {
        "expression": "amount > 0"
      }
    },
    {
      "id": "sink_1",
      "type": "sink.parquet",
      "version": "1.0",
      "config": {
        "connection_id": "conn_456",
        "path": "output/sales.parquet"
      }
    }
  ],
  "edges": [
    {
      "source": "source_1",
      "source_port": "output",
      "target": "filter_1",
      "target_port": "input"
    },
    {
      "source": "filter_1",
      "source_port": "output",
      "target": "sink_1",
      "target_port": "input"
    }
  ]
}
```

### Requirements

- Definition must be JSON serializable.
- Definition must be schema-versioned.
- Unknown fields should be handled deliberately, not silently ignored.
- Node types must be versioned.
- IDs must be stable enough to support debugging and lineage.
- Backend validation must not depend on frontend validation.
- Definitions must be immutable once published.

---

# 6. Pipeline Graph Requirements

The pipeline is a **directed acyclic graph**.

The backend must validate:

- Graph contains no cycles.
- Every edge references existing nodes.
- Ports exist.
- Port types are compatible.
- Required configuration values exist.
- Referenced connections exist and are accessible.
- A source has no required upstream input.
- A sink has a valid upstream path.
- No orphan nodes exist unless explicitly permitted.
- Node types are supported by the selected execution engine.

The validator should return structured diagnostics rather than a single generic error.

Example:

```json
{
  "valid": false,
  "errors": [
    {
      "code": "INVALID_CAST",
      "node_id": "cast_1",
      "field": "column",
      "message": "Column 'amount' does not exist in the upstream schema."
    }
  ],
  "warnings": []
}
```

The same validator should be callable from:

- API
- CLI/dev tooling
- Worker before execution
- Tests

---

# 7. Transformation System

## 7.1 Initial Transformation Catalog

The first release should focus on transformations that map cleanly to Polars expressions.

### Column operations

- Select columns
- Rename columns
- Drop columns
- Reorder columns
- Create calculated columns
- Cast data types

### Row operations

- Filter
- Sort
- Limit
- Deduplicate

### Aggregation

- Group by
- Aggregate
- Window operations where practical

### Combining datasets

- Inner join
- Left join
- Semi join
- Anti join
- Concatenate/union

### Data quality

- Null checks
- Required column checks
- Type checks
- Range checks
- Duplicate checks

### Utility

- Sample
- Add constant
- Add current/run metadata

## 7.2 Expression Model

Expressions should initially use a constrained declarative representation instead of arbitrary Python.

Example:

```json
{
  "type": "binary_operation",
  "operator": ">",
  "left": {
    "type": "column",
    "name": "amount"
  },
  "right": {
    "type": "literal",
    "value": 0
  }
}
```

This can compile into a Polars expression.

The system should eventually support a higher-level expression DSL capable of representing common Polars operations without requiring users to know Python.

## 7.3 Arbitrary Python

Arbitrary Python transformation code is a future capability, not an MVP feature.

If introduced later, it must run in an isolated execution environment with:

- Restricted filesystem access
- Restricted network access
- Resource limits
- Execution timeout
- Dependency isolation
- Explicit package allowlist
- Audit logging

Never execute user-provided Python inside the FastAPI process.

---

# 8. Input/Output Connector System

Connectors should be plugin-oriented.

## 8.1 Initial Sources

Recommended MVP sources:

1. CSV
2. Parquet
3. PostgreSQL / compatible SQL database
4. Local file system for development
5. S3-compatible object storage

Potential later sources:

- Excel
- REST API
- Azure Blob Storage
- SQL Server
- Snowflake
- BigQuery
- SFTP
- SharePoint

## 8.2 Initial Sinks

Recommended MVP sinks:

1. CSV
2. Parquet
3. PostgreSQL
4. S3-compatible object storage

Potential later sinks should reuse the connector abstraction rather than implementing special cases in the execution engine.

## 8.3 Connector Interface

Conceptually:

```python
class SourceConnector(Protocol):
    type: str
    version: str

    def validate_config(self, config: dict) -> list[Diagnostic]: ...

    def discover_schema(self, config: dict) -> Schema: ...

    def read(self, config: dict) -> pl.LazyFrame: ...


class SinkConnector(Protocol):
    type: str
    version: str

    def validate_config(self, config: dict) -> list[Diagnostic]: ...

    def write(self, frame: pl.LazyFrame, config: dict) -> WriteResult: ...
```

This is illustrative; the concrete interfaces should be finalized after the first two connectors are implemented.

---

# 9. Polars Execution Architecture

Polars should be the primary computation engine.

Where possible, pipeline transformations should compile into a single or small number of Polars `LazyFrame` plans instead of eagerly materializing a DataFrame after every node.

The execution engine should generally follow:

```text
Connector Source
      |
      v
LazyFrame
      |
      +--> transformation expression
      |
      +--> transformation expression
      |
      +--> transformation expression
      |
      v
Sink / collect / preview
```

Polars' lazy API is well suited to this model because execution is deferred, the optimizer can reason across transformations, and streaming execution can reduce memory pressure for larger-than-memory workloads. citeturn446636search1turn446636search3turn446636search7

## 9.1 Execution Strategy

The executor should:

1. Load the immutable pipeline definition.
2. Validate the definition.
3. Resolve connector implementations.
4. Topologically sort the DAG.
5. Build a runtime execution plan.
6. Construct lazy expressions where possible.
7. Execute nodes according to dependency order.
8. Record node-level status and metrics.
9. Materialize only when required.
10. Write final outputs.

## 9.2 Branching

The engine must support graphs such as:

```text
             +--> Transform A --> Sink A
Source -----|
             +--> Transform B --> Transform C --> Sink B
```

The MVP may execute branches sequentially. The internal model should not prevent future parallel branch execution.

## 9.3 Materialization

Avoid automatically writing every intermediate node to disk.

Materialization should occur when:

- Required for a sink.
- Required for preview.
- Required to reduce recomputation.
- Required because an external connector breaks the lazy pipeline.
- Explicitly requested by the pipeline configuration.

---

# 10. Schema System

Schema awareness is one of the highest-value parts of the product.

The system should represent:

- Column name
- Data type
- Nullable/non-nullable
- Optional metadata/description
- Optional semantic role

Example:

```json
{
  "columns": [
    {
      "name": "customer_id",
      "dtype": "Int64",
      "nullable": false
    },
    {
      "name": "amount",
      "dtype": "Float64",
      "nullable": true
    }
  ]
}
```

## Schema requirements

- Schema can be discovered from a source.
- Schema can be previewed in the UI.
- Transformations should derive an expected output schema where feasible.
- Invalid column references should be surfaced before execution.
- Schema changes should be visible to users.
- The application should distinguish between **known**, **inferred**, and **runtime-only** schema information.

---

# 11. Preview System

The preview system is a core UX capability, not just a debugging convenience.

Users should be able to select a node and request:

- Input schema
- Output schema
- Sample rows
- Row count where inexpensive
- Polars logical/optimized plan where useful
- Transformation configuration

Preview execution should be bounded.

Requirements:

- Configurable row limit.
- Execution timeout.
- Memory/resource limits.
- No production sink writes during preview.
- Preview should use an isolated execution context.
- Preview results should have an expiry/retention policy.

The UI should clearly distinguish **preview data** from production output.

---

# 12. Execution and Job System

## 12.1 Architecture

```text
React UI
   |
   v
FastAPI API
   |
   +---- PostgreSQL (metadata)
   |
   +---- Job Queue / Scheduler
                |
                v
          Worker Process
                |
                v
             Polars
                |
        +-------+--------+
        |                |
   Data Sources      Data Sinks
```

FastAPI BackgroundTasks should not be treated as the primary compute/job infrastructure. FastAPI documents background tasks as suitable for work that can run after a response, while long-running computation should be moved to separate worker infrastructure when appropriate. citeturn446636search6

## 12.2 Worker Requirements

A worker must:

- Claim a run.
- Load the immutable pipeline version.
- Validate again before execution.
- Execute nodes.
- Emit structured logs.
- Update run/node status.
- Capture metrics.
- Handle cancellation where possible.
- Fail cleanly on unexpected exceptions.
- Release resources after completion.

## 12.3 Job Queue

For MVP, choose one simple queue implementation rather than building a distributed scheduler.

Candidate approaches:

- Redis-backed queue.
- PostgreSQL-backed job queue.
- Lightweight Python task queue.

The queue interface should be abstracted behind the application so it can be replaced later.

A scheduler can initially create execution jobs rather than directly executing pipelines.

---

# 13. Scheduling

MVP should support:

- Manual run.
- Cron-style schedules.
- Enable/disable schedule.
- Timezone selection.
- Start/end dates.
- Overlap policy.

Overlap policies:

- Allow concurrent runs.
- Skip if previous run is active.
- Queue behind previous run.

More advanced features such as dependency-triggered workflows should be deferred.

---

# 14. API Requirements

The API should be REST/JSON initially.

Potential endpoint groups:

```text
/api/v1/workspaces
/api/v1/pipelines
/api/v1/pipelines/{id}
/api/v1/pipelines/{id}/versions
/api/v1/pipelines/{id}/validate
/api/v1/pipelines/{id}/preview
/api/v1/pipelines/{id}/runs
/api/v1/runs/{id}
/api/v1/runs/{id}/logs
/api/v1/connections
/api/v1/connectors
/api/v1/schedules
```

Requirements:

- All endpoints explicitly versioned.
- Request/response models defined with Pydantic.
- Consistent error response structure.
- Pagination for collections.
- Filtering/sorting where needed.
- Idempotency for execution-triggering operations where appropriate.
- OpenAPI documentation generated from FastAPI.
- Authentication/authorization enforced at service boundaries.

FastAPI's integration with typed request/response models makes Pydantic a natural fit for the API contract and validation layer. See the official FastAPI and Pydantic documentation when finalizing implementation details.

---

# 15. API Error Contract

All predictable application errors should use a consistent structure.

Example:

```json
{
  "error": {
    "code": "PIPELINE_VALIDATION_FAILED",
    "message": "The pipeline contains validation errors.",
    "details": [
      {
        "node_id": "filter_1",
        "code": "UNKNOWN_COLUMN",
        "message": "Column 'revenue' does not exist."
      }
    ],
    "request_id": "req_123"
  }
}
```

Do not expose raw Python stack traces to normal end users.

Stack traces should be available to privileged diagnostic logs.

---

# 16. Frontend Requirements

## 16.1 Core Screens

### Pipeline list

- Search
- Filter
- Create
- Duplicate
- Delete/archive
- Last run status
- Last modified

### Pipeline editor

- Canvas
- Node palette
- Drag/drop nodes
- Connect ports
- Node configuration panel
- Validation errors
- Run button
- Save/publish controls
- Preview action
- Execution status

### Run details

- Overall status
- Duration
- Node statuses
- Node timings
- Rows in/out
- Error details
- Logs
- Output artifacts

### Connections

- Create/edit connection
- Test connection
- Credential management
- Connection type

### Schedules

- Create schedule
- Enable/disable
- Next run
- Last run
- Failure status

## 16.2 Pipeline Editor

React Flow is a strong fit for the node-based editing surface because it provides the primitives needed for draggable nodes, edges, selection, minimaps, controls, custom nodes, and an interactive graph editor. The current package is `@xyflow/react`. citeturn446636search0turn446636search13

The frontend must not treat React Flow state as the source of truth. It should transform UI state into the backend pipeline definition.

## 16.3 State Management

Use a clear separation between:

- Server state: pipelines, runs, schemas, connectors.
- Editor state: nodes, edges, selection, unsaved changes.
- UI state: dialogs, panels, notifications.

Avoid putting all application state into one global store.

## 16.4 TypeScript

Use TypeScript for the frontend. React officially supports TypeScript and provides guidance for typed components and hooks. citeturn446636search11

Generate or derive API client types from the backend contract where practical so the frontend and backend do not maintain duplicate request/response definitions manually.

---

# 17. Security Requirements

Security must be designed into the architecture even for a small initial deployment.

## 17.1 Credentials

Pipeline JSON must reference credentials by ID rather than storing secrets.

Example:

```json
{
  "connection_id": "conn_123"
}
```

not:

```json
{
  "username": "admin",
  "password": "secret"
}
```

Recommended progression:

- Development: environment variables / local secret configuration.
- Early deployment: encrypted application secrets.
- Mature deployment: external secret manager.

## 17.2 Network access

Connector capabilities should be explicit.

Do not allow arbitrary outbound networking from arbitrary transformation code.

## 17.3 Authorization

Design for resource-level authorization even if the first release only has a simple user/workspace model.

Authorization boundaries should exist around:

- Workspace
- Pipeline
- Connection
- Run
- Artifact

## 17.4 Auditing

Record important events:

- Pipeline created.
- Pipeline published.
- Pipeline deleted/archived.
- Connection created/changed.
- Pipeline executed.
- Schedule changed.
- Permission changed.

---

# 18. Observability

Each pipeline run should generate structured telemetry.

## Required metrics

At minimum:

- Run duration.
- Node duration.
- Rows read.
- Rows written.
- Bytes read/written when available.
- Success/failure count.
- Queue wait time.

## Logs

Logs should be structured rather than plain unstructured strings where possible.

Example:

```json
{
  "timestamp": "2026-08-16T22:00:00Z",
  "level": "INFO",
  "run_id": "run_123",
  "node_id": "filter_1",
  "event": "node_completed",
  "rows_out": 125430,
  "duration_ms": 812
}
```

Use a request/run correlation ID throughout API and worker operations.

OpenTelemetry can be evaluated once the basic execution telemetry is stable.

---

# 19. Error Handling

Errors should be classified.

Suggested classes:

### Configuration errors

Example: missing required connector option.

### Validation errors

Example: transformation references nonexistent column.

### Connection errors

Example: database unavailable.

### Data errors

Example: invalid value cannot be cast under configured policy.

### Execution errors

Example: unexpected Polars/runtime failure.

### System errors

Example: worker process failure.

The UI should show a concise actionable message and allow privileged users to inspect deeper diagnostic information.

Retries should be selective. Do not blindly retry data validation failures or deterministic transformation errors.

---

# 20. Data Quality / Assertions

The product should distinguish **transformation logic** from **data quality rules**.

Example pipeline:

```text
Source
  |
  v
Transform
  |
  v
Quality Check
  |
  v
Sink
```

Quality nodes should be able to:

- Pass/fail the pipeline.
- Emit warnings.
- Count violations.
- Produce a diagnostic artifact.
- Optionally route invalid records to a quarantine output in a future version.

This is preferable to hiding validation logic inside arbitrary transformations.

---

# 21. Versioning and Reproducibility

Published pipeline versions are immutable.

A run must always reference:

- Pipeline ID
- Pipeline version
- Connector configuration references
- Execution environment/version
- Runtime configuration

A pipeline should support:

- Draft state.
- Published state.
- Archived state.

Example lifecycle:

```text
Draft --> Published --> Archived
  ^          |
  |          +----> New Draft
  +-----------------+
```

The execution engine must never silently execute a newer pipeline definition than the one associated with the run.

---

# 22. Database Requirements

PostgreSQL should be the initial metadata database.

Recommended entities/tables:

```text
users
workspaces
workspace_members
pipelines
pipeline_versions
connections
schedules
pipeline_runs
node_runs
audit_events
artifacts
```

Keep pipeline graph JSON as a first-class immutable document inside `pipeline_versions`, while storing searchable/relational metadata in normal columns.

Do not prematurely normalize every graph property into relational tables.

The database should provide transactional guarantees around publishing versions, creating runs, and updating run state.

---

# 23. Storage Requirements

Separate **metadata storage** from **data storage**.

PostgreSQL should store metadata, not large datasets.

Datasets/artifacts should live in:

- Local disk during development.
- S3-compatible object storage for production.

The application should use a storage abstraction so the execution engine does not care whether an artifact is stored locally, on S3, or another supported backend.

---

# 24. Recommended Initial Technology Choices

These are recommendations rather than hard requirements. The guiding principle is to minimize infrastructure while preserving clean boundaries.

| Area | Initial choice | Rationale |
|---|---|---|
| Backend API | FastAPI + Pydantic | Strong typed contracts, validation, OpenAPI, async-friendly API layer |
| ORM / DB access | SQLAlchemy 2.x + Alembic | Mature relational mapping and migrations without coupling the domain to the API framework |
| Data engine | Polars | Excellent fit for dataframe-oriented ETL and a lazy execution model |
| Frontend | React + TypeScript | Strong ecosystem and type-safe UI development |
| Graph editor | `@xyflow/react` | Purpose-built for interactive node/edge editors |
| Metadata DB | PostgreSQL | Durable transactional system of record |
| Object storage | S3-compatible | Keeps data/artifacts out of PostgreSQL and works locally via MinIO |
| Queue | Redis-backed job queue or Postgres-backed queue | Keep the initial runtime simple; hide the choice behind an interface |
| Scheduler | Same application/queue initially | Avoid a separate orchestration platform until scheduling requirements justify it |
| Local environment | Docker Compose | Reproducible onboarding and integration testing |
| Python tooling | `uv`, Ruff, Pytest, Pyright/Mypy | Fast dependency management, linting, testing, and type checking |

Do **not** make Kubernetes, Kafka, Temporal, or a distributed compute engine prerequisites for the MVP. They can be evaluated later if real workload requirements justify them.

# 24. Repository Structure

Recommended starting monorepo:

```text
/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── domain/
│   │   ├── application/
│   │   ├── infrastructure/
│   │   ├── connectors/
│   │   ├── transformations/
│   │   ├── execution/
│   │   ├── schemas/
│   │   └── main.py
│   ├── tests/
│   └── pyproject.toml
│
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   ├── components/
│   │   ├── features/
│   │   ├── pipeline-editor/
│   │   ├── pages/
│   │   ├── stores/
│   │   └── types/
│   ├── tests/
│   └── package.json
│
├── docs/
│   ├── requirements.md
│   ├── architecture.md
│   └── decisions/
│
├── infra/
│   ├── docker/
│   └── compose/
│
├── examples/
│   └── pipelines/
│
└── README.md
```

The backend should use clear separation between domain models, application services, infrastructure adapters, and API routing. This is intended to prevent the FastAPI layer from becoming the application architecture.

---

# 25. Testing Requirements

Testing should be built into the project from the first pipeline implementation.

## Unit tests

Cover:

- Pipeline definition validation.
- DAG cycle detection.
- Port/type validation.
- Expression compilation.
- Individual transformations.
- Connector configuration validation.
- Schema inference.
- Serialization/deserialization.

## Integration tests

Cover:

- PostgreSQL metadata operations.
- Source connector reads.
- Sink connector writes.
- Worker execution.
- API -> queue -> worker flow.

## End-to-end tests

At least one complete path:

```text
Create pipeline
 -> publish
 -> run
 -> worker executes
 -> output produced
 -> run marked successful
```

## Property/data tests

Transformation components should have data-oriented tests, including nulls, empty datasets, wrong types, duplicate rows, and edge cases.

Property-based testing should be considered for expression compilation and schema behavior.

---

# 26. Developer Experience

The application should be easy to start locally.

Target developer workflow:

```bash
git clone ...
cd project
docker compose up -d
# start backend
# start worker
# start frontend
```

A new developer should be able to:

1. Start PostgreSQL and required infrastructure.
2. Run database migrations.
3. Start API.
4. Start worker.
5. Start frontend.
6. Create a sample pipeline.
7. Execute it locally.
8. Run the test suite.

Environment configuration should use `.env.example` and documented configuration names. Secrets must never be committed.

---

# 27. CI/CD Requirements

Pull requests should automatically run:

- Backend formatting/linting.
- Backend type checking.
- Backend unit tests.
- Frontend linting/type checking.
- Frontend tests.
- API contract checks where practical.
- Build verification.

Recommended Python tooling should be selected consistently rather than mixing multiple overlapping tools.

A modern baseline could use:

- Ruff
- Pytest
- MyPy or Pyright
- Alembic

Frontend baseline:

- TypeScript
- ESLint
- Vitest
- Playwright for browser E2E tests

Exact tool choices may change, but the project should explicitly document them.

---

# 28. Performance Requirements

MVP performance targets should be validated empirically rather than over-specified before workload characteristics are known.

Initial targets:

- API metadata requests: typically <500 ms excluding external connector latency.
- Pipeline validation: <1 second for normal pipelines.
- Preview request: bounded by configured timeout.
- Worker startup: predictable and observable.

The system should capture enough telemetry to identify whether a bottleneck is caused by:

- Source I/O.
- Polars computation.
- Data serialization.
- Sink I/O.
- Queue wait.
- Database operations.
- Application overhead.

---

# 29. Reliability Requirements

A failed run must not leave the system believing the pipeline succeeded.

Requirements:

- Run state transitions must be persisted.
- Worker failures must eventually become visible as failed/interrupted runs.
- Pipeline versions are immutable.
- Execution records are durable.
- Retried jobs must not accidentally produce duplicate outputs when the sink cannot tolerate duplicates.
- Sink operations should expose an idempotency strategy where possible.

Exactly-once semantics should **not** be claimed globally. Delivery semantics depend on the external source/sink.

---

# 30. UX Requirements for Failure

A failed pipeline should answer:

1. What failed?
2. Which node failed?
3. Why did it fail?
4. What input/schema caused the problem when available?
5. Can I fix it and rerun?
6. Did earlier nodes produce side effects?

The run page should show the DAG with node-level execution status.

Example:

```text
[Source ✓] ---> [Filter ✓] ---> [Join ✕] ---> [Sink -]
                                |
                                +-- Unknown column: customer_id
```

---

# 31. Plugin Architecture

The system should have registries for:

```text
ConnectorRegistry
TransformationRegistry
SinkRegistry
```

Each plugin should declare metadata such as:

```python
PluginDefinition(
    type="transform.filter",
    version="1.0",
    display_name="Filter",
    category="transform",
    config_schema=...,
    input_ports=...,
    output_ports=...,
)
```

This metadata should be usable by both backend and frontend.

Ideally the frontend node palette should eventually be generated from a backend/plugin catalog instead of requiring a code change for every new node.

Polars also provides extension mechanisms for library authors, but the initial product plugin architecture should remain independent of Polars internals so connectors and UI components are not coupled to one implementation detail. citeturn446636search15

---

# 32. Frontend/Backend Contract for Nodes

A future-friendly node catalog response might look like:

```json
{
  "nodes": [
    {
      "type": "transform.filter",
      "version": "1.0",
      "display_name": "Filter",
      "category": "Transform",
      "input_ports": [
        {"name": "input", "kind": "table"}
      ],
      "output_ports": [
        {"name": "output", "kind": "table"}
      ],
      "config_schema": {},
      "capabilities": {
        "preview": true,
        "schema_inference": true
      }
    }
  ]
}
```

This makes the UI configuration-driven and greatly reduces duplicated logic between frontend and backend.

---

# 33. Recommended Architecture

## Logical architecture

```text
                     +----------------------+
                     |      React UI        |
                     | TypeScript + Flow    |
                     +----------+-----------+
                                |
                                | HTTPS / JSON
                                v
                     +----------------------+
                     |      FastAPI API     |
                     | auth / CRUD / runs   |
                     +----+------------+----+
                          |            |
                          |            +----------------+
                          v                             v
                   +-------------+              +---------------+
                   | PostgreSQL  |              | Job Queue     |
                   | metadata    |              | / Scheduler   |
                   +-------------+              +-------+-------+
                                                        |
                                                        v
                                                +---------------+
                                                | Worker        |
                                                | Executor      |
                                                +-------+-------+
                                                        |
                                                        v
                                                +---------------+
                                                | Polars        |
                                                | Execution     |
                                                +-------+-------+
                                                        |
                               +------------------------+----------------------+
                               |                        |                      |
                               v                        v                      v
                           CSV/Files                 SQL DB              Object Store
```

## Design boundaries

### API layer

Responsible for HTTP, authentication, request validation, response serialization, and orchestration.

### Domain layer

Responsible for concepts such as Pipeline, PipelineVersion, Node, Edge, Run, and validation rules.

### Application layer

Responsible for use cases such as:

- Create pipeline.
- Publish pipeline.
- Validate pipeline.
- Preview node.
- Start run.
- Cancel run.
- Get run status.

### Infrastructure layer

Responsible for:

- PostgreSQL repositories.
- Object storage.
- Queue.
- Connector implementations.
- External APIs.

### Execution layer

Responsible for turning a validated pipeline definition into actual data operations.

This layer should be callable without FastAPI so it can be tested and executed by workers independently.

---

# 34. Important Architectural Decisions

## Decision 1 — Canonical DAG outside the UI

**Decision:** React Flow is an editor, not the domain model.

**Reason:** Prevents frontend implementation details from becoming a permanent backend contract.

## Decision 2 — Immutable published versions

**Decision:** Runs always reference immutable pipeline versions.

**Reason:** Enables reproducibility and safe debugging.

## Decision 3 — Declarative transformations first

**Decision:** Transformations are represented as configuration and expressions that compile to Polars.

**Reason:** Enables validation, previews, security, and UI generation.

## Decision 4 — Separate worker execution

**Decision:** Data processing occurs in worker processes.

**Reason:** Keeps API responsive and creates a boundary for resource management.

## Decision 5 — Postgres for metadata

**Decision:** PostgreSQL is the initial system of record for application metadata.

**Reason:** Mature transactions, indexing, reliability, and straightforward operational model.

## Decision 6 — Object storage for data artifacts

**Decision:** Do not store large datasets in PostgreSQL.

**Reason:** Keeps operational metadata separate from bulk data.

## Decision 7 — Plugin interfaces

**Decision:** Connectors and transformations are registry-driven.

**Reason:** New capabilities should not require rewriting the core engine.

---

# 35. MVP Definition

The MVP is complete when a user can build and run this pipeline entirely through the UI:

```text
CSV Source
    |
    v
Select Columns
    |
    v
Filter Rows
    |
    v
Calculated Column
    |
    v
Aggregate
    |
    v
Parquet Sink
```

The user must be able to:

- Select/configure the source.
- Inspect schema.
- Connect nodes visually.
- Configure transformations.
- Preview an intermediate node.
- Validate the pipeline.
- Publish a version.
- Execute it.
- Watch execution status.
- Inspect errors.
- Inspect the resulting output.
- Repeat the run from the same version.

---

# 36. MVP Milestones

## Phase 0 — Foundations

- [ ] Repository structure.
- [ ] Python project configuration.
- [ ] React/TypeScript project.
- [ ] Docker Compose.
- [ ] PostgreSQL.
- [ ] Database migrations.
- [ ] CI pipeline.
- [ ] Basic health checks.

## Phase 1 — Pipeline Domain

- [ ] Pipeline model.
- [ ] Pipeline version model.
- [ ] Canonical JSON definition.
- [ ] DAG validator.
- [ ] Node/edge models.
- [ ] Plugin registry interfaces.
- [ ] Backend pipeline CRUD API.

## Phase 2 — Execution Engine

- [ ] Polars source abstraction.
- [ ] Transformation registry.
- [ ] Basic transformations.
- [ ] Sink abstraction.
- [ ] In-process executor tests.
- [ ] Worker process.
- [ ] Job queue.
- [ ] Run/node-run persistence.

## Phase 3 — Frontend Editor

- [ ] Pipeline editor.
- [ ] Node palette.
- [ ] Custom node components.
- [ ] Configuration panel.
- [ ] Backend-driven node catalog.
- [ ] Validation display.
- [ ] Save/publish flow.

## Phase 4 — Preview and Observability

- [ ] Schema discovery.
- [ ] Data preview.
- [ ] Run page.
- [ ] Node-level statuses.
- [ ] Structured logs.
- [ ] Basic metrics.

## Phase 5 — Scheduling and Hardening

- [ ] Schedule model.
- [ ] Cron execution.
- [ ] Retry policy.
- [ ] Cancellation.
- [ ] Secrets handling.
- [ ] Authorization.
- [ ] Audit logging.
- [ ] Production deployment documentation.

---

# 37. Post-MVP Roadmap

Potential second-stage capabilities:

### More connectors

- Excel
- REST APIs
- SQL Server
- Snowflake
- BigQuery
- Azure Blob
- SFTP

### More transformations

- Pivot/unpivot
- Advanced window functions
- Regex transforms
- Date/calendar transforms
- JSON flattening
- Fuzzy matching

### Data quality

- Reusable validation rules.
- Quality dashboards.
- Quarantine invalid records.
- Rule-level history.

### Operational features

- Parallel branch execution.
- Run cancellation propagation.
- Retries by node.
- Backfills.
- Parameterized runs.
- Environment-specific configuration.

### Collaboration

- Teams/workspaces.
- RBAC.
- Comments.
- Pipeline ownership.
- Approval workflow.

### Extensibility

- SDK for custom connectors.
- SDK for custom transforms.
- Sandboxed Python nodes.
- SQL nodes.

### Enterprise scale

- Distributed workers.
- Worker pools.
- Resource quotas.
- External secret manager.
- OpenTelemetry.
- Horizontal scaling.
- Optional integration with mature workflow orchestrators.

---

# 38. Decisions to Make Before Production

These should be explicitly recorded as Architecture Decision Records (ADRs) before they become difficult to change:

1. Authentication provider.
2. Authorization/RBAC model.
3. Job queue technology.
4. Scheduler technology.
5. Storage provider and abstraction.
6. Secret management approach.
7. Database migration strategy.
8. API versioning policy.
9. Pipeline definition versioning strategy.
10. Connector plugin discovery mechanism.
11. Expression DSL design.
12. Resource limits for worker jobs.
13. Preview isolation strategy.
14. Retry semantics.
15. Output idempotency strategy.
16. Deployment model.
17. Observability stack.

These decisions should be made based on real workload characteristics rather than choosing the largest available technology stack upfront.

---

# 39. Open Technical Questions

The following questions should be resolved through small prototypes rather than discussion alone:

### Execution

- How much of a branching DAG can remain inside one Polars lazy execution plan?
- When should intermediate branches be materialized?
- How should multiple inputs into a node be represented?
- How should schema inference operate across joins and expressions?

### Preview

- Can preview safely execute using the same logical plan with bounded reads?
- Which sources support efficient sampling?
- How do we preview a node whose input requires a large upstream computation?

### Connectors

- What is the minimum connector interface needed for both file and database sources?
- How should connector-specific options be represented?
- How should credentials be resolved at worker execution time?

### Expressions

- Should the expression DSL compile only to Polars expressions or also support SQL-like syntax?
- How much of the Polars API should be exposed?
- How should user-friendly validation messages map back to expression nodes?

### Execution isolation

- What resource limits are required for worker processes?
- Should every run get a separate process or should workers process multiple runs?
- How should runaway jobs be terminated?

---

# 40. Recommended First Prototype

Before implementing authentication, scheduling, or a large connector library, build a vertical slice.

Target:

```text
React editor
   |
   v
FastAPI
   |
   v
Pipeline JSON
   |
   v
Validator
   |
   v
Executor
   |
   v
Polars
   |
   v
Parquet output
```

Specifically implement only:

- CSV source.
- Select.
- Filter.
- Calculated column.
- Aggregate.
- Parquet sink.
- Preview.
- Manual run.

If this vertical slice feels good, the architecture is likely heading in the right direction. If it becomes difficult to implement cleanly, fix the domain/execution model before adding more features.

---

# 41. Success Criteria

The product should eventually make a common ETL workflow materially easier than writing and maintaining a standalone Python script.

The system is successful when users can:

- Build repeatable pipelines visually.
- Understand their data before executing it.
- Catch common errors before production runs.
- Reuse connectors and transformations.
- Inspect why a pipeline failed.
- Reproduce a historical run.
- Add new connectors without modifying the execution engine.
- Scale from small local jobs toward larger workloads without rewriting the product.

The architectural north star is:

> **A visual data workflow definition is compiled into a validated, versioned execution plan and run by an isolated Polars-based worker.**

That separation—**definition → validation → planning → execution → observability**—should remain the central design principle as the system grows.

---

# 42. References

- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [FastAPI Background Tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/)
- [Pydantic Documentation](https://docs.pydantic.dev/)
- [Polars User Guide — Lazy API](https://docs.pola.rs/user-guide/lazy/)
- [Polars User Guide — Streaming](https://docs.pola.rs/user-guide/concepts/streaming/)
- [Polars Python API](https://docs.pola.rs/api/python/stable/reference/)
- [React Documentation](https://react.dev/)
- [React + TypeScript](https://react.dev/learn/typescript)
- [React Flow](https://reactflow.dev/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)

