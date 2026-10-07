import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api.schemas import (
    ConnectorListResponse,
    ConnectionDetailResponse,
    ErrorResponse,
    NodeTypeResponse,
    UploadResponse,
    ValidationResponse,
    ValidationIssueResponse,
    PipelineRunDetailResponse,
    NodeResult,
    JobSubmitRequest,
    JobResponse,
    JobListResponse,
    JobCancelRequest,
)
from app.catalog import NODE_CATALOG, NodeTypeDefinition
from app.config import settings
from app.domain.models import PipelineDefinition
from app.domain.validator import PipelineValidationError, validate_pipeline
from app.execution.executor import execute_pipeline
from app.persistence.session import SessionLocal, get_db

# Initialize database engine
engine = create_engine(settings.database_url, echo=False)
SessionLocal.configure(bind=engine)

# Create uploads directory for temporary file storage
UPLOAD_DIR = Path("./uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

app = FastAPI(
    title="Pipeline Builder API",
    version="0.1.0",
    description="Visual, declarative data pipeline platform",
)


# ============================================================================
# GET /api/v1/connectors (formerly /nodes)
# ============================================================================

@app.get(
    "/v1/connectors",
    response_model=ConnectorListResponse,
    tags=["Connectors"],
    summary="List available node types",
    description="Return every node type the frontend can use, with config JSON schemas.",
)
def list_connectors() -> ConnectorListResponse:
    """List all available connector and transformation node types."""
    connectors = [
        NodeTypeResponse(
            type=node.type,
            category=node.category,
            name=node.name,
            description=node.description,
            version=node.version,
            config_schema=node.config_schema,
            input_ports=node.input_ports,
            output_ports=node.output_ports,
        )
        for node in NODE_CATALOG
    ]
    return ConnectorListResponse(
        connectors=connectors,
        total=len(connectors),
    )


@app.get(
    "/v1/nodes",
    response_model=list[NodeTypeDefinition],
    tags=["Connectors"],
    summary="List available node types (legacy)",
    description="Deprecated: Use /v1/connectors instead.",
    deprecated=True,
)
def list_node_types() -> list[NodeTypeDefinition]:
    """Legacy endpoint. Use /api/v1/connectors instead."""
    return NODE_CATALOG


# ============================================================================
# POST /api/v1/upload
# ============================================================================

@app.post(
    "/v1/upload",
    response_model=UploadResponse,
    tags=["Files"],
    summary="Upload a data file",
    description="Upload CSV or Parquet file and receive server-side path for pipeline config.",
)
async def upload_file(file: UploadFile = File(...)) -> UploadResponse:
    """Upload a CSV or Parquet file and return its server-side path.
    
    The returned path can be used directly in source.csv/source.parquet node configs.
    Files are stored in ./uploads/ with UUID-based names to avoid collisions.
    """
    try:
        # Generate unique filename to avoid collisions
        file_ext = Path(file.filename or "").suffix or ".bin"
        unique_name = f"{uuid.uuid4()}{file_ext}"
        file_path = UPLOAD_DIR / unique_name

        # Read and save file
        contents = await file.read()
        with open(file_path, "wb") as f:
            f.write(contents)

        # Return absolute path for backend to use
        return UploadResponse(path=str(file_path.resolve()))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to upload file: {str(exc)}") from exc


# ============================================================================
# POST /api/v1/pipelines/validate
# ============================================================================

@app.post(
    "/v1/pipelines/validate",
    response_model=ValidationResponse,
    tags=["Pipelines"],
    summary="Validate pipeline definition",
    description="Check pipeline for syntax, schema, and connection errors without executing.",
)
def validate_pipeline_definition(pipeline: PipelineDefinition) -> ValidationResponse:
    """Validate a pipeline definition and return any errors or warnings."""
    issues = validate_pipeline(pipeline)
    
    validation_issues = [
        ValidationIssueResponse(
            code=issue.code,
            message=issue.message,
            node_id=getattr(issue, "node_id", None),
            field=getattr(issue, "field", None),
        )
        for issue in issues
    ]
    
    return ValidationResponse(
        valid=len(validation_issues) == 0,
        errors=validation_issues,
        warnings=[],
    )


# ============================================================================
# POST /api/v1/pipelines/run (execution endpoint)
# ============================================================================

@app.post(
    "/v1/pipelines/run",
    response_model=PipelineRunDetailResponse,
    tags=["Pipelines"],
    summary="Execute a pipeline",
    description="Validate and execute a pipeline definition synchronously (development only). "
                "Production should use async job queue.",
)
def run_pipeline(pipeline: PipelineDefinition) -> PipelineRunDetailResponse:
    """Validate and execute a pipeline definition, returning row/column counts per node.

    This runs synchronously in the API process, which is fine for local development
    but not the target architecture (see requirements.md 2.3) — real execution should
    be handed off to a worker process.
    """
    try:
        outputs = execute_pipeline(pipeline)
    except PipelineValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "PIPELINE_VALIDATION_FAILED",
                "message": "The pipeline contains validation errors.",
                "details": [
                    {
                        "node_id": getattr(issue, "node_id", None),
                        "code": issue.code,
                        "message": issue.message,
                    }
                    for issue in exc.issues
                ],
            },
        ) from exc
    except (KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "EXECUTION_ERROR",
                "message": str(exc),
            },
        ) from exc

    node_types = {node.id: node.type for node in pipeline.nodes}
    node_results = []
    for key, lazy_frame in outputs.items():
        node_id, _, port = key.partition(":")
        frame = lazy_frame.collect()
        node_results.append(
            NodeResult(
                node_id=node_id,
                node_type=node_types[node_id],
                port=port or "output",
                rows=frame.height,
                columns=frame.columns,
            )
        )

    # Return in new structured format
    from datetime import datetime, timezone
    from uuid import uuid4
    from app.domain.models import PipelineRun, PipelineRunStatus
    
    run = PipelineRun(
        id=str(uuid4()),
        pipeline_id=pipeline.pipeline_id,
        pipeline_version=1,  # TODO: get from version store
        status=PipelineRunStatus.SUCCEEDED,
        created_at=datetime.now(timezone.utc),
        started_at=datetime.now(timezone.utc),
        completed_at=datetime.now(timezone.utc),
        error=None,
    )
    
    from app.api.schemas import PipelineRunResponse
    run_response = PipelineRunResponse(
        id=run.id,
        pipeline_id=run.pipeline_id,
        pipeline_version=run.pipeline_version,
        status=run.status.value,
        created_at=run.created_at.isoformat(),
        started_at=run.started_at.isoformat() if run.started_at else None,
        completed_at=run.completed_at.isoformat() if run.completed_at else None,
        error=run.error,
    )
    
    return PipelineRunDetailResponse(
        run=run_response,
        node_results=node_results,
    )


