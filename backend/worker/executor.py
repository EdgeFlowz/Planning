"""Job execution logic for the background worker."""

import logging
import time
import traceback
from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.domain.models import (
    JobStatus,
    NodeRun as NodeRunDomain,
    NodeRunStatus,
    PipelineDefinition,
    PipelineRun as PipelineRunDomain,
    PipelineRunStatus,
)
from app.execution.executor import execute_pipeline
from app.domain.validator import validate_pipeline, PipelineValidationError
from app.persistence.repositories.jobs import JobRepository
from app.persistence.repositories.runs import NodeRunRepository, PipelineRunRepository
from app.persistence.models import Pipeline as PipelineORM, PipelineVersion as PipelineVersionORM
from worker.config import worker_settings

# Configure logging
logging.basicConfig(level=worker_settings.log_level)
logger = logging.getLogger(__name__)


# Database session factory
engine = create_engine(worker_settings.database_url, echo=False)
SessionLocal = sessionmaker(bind=engine)

# Cap on exponential backoff between retry attempts, in seconds.
MAX_RETRY_BACKOFF_SECONDS = 30


def execute_job(job_data: dict) -> dict:
    """Execute a pipeline job with error handling and retry logic.

    This function is called by RQ (Redis Queue) when a job is picked up
    by the worker. Retries are handled in-process (a single RQ invocation
    loops through all attempts) rather than relying on RQ to re-invoke this
    function, since no RQ `Retry` policy is configured at enqueue time —
    re-raising without one just fails the RQ job without another attempt,
    leaving the database status stuck at RUNNING forever.

    Args:
        job_data: Dictionary containing:
            - job_id: UUID string
            - pipeline_definition: dict (raw pipeline JSON)
            - display_name: str (user-friendly name)

    Returns:
        dict with execution results:
            - job_id: str
            - status: "succeeded" or "failed" or "cancelled"
            - result: dict (if succeeded) or None
            - error: str (if failed) or None
    """
    job_id = job_data["job_id"]
    display_name = job_data["display_name"]
    pipeline_dict = job_data["pipeline_definition"]

    logger.info(f"[{job_id}] Starting execution of '{display_name}'")

    db = SessionLocal()
    try:
        repo = JobRepository(db)
        pipeline_runs = PipelineRunRepository(db)
        node_runs = NodeRunRepository(db)
        job = repo.get(job_id)
        max_retries = job.max_retries if job else 3

        attempt = 0
        while True:
            if job and job.status == JobStatus.CANCELLED:
                logger.info(f"[{job_id}] Job was cancelled, stopping before attempt {attempt + 1}")
                _finish_persisted_run(
                    pipeline_runs,
                    node_runs,
                    job_id,
                    PipelineRunStatus.CANCELLED,
                    NodeRunStatus.CANCELLED,
                    job.error or "Cancelled by user",
                )
                return {"job_id": job_id, "status": "cancelled", "error": job.error}

            try:
                return _run_pipeline_once(
                    repo, pipeline_runs, node_runs, db, job_id, display_name, pipeline_dict
                )

            except PipelineValidationError as exc:
                # Should not happen after pre-validation at submission time, but not retryable.
                error_msg = f"Pipeline validation error: {str(exc)}"
                logger.error(f"[{job_id}] {error_msg}")
                repo.update_status(job_id, JobStatus.FAILED, error=error_msg)
                _finish_persisted_run(
                    pipeline_runs,
                    node_runs,
                    job_id,
                    PipelineRunStatus.FAILED,
                    NodeRunStatus.FAILED,
                    error_msg,
                )
                return {"job_id": job_id, "status": "failed", "error": error_msg}

            except Exception as exc:
                error_msg = f"{type(exc).__name__}: {str(exc)}\n{traceback.format_exc()}"
                logger.error(f"[{job_id}] Execution failed: {error_msg}")

                if attempt < max_retries:
                    repo.increment_retry_count(job_id)
                    persisted_run = pipeline_runs.get_by_job_id(job_id)
                    if persisted_run is not None:
                        node_runs.reset_for_retry(persisted_run.id)
                    backoff = min(2**attempt, MAX_RETRY_BACKOFF_SECONDS)
                    attempt += 1
                    logger.info(
                        f"[{job_id}] Retrying in {backoff}s (attempt {attempt + 1}/{max_retries + 1})"
                    )
                    time.sleep(backoff)
                    job = repo.get(job_id)
                    continue

                logger.error(f"[{job_id}] Max retries exhausted")
                repo.update_status(job_id, JobStatus.FAILED, error=error_msg)
                _finish_persisted_run(
                    pipeline_runs,
                    node_runs,
                    job_id,
                    PipelineRunStatus.FAILED,
                    NodeRunStatus.FAILED,
                    error_msg,
                )
                return {"job_id": job_id, "status": "failed", "error": error_msg}

    finally:
        db.close()


