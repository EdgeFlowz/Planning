"""Repository for job persistence in database."""

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.models import Job as JobDomain, JobStatus, PipelineDefinition
from app.persistence.models import Job as JobORM


class JobRepository:
    """Repository for Job entity persistence."""

    def __init__(self, session: Session):
        self.session = session

    def create(self, job: JobDomain) -> JobDomain:
        """Create a new job in the database.
        
        Args:
            job: Job domain model
            
        Returns:
            Created job
        """
        job_orm = JobORM(
            id=UUID(job.id),
            display_name=job.display_name,
            pipeline_definition=job.pipeline_definition.model_dump(),
            status=job.status.value,
            result=job.result,
            error=job.error,
            retry_count=job.retry_count,
            max_retries=job.max_retries,
            created_at=job.created_at,
            started_at=job.started_at,
            completed_at=job.completed_at,
            cancelled_at=job.cancelled_at,
        )

        self.session.add(job_orm)
        self.session.commit()
        self.session.refresh(job_orm)

        return self._orm_to_domain(job_orm)

    def get(self, job_id: str) -> JobDomain | None:
        """Get a job by ID.
        
        Args:
            job_id: Job UUID string
            
        Returns:
            Job if found, None otherwise
        """
        statement = select(JobORM).where(
            JobORM.id == UUID(job_id)
        )

        job_orm = self.session.scalar(statement)

        if job_orm is None:
            return None

        return self._orm_to_domain(job_orm)

    def update_status(
        self,
        job_id: str,
        status: JobStatus,
        result: dict | None = None,
        error: str | None = None,
    ) -> JobDomain | None:
        """Update job status and optionally result or error.
        
        Args:
            job_id: Job UUID string
            status: New status
            result: Execution result (if succeeded)
            error: Error message (if failed)
            
        Returns:
            Updated job if found, None otherwise
        """
        job_orm = self.session.query(JobORM).filter(
            JobORM.id == UUID(job_id)
        ).first()

        if job_orm is None:
            return None

        job_orm.status = status.value

        if status == JobStatus.RUNNING and job_orm.started_at is None:
            job_orm.started_at = datetime.now(timezone.utc)

        if status in (JobStatus.SUCCEEDED, JobStatus.FAILED):
            job_orm.completed_at = datetime.now(timezone.utc)

        if status == JobStatus.CANCELLED:
            job_orm.cancelled_at = datetime.now(timezone.utc)

        if result is not None:
            job_orm.result = result

        if error is not None:
            job_orm.error = error

        self.session.commit()
        self.session.refresh(job_orm)

        return self._orm_to_domain(job_orm)

    def increment_retry_count(self, job_id: str) -> JobDomain | None:
        """Increment retry count for a job.
        
        Args:
            job_id: Job UUID string
            
        Returns:
            Updated job if found, None otherwise
        """
        job_orm = self.session.query(JobORM).filter(
            JobORM.id == UUID(job_id)
        ).first()

        if job_orm is None:
            return None

        job_orm.retry_count += 1
        self.session.commit()
        self.session.refresh(job_orm)

        return self._orm_to_domain(job_orm)

    def list_all(self, skip: int = 0, limit: int = 10) -> tuple[list[JobDomain], int]:
        """List all jobs with pagination.
        
        Args:
            skip: Number of jobs to skip
            limit: Maximum number of jobs to return
            
        Returns:
            Tuple of (jobs list, total count)
        """
        total = self.session.query(JobORM).count()

        jobs_orm = self.session.query(JobORM).order_by(
            JobORM.created_at.desc()
        ).offset(skip).limit(limit).all()

        jobs = [self._orm_to_domain(job_orm) for job_orm in jobs_orm]

        return jobs, total

    def list_by_status(
        self,
        status: JobStatus,
        skip: int = 0,
        limit: int = 10,
    ) -> tuple[list[JobDomain], int]:
        """List jobs filtered by status.
        
        Args:
            status: Job status to filter by
            skip: Number of jobs to skip
            limit: Maximum number of jobs to return
            
        Returns:
            Tuple of (jobs list, total count)
        """
        total = self.session.query(JobORM).filter(
            JobORM.status == status.value
        ).count()

        jobs_orm = self.session.query(JobORM).filter(
            JobORM.status == status.value
        ).order_by(
            JobORM.created_at.desc()
        ).offset(skip).limit(limit).all()

        jobs = [self._orm_to_domain(job_orm) for job_orm in jobs_orm]

        return jobs, total

    def delete(self, job_id: str) -> bool:
        """Delete a job (for cleanup of old completed jobs).
        
        Args:
            job_id: Job UUID string
            
        Returns:
            True if deleted, False if not found
        """
        job_orm = self.session.query(JobORM).filter(
            JobORM.id == UUID(job_id)
        ).first()

        if job_orm is None:
            return False

        self.session.delete(job_orm)
        self.session.commit()

        return True

    @staticmethod
    def _orm_to_domain(job_orm: JobORM) -> JobDomain:
        """Convert ORM model to domain model."""
        return JobDomain(
            id=str(job_orm.id),
            display_name=job_orm.display_name,
            pipeline_definition=PipelineDefinition.model_validate(
                job_orm.pipeline_definition
            ),
            status=JobStatus(job_orm.status),
            result=job_orm.result,
            error=job_orm.error,
            retry_count=job_orm.retry_count,
            max_retries=job_orm.max_retries,
            created_at=job_orm.created_at,
            started_at=job_orm.started_at,
            completed_at=job_orm.completed_at,
            cancelled_at=job_orm.cancelled_at,
        )