# Legacy endpoints for backward compatibility
# ============================================================================

class NodeResultLegacy(BaseModel):
    """Legacy node result format (for backward compatibility)."""
    node_id: str
    node_type: str
    port: str
    rows: int
    columns: list[str]


class PipelineRunResultLegacy(BaseModel):
    """Legacy pipeline run result format (for backward compatibility)."""
    pipeline_id: str
    node_results: list[NodeResultLegacy]


@app.post(
    "/upload",
    response_model=UploadResponse,
    tags=["Files"],
    deprecated=True,
    summary="Upload a data file (legacy)",
    description="Deprecated: Use /api/v1/upload instead.",
)
async def upload_file_legacy(file: UploadFile = File(...)) -> UploadResponse:
    """Legacy upload endpoint. Use /api/v1/upload instead."""
    return await upload_file(file)


@app.get(
    "/nodes",
    response_model=list[NodeTypeDefinition],
    tags=["Connectors"],
    deprecated=True,
    summary="List node types (legacy)",
    description="Deprecated: Use /api/v1/connectors instead.",
)
def list_nodes_legacy() -> list[NodeTypeDefinition]:
    """Legacy nodes endpoint. Use /api/v1/connectors instead."""
    return list_node_types()


@app.post(
    "/pipelines/run",
    response_model=PipelineRunResultLegacy,
    tags=["Pipelines"],
    deprecated=True,
    summary="Execute pipeline (legacy)",
    description="Deprecated: Use /api/v1/pipelines/run instead.",
)
def run_pipeline_legacy(pipeline: PipelineDefinition) -> PipelineRunResultLegacy:
    """Legacy run endpoint. Use /api/v1/pipelines/run instead."""
    try:
        outputs = execute_pipeline(pipeline)
    except PipelineValidationError as exc:
        raise HTTPException(status_code=422, detail=[issue.__dict__ for issue in exc.issues]) from exc
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    node_types = {node.id: node.type for node in pipeline.nodes}
    node_results = []
    for key, lazy_frame in outputs.items():
        node_id, _, port = key.partition(":")
        frame = lazy_frame.collect()
        node_results.append(
            NodeResultLegacy(
                node_id=node_id,
                node_type=node_types[node_id],
                port=port or "output",
                rows=frame.height,
                columns=frame.columns,
            )
        )

    return PipelineRunResultLegacy(pipeline_id=pipeline.pipeline_id, node_results=node_results)