def _run_pipeline_once(
    repo: JobRepository,
    pipeline_runs: PipelineRunRepository,
    node_runs: NodeRunRepository,
    db: Session,
    job_id: str,
    display_name: str,
    pipeline_dict: dict,
) -> dict:
    """Run a single execution attempt. Raises on failure; caller handles retries."""
    logger.info(f"[{job_id}] Updating status to RUNNING")
    repo.update_status(job_id, JobStatus.RUNNING)

    logger.info(f"[{job_id}] Parsing pipeline definition")
    pipeline_definition = PipelineDefinition.model_validate(pipeline_dict)

    run_id = _ensure_pipeline_run(
        db, pipeline_runs, node_runs, job_id, display_name, pipeline_definition
    )

    logger.info(f"[{job_id}] Validating pipeline")
    validation_issues = validate_pipeline(pipeline_definition)
    if validation_issues:
        error_msg = "Pipeline validation failed:\n" + "\n".join(
            f"  - {issue.message} (node: {getattr(issue, 'node_id', 'unknown')})"
            for issue in validation_issues
        )
        logger.error(f"[{job_id}] {error_msg}")
        repo.update_status(job_id, JobStatus.FAILED, error=error_msg)
        pipeline_runs.update_status(
            run_id,
            PipelineRunStatus.FAILED,
            completed_at=datetime.now(timezone.utc),
            error=error_msg,
        )
        node_runs.finish_unfinished(run_id, NodeRunStatus.FAILED, error_msg)
        return {"job_id": job_id, "status": "failed", "error": error_msg}

    logger.info(f"[{job_id}] Executing pipeline")
    try:
        outputs = execute_pipeline(pipeline_definition)

        logger.info(f"[{job_id}] Processing execution results")
        node_types = {node.id: node.type for node in pipeline_definition.nodes}
        node_run_ids = {
            run.node_id: run.id for run in node_runs.list_by_pipeline_run(run_id)
        }
        node_results = []
        node_started_at: dict[str, datetime] = {}
        aggregate_rows: dict[str, int] = {}
        aggregate_columns: dict[str, list[str]] = {}

        for key, lazy_frame in outputs.items():
            node_id, _, port = key.partition(":")
            started_at = node_started_at.setdefault(node_id, datetime.now(timezone.utc))
            node_run_id = node_run_ids[node_id]
            node_runs.update_status(
                node_run_id,
                NodeRunStatus.RUNNING,
                started_at=started_at,
            )
            try:
                frame = lazy_frame.collect()
            except Exception as exc:
                node_runs.update_status(
                    node_run_id,
                    NodeRunStatus.FAILED,
                    started_at=started_at,
                    completed_at=datetime.now(timezone.utc),
                    error=str(exc),
                )
                raise
            aggregate_rows[node_id] = aggregate_rows.get(node_id, 0) + frame.height
            columns = aggregate_columns.setdefault(node_id, [])
            columns.extend(column for column in frame.columns if column not in columns)
            node_runs.update_status(
                node_run_ids[node_id],
                NodeRunStatus.SUCCEEDED,
                started_at=started_at,
                completed_at=datetime.now(timezone.utc),
                rows_written=aggregate_rows[node_id],
                columns=aggregate_columns[node_id],
            )
            node_results.append(
                {
                    "node_id": node_id,
                    "node_type": node_types.get(node_id, "unknown"),
                    "port": port or "output",
                    "rows": frame.height,
                    "columns": frame.columns,
                }
            )
    except Exception as exc:
        node_runs.finish_unfinished(run_id, NodeRunStatus.FAILED, str(exc))
        raise

    latest_job = repo.get(job_id)
    if latest_job and latest_job.status == JobStatus.CANCELLED:
        pipeline_runs.update_status(
            run_id,
            PipelineRunStatus.CANCELLED,
            completed_at=datetime.now(timezone.utc),
            error=latest_job.error,
        )
        node_runs.finish_unfinished(
            run_id, NodeRunStatus.CANCELLED, latest_job.error or "Cancelled by user"
        )
        return {"job_id": job_id, "status": "cancelled", "error": latest_job.error}

    result = {
        "pipeline_definition_id": pipeline_definition.pipeline_id,
        "node_results": node_results,
        "execution_time_seconds": 0,  # TODO: track actual execution time
    }

    logger.info(f"[{job_id}] Execution completed successfully")
    pipeline_runs.update_status(
        run_id,
        PipelineRunStatus.SUCCEEDED,
        completed_at=datetime.now(timezone.utc),
    )
    repo.update_status(job_id, JobStatus.SUCCEEDED, result=result)

    return {"job_id": job_id, "status": "succeeded", "result": result}


