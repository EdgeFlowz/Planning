"""Job queue abstraction using RQ (Redis Queue)."""

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from rq import Queue

from app.domain.models import Job, JobStatus as DomainJobStatus, PipelineDefinition


class JobQueueClient:
    """Interface to the job queue (RQ backed by Redis).
    
    This abstraction allows us to switch queue implementations without
    changing the rest of the application.
    """

    def __init__(self, queue: Queue):
        self.queue = queue

    def enqueue_pipeline(
        self,
        job_id: str,
        pipeline_definition: PipelineDefinition,
        display_name: str,
    ) -> str:
        """Enqueue a pipeline for async execution.
        
        Args:
            job_id: Unique job identifier (UUID string)
            pipeline_definition: The pipeline to execute
            display_name: User-friendly name for the job
            
        Returns:
            Job ID on the queue
        """
        # Store job metadata that the worker will use
        job_data = {
            "job_id": job_id,
            "pipeline_definition": pipeline_definition.model_dump(),
            "display_name": display_name,
        }

        # Enqueue the job with the executor function
        # The worker will pull from this queue and execute
        # Note: Only pass job_data as positional arg to the function
        # RQ parameters (job_id, timeout) are passed separately and not to the function
        rq_job = self.queue.enqueue(
            "worker.executor.execute_job",
            job_data,
            job_id=job_id,
            job_timeout=14400,  # 4 hours in seconds (RQ parameter, not passed to function)
        )

        return rq_job.id

    def get_job_status(self, job_id: str) -> str:
        """Get current status of a job.
        
        Args:
            job_id: Job identifier
            
        Returns:
            Status string: queued, running, succeeded, failed, etc.
        """
        rq_job = self.queue.fetch_job(job_id)

        if rq_job is None:
            return DomainJobStatus.FAILED

        # Map RQ job status to our domain status
        rq_status = rq_job.get_status()
        
        status_map = {
            "queued": DomainJobStatus.QUEUED,
            "started": DomainJobStatus.RUNNING,
            "deferred": DomainJobStatus.QUEUED,
            "finished": DomainJobStatus.SUCCEEDED,
            "failed": DomainJobStatus.FAILED,
            "stopped": DomainJobStatus.CANCELLED,
            "scheduled": DomainJobStatus.QUEUED,
            "canceled": DomainJobStatus.CANCELLED,
        }

        return status_map.get(rq_status, DomainJobStatus.FAILED)

    def get_job_result(self, job_id: str) -> dict | None:
        """Get job result if completed successfully.
        
        Args:
            job_id: Job identifier
            
        Returns:
            Result dict if succeeded, None otherwise
        """
        rq_job = self.queue.fetch_job(job_id)

        if rq_job is None:
            return None

        if rq_job.is_finished:
            return rq_job.result

        return None

    def get_job_error(self, job_id: str) -> str | None:
        """Get job error message if failed.
        
        Args:
            job_id: Job identifier
            
        Returns:
            Error message if failed, None otherwise
        """
        rq_job = self.queue.fetch_job(job_id)

        if rq_job is None:
            return None

        if rq_job.is_failed:
            return str(rq_job.exc_info)

        return None

    def cancel_job(self, job_id: str, reason: str = "Cancelled by user") -> bool:
        """Cancel a job.
        
        Args:
            job_id: Job identifier
            reason: Reason for cancellation
            
        Returns:
            True if cancelled, False if not found or already completed
        """
        rq_job = self.queue.fetch_job(job_id)

        if rq_job is None:
            return False

        if rq_job.is_finished or rq_job.is_failed:
            return False

        # Store cancellation reason in job metadata
        rq_job.meta["cancelled_reason"] = reason
        rq_job.meta["cancelled_at"] = datetime.now(timezone.utc).isoformat()
        rq_job.save()

        # Cancel the job
        rq_job.cancel()

        return True

    def get_queue_depth(self) -> int:
        """Get number of jobs waiting in queue."""
        return len(self.queue)

    def get_failed_jobs_count(self) -> int:
        """Get number of failed jobs."""
        return len(self.queue.failed_job_registry)

    def get_completed_jobs_count(self) -> int:
        """Get number of completed jobs."""
        return len(self.queue.finished_job_registry)