# ============================================================================
# Pipeline CRUD endpoints (Phase 2)
# ============================================================================

from app.persistence.models import Pipeline as PipelineORM
from app.persistence.repositories.pipelines import PipelineRepository
from app.persistence.repositories.runs import (
    PipelineRunRepository,
    NodeRunRepository,
    ConnectionRepository,
)
from app.domain.models import Pipeline, PipelineVersion, Connection
from datetime import datetime, timezone


class PipelineCreateRequest(BaseModel):
    """Request to create a pipeline."""
    name: str
    description: str = ""
    definition: PipelineDefinition | None = None


class PipelineUpdateRequest(BaseModel):
    """Request to update a pipeline."""
    name: str | None = None
    description: str | None = None


class ConnectionCreateRequest(BaseModel):
    """Request to create a connection."""
    type: str
    name: str
    config: dict


class ConnectionUpdateRequest(BaseModel):
    """Request to update a connection."""
    type: str | None = None
    name: str | None = None
    config: dict | None = None


@app.post(
    "/v1/pipelines",
    tags=["Pipelines"],
    summary="Create a new pipeline",
    description="Create a new pipeline in draft status.",
    response_model=dict,
)
def create_pipeline(
    req: PipelineCreateRequest,
    db: Session = Depends(get_db),
) -> dict:
    """Create a new pipeline (draft).
    
    The pipeline starts in draft status and can be edited until published.
    Accepts optional definition; if not provided, creates an empty pipeline.
    """
    pipeline = Pipeline(
        id=str(uuid.uuid4()),
        name=req.name,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    
    # Use provided definition or create empty one
    definition = req.definition if req.definition else PipelineDefinition(
        pipeline_id=pipeline.id,
        nodes=[],
        edges=[],
    )
    
    version = PipelineVersion(
        pipeline_id=pipeline.id,
        version=1,
        definition=definition,
        created_at=datetime.now(timezone.utc),
    )
    
    repo = PipelineRepository(db)
    created = repo.create(pipeline, version)
    
    return {
        "id": created.id,
        "name": created.name,
        "created_at": created.created_at.isoformat(),
        "updated_at": created.updated_at.isoformat(),
    }


@app.get(
    "/v1/pipelines",
    tags=["Pipelines"],
    summary="List all pipelines",
    description="Get paginated list of all pipelines.",
    response_model=dict,
)
def list_pipelines(
    skip: int = 0,
    limit: int = 10,
    db: Session = Depends(get_db),
) -> dict:
    """List all pipelines with pagination."""
    from sqlalchemy import func
    
    # Get total count
    total = db.query(PipelineORM).count()
    
    # Get paginated results
    pipelines_orm = db.query(PipelineORM).offset(skip).limit(limit).all()
    
    return {
        "pipelines": [
            {
                "id": str(p.id),
                "name": p.name,
                "created_at": p.created_at.isoformat(),
                "updated_at": p.updated_at.isoformat(),
            }
            for p in pipelines_orm
        ],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@app.get(
    "/v1/pipelines/{pipeline_id}",
    tags=["Pipelines"],
    summary="Get a pipeline",
    description="Retrieve a single pipeline by ID.",
    response_model=dict,
)
def get_pipeline(
    pipeline_id: str,
    db: Session = Depends(get_db),
) -> dict:
    """Get a specific pipeline by ID."""
    repo = PipelineRepository(db)
    pipeline = repo.get(pipeline_id)
    
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    
    return {
        "id": pipeline.id,
        "name": pipeline.name,
        "created_at": pipeline.created_at.isoformat(),
        "updated_at": pipeline.updated_at.isoformat(),
    }


@app.patch(
    "/v1/pipelines/{pipeline_id}",
    tags=["Pipelines"],
    summary="Update a pipeline",
    description="Update pipeline name or description.",
    response_model=dict,
)
def update_pipeline(
    pipeline_id: str,
    req: PipelineUpdateRequest,
    db: Session = Depends(get_db),
) -> dict:
    """Update a pipeline's metadata."""
    pipeline_orm = db.query(PipelineORM).filter(
        PipelineORM.id == uuid.UUID(pipeline_id)
    ).first()
    
    if not pipeline_orm:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    
    if req.name is not None:
        pipeline_orm.name = req.name
    pipeline_orm.updated_at = datetime.now(timezone.utc)
    
    db.commit()
    db.refresh(pipeline_orm)
    
    return {
        "id": str(pipeline_orm.id),
        "name": pipeline_orm.name,
        "created_at": pipeline_orm.created_at.isoformat(),
        "updated_at": pipeline_orm.updated_at.isoformat(),
    }


@app.delete(
    "/v1/pipelines/{pipeline_id}",
    tags=["Pipelines"],
    summary="Delete a pipeline",
    description="Delete a pipeline and all its versions.",
    response_model=dict,
)
def delete_pipeline(
    pipeline_id: str,
    db: Session = Depends(get_db),
) -> dict:
    """Delete a pipeline (cascades to versions and runs)."""
    pipeline_orm = db.query(PipelineORM).filter(
        PipelineORM.id == uuid.UUID(pipeline_id)
    ).first()
    
    if not pipeline_orm:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    
    db.delete(pipeline_orm)
    db.commit()
    
    return {"deleted": True, "pipeline_id": pipeline_id}


# ============================================================================
# Run History endpoints (Phase 2)
# ============================================================================

@app.get(
    "/v1/runs",
    tags=["Runs"],
    summary="List all pipeline runs",
    description="Get paginated list of all pipeline runs.",
    response_model=dict,
)
def list_runs(
    skip: int = 0,
    limit: int = 10,
    db: Session = Depends(get_db),
) -> dict:
    """List all pipeline runs with pagination."""
    from app.persistence.models import PipelineRun as PipelineRunORM
    
    total = db.query(PipelineRunORM).count()
    runs_orm = db.query(PipelineRunORM).order_by(
        PipelineRunORM.created_at.desc()
    ).offset(skip).limit(limit).all()
    
    return {
        "runs": [
            {
                "id": str(r.id),
                "pipeline_version_id": str(r.pipeline_version_id),
                "status": r.status,
                "created_at": r.created_at.isoformat(),
                "started_at": r.started_at.isoformat() if r.started_at else None,
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
                "error": r.error,
            }
            for r in runs_orm
        ],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@app.get(
    "/v1/runs/{run_id}",
    tags=["Runs"],
    summary="Get a pipeline run",
    description="Retrieve a single pipeline run with all node results.",
    response_model=dict,
)
def get_run(
    run_id: str,
    db: Session = Depends(get_db),
) -> dict:
    """Get a specific pipeline run and its node execution results."""
    from app.persistence.models import PipelineRun as PipelineRunORM, NodeRun as NodeRunORM
    
    run_orm = db.query(PipelineRunORM).filter(
        PipelineRunORM.id == uuid.UUID(run_id)
    ).first()
    
    if not run_orm:
        raise HTTPException(status_code=404, detail="Run not found")
    
    node_runs = db.query(NodeRunORM).filter(
        NodeRunORM.pipeline_run_id == uuid.UUID(run_id)
    ).all()
    
    return {
        "run": {
            "id": str(run_orm.id),
            "pipeline_version_id": str(run_orm.pipeline_version_id),
            "status": run_orm.status,
            "created_at": run_orm.created_at.isoformat(),
            "started_at": run_orm.started_at.isoformat() if run_orm.started_at else None,
            "completed_at": run_orm.completed_at.isoformat() if run_orm.completed_at else None,
            "error": run_orm.error,
        },
        "node_runs": [
            {
                "id": str(nr.id),
                "node_id": nr.node_id,
                "node_type": nr.node_type,
                "status": nr.status,
                "started_at": nr.started_at.isoformat() if nr.started_at else None,
                "completed_at": nr.completed_at.isoformat() if nr.completed_at else None,
                "rows_read": nr.rows_read,
                "rows_written": nr.rows_written,
                "columns": nr.columns,
                "error": nr.error,
            }
            for nr in node_runs
        ],
    }


@app.get(
    "/v1/pipelines/{pipeline_id}/runs",
    tags=["Runs"],
    summary="List runs for a pipeline",
    description="Get all pipeline runs for a specific pipeline.",
    response_model=dict,
)
def list_pipeline_runs(
    pipeline_id: str,
    skip: int = 0,
    limit: int = 10,
    db: Session = Depends(get_db),
) -> dict:
    """List all runs for a specific pipeline."""
    from app.persistence.models import PipelineRun as PipelineRunORM, PipelineVersion as PipelineVersionORM
    
    # Get pipeline version IDs for this pipeline
    version_ids = db.query(PipelineVersionORM.id).filter(
        PipelineVersionORM.pipeline_id == uuid.UUID(pipeline_id)
    ).all()
    
    if not version_ids:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    
    version_ids = [v[0] for v in version_ids]
    
    total = db.query(PipelineRunORM).filter(
        PipelineRunORM.pipeline_version_id.in_(version_ids)
    ).count()
    
    runs_orm = db.query(PipelineRunORM).filter(
        PipelineRunORM.pipeline_version_id.in_(version_ids)
    ).order_by(PipelineRunORM.created_at.desc()).offset(skip).limit(limit).all()
    
    return {
        "runs": [
            {
                "id": str(r.id),
                "pipeline_version_id": str(r.pipeline_version_id),
                "status": r.status,
                "created_at": r.created_at.isoformat(),
                "started_at": r.started_at.isoformat() if r.started_at else None,
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
                "error": r.error,
            }
            for r in runs_orm
        ],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


# ============================================================================
# Connection Management endpoints (Phase 2)
# ============================================================================

@app.post(
    "/v1/connections",
    tags=["Connections"],
    summary="Create a new connection",
    description="Create a new connection to an external service (DB, S3, etc.).",
    response_model=dict,
)
def create_connection(
    req: ConnectionCreateRequest,
    db: Session = Depends(get_db),
) -> dict:
    """Create a new connection."""
    connection = Connection(
        id=str(uuid.uuid4()),
        type=req.type,
        name=req.name,
        config=req.config,
        created_at=datetime.now(timezone.utc),
    )
    
    repo = ConnectionRepository(db)
    created = repo.create(connection)
    
    return {
        "id": created.id,
        "type": created.type,
        "name": created.name,
        "created_at": created.created_at.isoformat(),
    }


@app.get(
    "/v1/connections",
    tags=["Connections"],
    summary="List all connections",
    description="Get paginated list of all connections (config excluded).",
    response_model=dict,
)
def list_connections(
    skip: int = 0,
    limit: int = 10,
    db: Session = Depends(get_db),
) -> dict:
    """List all connections."""
    repo = ConnectionRepository(db)
    connections = repo.list()
    
    # Paginate in memory (can be optimized with DB pagination)
    paginated = connections[skip : skip + limit]
    
    return {
        "connections": [
            {
                "id": c.id,
                "type": c.type,
                "name": c.name,
                "created_at": c.created_at.isoformat(),
            }
            for c in paginated
        ],
        "total": len(connections),
        "skip": skip,
        "limit": limit,
    }


@app.get(
    "/v1/connections/{connection_id}",
    tags=["Connections"],
    summary="Get a connection",
    description="Retrieve a single connection with its config.",
    response_model=dict,
)
def get_connection(
    connection_id: str,
    db: Session = Depends(get_db),
) -> dict:
    """Get a specific connection by ID."""
    repo = ConnectionRepository(db)
    connection = repo.get(connection_id)
    
    if not connection:
        raise HTTPException(status_code=404, detail="Connection not found")
    
    return {
        "id": connection.id,
        "type": connection.type,
        "name": connection.name,
        "config": connection.config,
        "created_at": connection.created_at.isoformat(),
    }


@app.patch(
    "/v1/connections/{connection_id}",
    tags=["Connections"],
    summary="Update a connection",
    description="Update connection type, name, or config.",
    response_model=dict,
)
def update_connection(
    connection_id: str,
    req: ConnectionUpdateRequest,
    db: Session = Depends(get_db),
) -> dict:
    """Update a connection."""
    repo = ConnectionRepository(db)
    existing = repo.get(connection_id)
    
    if not existing:
        raise HTTPException(status_code=404, detail="Connection not found")
    
    updated = Connection(
        id=existing.id,
        type=req.type if req.type is not None else existing.type,
        name=req.name if req.name is not None else existing.name,
        config=req.config if req.config is not None else existing.config,
        created_at=existing.created_at,
    )
    
    repo.update(connection_id, updated)
    
    return {
        "id": updated.id,
        "type": updated.type,
        "name": updated.name,
        "created_at": updated.created_at.isoformat(),
    }


@app.delete(
    "/v1/connections/{connection_id}",
    tags=["Connections"],
    summary="Delete a connection",
    description="Delete a connection.",
    response_model=dict,
)
def delete_connection(
    connection_id: str,
    db: Session = Depends(get_db),
) -> dict:
    """Delete a connection."""
    from app.persistence.models import Connection as ConnectionORM
    
    conn_orm = db.query(ConnectionORM).filter(
        ConnectionORM.id == uuid.UUID(connection_id)
    ).first()
    
    if not conn_orm:
        raise HTTPException(status_code=404, detail="Connection not found")
    
    db.delete(conn_orm)
    db.commit()
    
    return {"deleted": True, "connection_id": connection_id}


# ============================================================================
# Job Queue Endpoints (Async Execution)
# ============================================================================

@app.post(
    "/v1/jobs",
    tags=["Jobs"],
    summary="Submit a pipeline for async execution",
    description="Enqueue a pipeline definition for asynchronous execution. Returns immediately with a job_id.",
    response_model=JobResponse,
)
def submit_job(
    req: JobSubmitRequest,
    db: Session = Depends(get_db),
) -> JobResponse:
    """Submit a pipeline for async execution via job queue.
    
    This endpoint validates the pipeline and enqueues it for execution.
    The caller should poll GET /v1/jobs/{job_id} to check status.
    
    Args:
        req: Job submission request with display_name and pipeline_definition
        db: Database session
        
    Returns:
        Job with status="queued" and job_id to use for polling
        
    Raises:
        HTTPException(422): If pipeline validation fails before enqueueing
    """
    from app.persistence.repositories.jobs import JobRepository
    from app.queue import get_job_queue
    from app.domain.models import Job, JobStatus
    
    # Parse and validate pipeline definition
    pipeline_definition = PipelineDefinition.model_validate(req.pipeline_definition)
    
    # Quick validation to catch obvious errors
    validation_issues = validate_pipeline(pipeline_definition)
    if validation_issues:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "PIPELINE_VALIDATION_FAILED",
                "message": "The pipeline contains validation errors.",
                "details": [
                    {
                        "node_id": getattr(issue, "node_id", None),
                        "code": issue.code,
                        "message": issue.message,
                    }
                    for issue in validation_issues
                ],
            },
        )
    
    # Create job in database with QUEUED status
    job_id = str(uuid.uuid4())
    job = Job(
        id=job_id,
        display_name=req.display_name,
        pipeline_definition=pipeline_definition,
        status=JobStatus.QUEUED,
        created_at=datetime.now(timezone.utc),
    )
    
    repo = JobRepository(db)
    created_job = repo.create(job)
    
    # Enqueue job to Redis queue for worker pickup
    try:
        queue = get_job_queue()
        queue.enqueue(
            "worker.executor.execute_job",
            {
                "job_id": job_id,
                "pipeline_definition": pipeline_definition.model_dump(),
                "display_name": req.display_name,
            },
            job_id=job_id,
            job_timeout=14400,  # 4 hours (RQ-reserved kwarg, not passed to execute_job)
        )
    except Exception as e:
        # If enqueueing fails, update job status to FAILED
        repo.update_status(job_id, JobStatus.FAILED, error=f"Failed to enqueue job: {str(e)}")
        raise HTTPException(
            status_code=503,
            detail="Job queue unavailable. Please try again later.",
        )
    
    # Return job response
    return JobResponse(
        id=created_job.id,
        display_name=created_job.display_name,
        status=created_job.status.value,
        result=created_job.result,
        error=created_job.error,
        retry_count=created_job.retry_count,
        max_retries=created_job.max_retries,
        created_at=created_job.created_at.isoformat(),
        started_at=created_job.started_at.isoformat() if created_job.started_at else None,
        completed_at=created_job.completed_at.isoformat() if created_job.completed_at else None,
        cancelled_at=created_job.cancelled_at.isoformat() if created_job.cancelled_at else None,
    )


@app.get(
    "/v1/jobs/{job_id}",
    tags=["Jobs"],
    summary="Get job status and results",
    description="Poll for job status and retrieve results when complete.",
    response_model=JobResponse,
)
def get_job(
    job_id: str,
    db: Session = Depends(get_db),
) -> JobResponse:
    """Get the current status and results of a job.
    
    Args:
        job_id: Job UUID string
        db: Database session
        
    Returns:
        JobResponse with current status and results (if complete)
        
    Raises:
        HTTPException(404): If job not found
    """
    from app.persistence.repositories.jobs import JobRepository
    
    repo = JobRepository(db)
    job = repo.get(job_id)
    
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return JobResponse(
        id=job.id,
        display_name=job.display_name,
        status=job.status.value,
        result=job.result,
        error=job.error,
        retry_count=job.retry_count,
        max_retries=job.max_retries,
        created_at=job.created_at.isoformat(),
        started_at=job.started_at.isoformat() if job.started_at else None,
        completed_at=job.completed_at.isoformat() if job.completed_at else None,
        cancelled_at=job.cancelled_at.isoformat() if job.cancelled_at else None,
    )


@app.get(
    "/v1/jobs",
    tags=["Jobs"],
    summary="List all jobs",
    description="Get paginated list of all jobs (useful for monitoring).",
    response_model=JobListResponse,
)
def list_jobs(
    skip: int = 0,
    limit: int = 10,
    status: str | None = None,
    db: Session = Depends(get_db),
) -> JobListResponse:
    """List all jobs with optional filtering by status.
    
    Args:
        skip: Number of jobs to skip (pagination)
        limit: Maximum jobs to return
        status: Optional status filter (queued, running, succeeded, failed, cancelled)
        db: Database session
        
    Returns:
        JobListResponse with paginated list of jobs
    """
    from app.persistence.repositories.jobs import JobRepository
    from app.domain.models import JobStatus
    
    repo = JobRepository(db)
    
    if status:
        try:
            status_enum = JobStatus(status)
            jobs, total = repo.list_by_status(status_enum, skip=skip, limit=limit)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status: {status}. Must be one of: {', '.join([s.value for s in JobStatus])}",
            )
    else:
        jobs, total = repo.list_all(skip=skip, limit=limit)
    
    return JobListResponse(
        jobs=[
            JobResponse(
                id=job.id,
                display_name=job.display_name,
                status=job.status.value,
                result=job.result,
                error=job.error,
                retry_count=job.retry_count,
                max_retries=job.max_retries,
                created_at=job.created_at.isoformat(),
                started_at=job.started_at.isoformat() if job.started_at else None,
                completed_at=job.completed_at.isoformat() if job.completed_at else None,
                cancelled_at=job.cancelled_at.isoformat() if job.cancelled_at else None,
            )
            for job in jobs
        ],
        total=total,
        skip=skip,
        limit=limit,
    )


@app.delete(
    "/v1/jobs/{job_id}",
    tags=["Jobs"],
    summary="Cancel a job",
    description="Cancel a queued or running job.",
    response_model=dict,
)
def cancel_job(
    job_id: str,
    req: JobCancelRequest,
    db: Session = Depends(get_db),
) -> dict:
    """Cancel a job that is queued or running.
    
    Args:
        job_id: Job UUID string
        req: Cancellation request with optional reason
        db: Database session
        
    Returns:
        Confirmation dict with job_id and cancelled status
        
    Raises:
        HTTPException(404): If job not found
        HTTPException(400): If job is already completed
    """
    from app.persistence.repositories.jobs import JobRepository
    from app.queue import get_job_queue
    from app.domain.models import JobStatus
    
    repo = JobRepository(db)
    job = repo.get(job_id)
    
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Can only cancel queued or running jobs
    if job.status in (JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELLED):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel job with status '{job.status.value}'",
        )
    
    # Cancel in database
    repo.update_status(
        job_id,
        JobStatus.CANCELLED,
        error=req.reason,
    )
    
    # Try to cancel in Redis queue (may not be picked up yet)
    try:
        queue = get_job_queue()
        queue.enqueue_call("cancel", args=(job_id,))
    except Exception:
        # Cancellation in queue is optional - if it fails, job is just marked as cancelled in DB
        pass
    
    return {
        "job_id": job_id,
        "cancelled": True,
        "reason": req.reason,
    }


# ============================================================================
# Health check
# ============================================================================

@app.get("/health", tags=["Health"])
def health() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok"}