def _ensure_pipeline_run(
    db: Session,
    pipeline_runs: PipelineRunRepository,
    node_runs: NodeRunRepository,
    job_id: str,
    display_name: str,
    pipeline_definition: PipelineDefinition,
) -> str:
    """Create one run snapshot and node records for this job, or reuse them on retry."""
    existing = pipeline_runs.get_by_job_id(job_id)
    if existing is not None:
        existing_node_ids = {
            node_run.node_id for node_run in node_runs.list_by_pipeline_run(existing.id)
        }
        for node in pipeline_definition.nodes:
            if node.id in existing_node_ids:
                continue
            node_runs.create(
                NodeRunDomain(
                    id=str(uuid4()),
                    pipeline_run_id=existing.id,
                    node_id=node.id,
                    node_type=node.type,
                    status=NodeRunStatus.QUEUED,
                )
            )
        return existing.id

    now = datetime.now(timezone.utc)
    definition_data = pipeline_definition.model_dump(mode="json")
    pipeline_orm = None
    try:
        candidate_id = UUID(pipeline_definition.pipeline_id)
    except ValueError:
        candidate_id = None

    if candidate_id is not None:
        pipeline_orm = db.get(PipelineORM, candidate_id)

    if pipeline_orm is None:
        pipeline_orm = PipelineORM(
            id=candidate_id or uuid4(),
            name=display_name,
            created_at=now,
            updated_at=now,
        )
        db.add(pipeline_orm)
        db.flush()

    versions = (
        db.query(PipelineVersionORM)
        .filter(PipelineVersionORM.pipeline_id == pipeline_orm.id)
        .order_by(PipelineVersionORM.version.desc())
        .all()
    )
    version = next((item for item in versions if item.definition == definition_data), None)
    if version is None:
        version = PipelineVersionORM(
            id=uuid4(),
            pipeline_id=pipeline_orm.id,
            version=(versions[0].version + 1) if versions else 1,
            definition=definition_data,
            created_at=now,
        )
        db.add(version)
        db.flush()

    run_id = str(uuid4())
    pipeline_runs.create(
        PipelineRunDomain(
            id=run_id,
            pipeline_id=str(pipeline_orm.id),
            pipeline_version=version.version,
            job_id=job_id,
            status=PipelineRunStatus.RUNNING,
            created_at=now,
            started_at=now,
        )
    )
    for node in pipeline_definition.nodes:
        node_runs.create(
            NodeRunDomain(
                id=str(uuid4()),
                pipeline_run_id=run_id,
                node_id=node.id,
                node_type=node.type,
                status=NodeRunStatus.QUEUED,
            )
        )
    return run_id


def _finish_persisted_run(
    pipeline_runs: PipelineRunRepository,
    node_runs: NodeRunRepository,
    job_id: str,
    run_status: PipelineRunStatus,
    node_status: NodeRunStatus,
    error: str | None,
) -> None:
    run = pipeline_runs.get_by_job_id(job_id)
    if run is None:
        return
    pipeline_runs.update_status(
        run.id,
        run_status,
        completed_at=datetime.now(timezone.utc),
        error=error,
    )
    node_runs.finish_unfinished(run.id, node_status, error)



def log_job_progress(job_id: str, message: str) -> None:
    """Log job progress to database and console.

    This can be called from within execute_job to provide
    real-time feedback about execution progress.

    Args:
        job_id: Job UUID string
        message: Progress message
    """
    logger.info(f"[{job_id}] {message}")
