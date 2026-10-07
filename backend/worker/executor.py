"""Job execution logic for the background worker."""

import logging
import time
import traceback
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.domain.models import PipelineDefinition, JobStatus
from app.execution.executor import execute_pipeline
from app.domain.validator import validate_pipeline, PipelineValidationError
from app.persistence.repositories.jobs import JobRepository
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
        job = repo.get(job_id)
        max_retries = job.max_retries if job else 3

        attempt = 0
        while True:
            if job and job.status == JobStatus.CANCELLED:
                logger.info(f"[{job_id}] Job was cancelled, stopping before attempt {attempt + 1}")
                return {"job_id": job_id, "status": "cancelled", "error": job.error}

            try:
                return _run_pipeline_once(repo, job_id, pipeline_dict)

            except PipelineValidationError as exc:
                # Should not happen after pre-validation at submission time, but not retryable.
                error_msg = f"Pipeline validation error: {str(exc)}"
                logger.error(f"[{job_id}] {error_msg}")
                repo.update_status(job_id, JobStatus.FAILED, error=error_msg)
                return {"job_id": job_id, "status": "failed", "error": error_msg}

            except Exception as exc:
                error_msg = f"{type(exc).__name__}: {str(exc)}\n{traceback.format_exc()}"
                logger.error(f"[{job_id}] Execution failed: {error_msg}")

                if attempt < max_retries:
                    repo.increment_retry_count(job_id)
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
                return {"job_id": job_id, "status": "failed", "error": error_msg}

    finally:
        db.close()


def _run_pipeline_once(repo: JobRepository, job_id: str, pipeline_dict: dict) -> dict:
    """Run a single execution attempt. Raises on failure; caller handles retries."""
    logger.info(f"[{job_id}] Updating status to RUNNING")
    repo.update_status(job_id, JobStatus.RUNNING)

    logger.info(f"[{job_id}] Parsing pipeline definition")
    pipeline_definition = PipelineDefinition.model_validate(pipeline_dict)

    logger.info(f"[{job_id}] Validating pipeline")
    validation_issues = validate_pipeline(pipeline_definition)
    if validation_issues:
        error_msg = "Pipeline validation failed:\n" + "\n".join(
            f"  - {issue.message} (node: {getattr(issue, 'node_id', 'unknown')})"
            for issue in validation_issues
        )
        logger.error(f"[{job_id}] {error_msg}")
        repo.update_status(job_id, JobStatus.FAILED, error=error_msg)
        return {"job_id": job_id, "status": "failed", "error": error_msg}

    logger.info(f"[{job_id}] Executing pipeline")
    outputs = execute_pipeline(pipeline_definition)

    logger.info(f"[{job_id}] Processing execution results")
    node_types = {node.id: node.type for node in pipeline_definition.nodes}
    node_results = []

    for key, lazy_frame in outputs.items():
        node_id, _, port = key.partition(":")
        frame = lazy_frame.collect()
        node_results.append(
            {
                "node_id": node_id,
                "node_type": node_types.get(node_id, "unknown"),
                "port": port or "output",
                "rows": frame.height,
                "columns": frame.columns,
            }
        )

    result = {
        "pipeline_definition_id": pipeline_definition.pipeline_id,
        "node_results": node_results,
        "execution_time_seconds": 0,  # TODO: track actual execution time
    }

    logger.info(f"[{job_id}] Execution completed successfully")
    repo.update_status(job_id, JobStatus.SUCCEEDED, result=result)

    return {"job_id": job_id, "status": "succeeded", "result": result}



def log_job_progress(job_id: str, message: str) -> None:
    """Log job progress to database and console.

    This can be called from within execute_job to provide
    real-time feedback about execution progress.

    Args:
        job_id: Job UUID string
        message: Progress message
    """
    logger.info(f"[{job_id}] {message}")
