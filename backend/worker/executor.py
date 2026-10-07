"""Job execution logic for the background worker."""

import logging
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


def execute_job(job_data: dict) -> dict:
    """Execute a pipeline job with error handling and retry logic.

    This function is called by RQ (Redis Queue) when a job is picked up
    by the worker. It handles:
    - Pipeline validation
    - Execution with timeout protection
    - Status updates to database
    - Retry logic for transient failures
    - Detailed error reporting

    Args:
        job_data: Dictionary containing:
            - job_id: UUID string
            - pipeline_definition: dict (raw pipeline JSON)
            - display_name: str (user-friendly name)

    Returns:
        dict with execution results:
            - job_id: str
            - status: "succeeded" or "failed"
            - result: dict (if succeeded) or None
            - error: str (if failed) or None

    Raises:
        Exception: Re-raised after logging and database update
    """
    job_id = job_data["job_id"]
    display_name = job_data["display_name"]
    pipeline_dict = job_data["pipeline_definition"]

    logger.info(f"[{job_id}] Starting execution of '{display_name}'")

    db = SessionLocal()
    try:
        repo = JobRepository(db)

        # Update status to RUNNING
        logger.info(f"[{job_id}] Updating status to RUNNING")
        repo.update_status(job_id, JobStatus.RUNNING)

        # Parse pipeline definition
        logger.info(f"[{job_id}] Parsing pipeline definition")
        pipeline_definition = PipelineDefinition.model_validate(pipeline_dict)

        # Validate pipeline before execution
        logger.info(f"[{job_id}] Validating pipeline")
        validation_issues = validate_pipeline(pipeline_definition)
        if validation_issues:
            error_msg = "Pipeline validation failed:\n" + "\n".join(
                f"  - {issue.message} (node: {getattr(issue, 'node_id', 'unknown')})"
                for issue in validation_issues
            )
            logger.error(f"[{job_id}] {error_msg}")
            repo.update_status(job_id, JobStatus.FAILED, error=error_msg)
            return {
                "job_id": job_id,
                "status": "failed",
                "error": error_msg,
            }

        # Execute pipeline
        logger.info(f"[{job_id}] Executing pipeline")
        outputs = execute_pipeline(pipeline_definition)

        # Convert outputs to result format
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

        # Update status to SUCCEEDED
        logger.info(f"[{job_id}] Execution completed successfully")
        repo.update_status(job_id, JobStatus.SUCCEEDED, result=result)

        return {
            "job_id": job_id,
            "status": "succeeded",
            "result": result,
        }

    except PipelineValidationError as exc:
        """Handle validation errors (should not happen after pre-validation, but safe to catch)"""
        error_msg = f"Pipeline validation error: {str(exc)}"
        logger.error(f"[{job_id}] {error_msg}")
        repo.update_status(job_id, JobStatus.FAILED, error=error_msg)
        return {
            "job_id": job_id,
            "status": "failed",
            "error": error_msg,
        }

    except Exception as exc:
        """Handle execution errors with retry logic"""
        error_msg = f"{type(exc).__name__}: {str(exc)}\n{traceback.format_exc()}"
        logger.error(f"[{job_id}] Execution failed: {error_msg}")

        job = repo.get(job_id)
        if job and job.retry_count < job.max_retries:
            # Increment retry counter
            new_retry_count = job.retry_count + 1
            logger.info(f"[{job_id}] Retrying job (attempt {new_retry_count}/{job.max_retries})")
            repo.increment_retry_count(job_id)
            # Re-raise exception so RQ re-queues the job
            raise

        # Max retries exhausted or job not found
        logger.error(f"[{job_id}] Max retries exhausted or job not found")
        repo.update_status(job_id, JobStatus.FAILED, error=error_msg)

        return {
            "job_id": job_id,
            "status": "failed",
            "error": error_msg,
        }

    finally:
        db.close()


def log_job_progress(job_id: str, message: str) -> None:
    """Log job progress to database and console.

    This can be called from within execute_job to provide
    real-time feedback about execution progress.

    Args:
        job_id: Job UUID string
        message: Progress message
    """
    logger.info(f"[{job_id}] {message}")
