"""Unit tests for job queue infrastructure."""

import pytest
from datetime import datetime, timezone
from uuid import uuid4
from unittest.mock import MagicMock, patch

from app.domain.models import Job, JobStatus, PipelineDefinition, Node, Edge
from app.persistence.repositories.jobs import JobRepository
from app.queue.client import JobQueueClient


@pytest.fixture
def sample_pipeline_definition():
    """Create a sample pipeline definition for testing."""
    return PipelineDefinition(
        schema_version=1,
        pipeline_id="test-pipeline-1",
        nodes=[
            Node(
                id="node_1",
                type="source.csv",
                config={"path": "test.csv"}
            )
        ],
        edges=[]
    )


@pytest.fixture
def sample_job(sample_pipeline_definition):
    """Create a sample job domain model."""
    return Job(
        id=str(uuid4()),
        display_name="Test Job #1",
        pipeline_definition=sample_pipeline_definition,
        status=JobStatus.QUEUED,
        created_at=datetime.now(timezone.utc),
    )


class TestJobRepository:
    """Tests for JobRepository."""

    def test_create_job(self, sample_job, db_session):
        """Test creating a job in database."""
        repo = JobRepository(db_session)
        created = repo.create(sample_job)

        assert created.id == sample_job.id
        assert created.display_name == sample_job.display_name
        assert created.status == JobStatus.QUEUED

    def test_get_job(self, sample_job, db_session):
        """Test retrieving a job by ID."""
        repo = JobRepository(db_session)
        repo.create(sample_job)

        retrieved = repo.get(sample_job.id)

        assert retrieved is not None
        assert retrieved.id == sample_job.id
        assert retrieved.display_name == sample_job.display_name

    def test_get_nonexistent_job(self, db_session):
        """Test retrieving a job that doesn't exist."""
        repo = JobRepository(db_session)
        retrieved = repo.get(str(uuid4()))

        assert retrieved is None

    def test_update_status(self, sample_job, db_session):
        """Test updating job status."""
        repo = JobRepository(db_session)
        repo.create(sample_job)

        updated = repo.update_status(
            sample_job.id,
            JobStatus.RUNNING
        )

        assert updated is not None
        assert updated.status == JobStatus.RUNNING
        assert updated.started_at is not None

    def test_update_status_with_result(self, sample_job, db_session):
        """Test updating job status with result."""
        repo = JobRepository(db_session)
        repo.create(sample_job)

        result = {"node_results": [{"rows": 100}]}
        updated = repo.update_status(
            sample_job.id,
            JobStatus.SUCCEEDED,
            result=result
        )

        assert updated is not None
        assert updated.status == JobStatus.SUCCEEDED
        assert updated.result == result
        assert updated.completed_at is not None

    def test_increment_retry_count(self, sample_job, db_session):
        """Test incrementing retry count."""
        repo = JobRepository(db_session)
        repo.create(sample_job)

        updated = repo.increment_retry_count(sample_job.id)

        assert updated is not None
        assert updated.retry_count == 1

    def test_list_all_jobs(self, sample_job, db_session):
        """Test listing all jobs."""
        repo = JobRepository(db_session)
        
        # Create multiple jobs
        for i in range(3):
            job = sample_job
            job.id = str(uuid4())
            repo.create(job)

        jobs, total = repo.list_all(skip=0, limit=10)

        assert len(jobs) == 3
        assert total == 3

    def test_list_jobs_with_pagination(self, sample_job, db_session):
        """Test listing jobs with pagination."""
        repo = JobRepository(db_session)
        
        # Create multiple jobs
        for i in range(5):
            job = sample_job
            job.id = str(uuid4())
            repo.create(job)

        jobs, total = repo.list_all(skip=0, limit=2)

        assert len(jobs) == 2
        assert total == 5

    def test_list_by_status(self, sample_job, db_session):
        """Test filtering jobs by status."""
        repo = JobRepository(db_session)
        
        # Create jobs with different statuses
        job1 = sample_job
        job1.id = str(uuid4())
        job1.status = JobStatus.QUEUED
        repo.create(job1)

        job2 = sample_job
        job2.id = str(uuid4())
        job2.status = JobStatus.RUNNING
        repo.create(job2)

        queued_jobs, queued_total = repo.list_by_status(JobStatus.QUEUED)

        assert len(queued_jobs) == 1
        assert queued_total == 1

    def test_delete_job(self, sample_job, db_session):
        """Test deleting a job."""
        repo = JobRepository(db_session)
        repo.create(sample_job)

        deleted = repo.delete(sample_job.id)
        assert deleted is True

        retrieved = repo.get(sample_job.id)
        assert retrieved is None


class TestJobQueueClient:
    """Tests for JobQueueClient (mocked)."""

    def test_enqueue_pipeline(self, sample_pipeline_definition):
        """Test enqueueing a pipeline."""
        mock_queue = MagicMock()
        mock_rq_job = MagicMock()
        mock_rq_job.id = "job_123"
        mock_queue.enqueue.return_value = mock_rq_job

        client = JobQueueClient(mock_queue)
        job_id = client.enqueue_pipeline(
            "job_123",
            sample_pipeline_definition,
            "Test Job"
        )

        assert job_id == "job_123"
        mock_queue.enqueue.assert_called_once()

    def test_get_job_status(self):
        """Test getting job status."""
        mock_queue = MagicMock()
        mock_rq_job = MagicMock()
        mock_rq_job.get_status.return_value = "started"
        mock_queue.fetch_job.return_value = mock_rq_job

        client = JobQueueClient(mock_queue)
        status = client.get_job_status("job_123")

        assert status == JobStatus.RUNNING

    def test_get_job_result(self):
        """Test getting job result."""
        mock_queue = MagicMock()
        mock_rq_job = MagicMock()
        mock_rq_job.is_finished = True
        mock_rq_job.result = {"rows": 100}
        mock_queue.fetch_job.return_value = mock_rq_job

        client = JobQueueClient(mock_queue)
        result = client.get_job_result("job_123")

        assert result == {"rows": 100}

    def test_cancel_job(self):
        """Test cancelling a job."""
        mock_queue = MagicMock()
        mock_rq_job = MagicMock()
        mock_rq_job.is_finished = False
        mock_rq_job.is_failed = False
        mock_queue.fetch_job.return_value = mock_rq_job

        client = JobQueueClient(mock_queue)
        cancelled = client.cancel_job("job_123", "User cancelled")

        assert cancelled is True
        mock_rq_job.cancel.assert_called_once()

    def test_get_queue_depth(self):
        """Test getting queue depth."""
        mock_queue = MagicMock()
        mock_queue.__len__.return_value = 5

        client = JobQueueClient(mock_queue)
        depth = client.get_queue_depth()

        assert depth == 5

    def test_get_failed_jobs_count(self):
        """Test getting failed jobs count."""
        mock_queue = MagicMock()
        mock_queue.failed_job_registry = MagicMock()
        mock_queue.failed_job_registry.__len__.return_value = 2

        client = JobQueueClient(mock_queue)
        count = client.get_failed_jobs_count()

        assert count == 2
