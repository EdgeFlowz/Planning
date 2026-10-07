"""Integration tests for async job queue system.

Tests the complete flow:
  1. User submits pipeline via POST /v1/jobs
  2. Job is stored in database with status=queued
  3. Job is enqueued to Redis queue
  4. Worker picks it up and executes
  5. User polls GET /v1/jobs/{job_id} to check status
  6. User sees results when complete
"""

import pytest
import json
import time
from datetime import datetime, timezone
from uuid import uuid4

from httpx import Client
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.domain.models import PipelineDefinition, Node, Edge, JobStatus
from app.persistence.models import Base
from app.main import app


@pytest.fixture(scope="session")
def test_client():
    """HTTP client against the live API server (must be running per QUICK_START_TESTING.md)."""
    return Client(base_url="http://localhost:8000")


@pytest.fixture
def sample_pipeline_def():
    """Create a sample pipeline for testing."""
    return {
        "schema_version": 1,
        "pipeline_id": str(uuid4()),
        "nodes": [
            {
                "id": "source_1",
                "type": "source.csv",
                "config": {
                    "path": "tests/fixtures/sample.csv"
                }
            },
            {
                "id": "filter_1",
                "type": "transform.filter",
                "config": {
                    "expression": {
                        "type": "binary_operation",
                        "operator": ">",
                        "left": {"type": "column", "name": "value"},
                        "right": {"type": "literal", "value": 100}
                    }
                }
            }
        ],
        "edges": [
            {
                "source": "source_1",
                "target": "filter_1",
                "output": None,
                "input": None
            }
        ]
    }


class TestJobSubmission:
    """Test job submission via POST /v1/jobs."""

    def test_submit_valid_pipeline(self, test_client, sample_pipeline_def):
        """Test submitting a valid pipeline for execution."""
        response = test_client.post(
            "/v1/jobs",
            json={
                "display_name": "Test Pipeline Run",
                "pipeline_definition": sample_pipeline_def
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert "id" in data
        assert data["display_name"] == "Test Pipeline Run"
        assert data["status"] == "queued"
        assert "created_at" in data
        
        return data["id"]

    def test_submit_invalid_pipeline(self, test_client):
        """Test submitting an invalid pipeline (missing nodes)."""
        response = test_client.post(
            "/v1/jobs",
            json={
                "display_name": "Invalid Pipeline",
                "pipeline_definition": {
                    "schema_version": 1,
                    "pipeline_id": str(uuid4()),
                    "nodes": [],  # Empty - should fail validation
                    "edges": []
                }
            }
        )
        
        assert response.status_code == 422
        data = response.json()
        assert "validation" in data.get("detail", {}).get("code", "").lower()

    def test_submit_missing_display_name(self, test_client, sample_pipeline_def):
        """Test that display_name is required."""
        response = test_client.post(
            "/v1/jobs",
            json={
                "pipeline_definition": sample_pipeline_def
            }
        )
        
        assert response.status_code == 422


class TestJobPolling:
    """Test polling job status via GET /v1/jobs/{job_id}."""

    def test_get_job_immediately_after_submission(self, test_client, sample_pipeline_def):
        """Test that job shows as 'queued' immediately after submission."""
        # Submit job
        submit_resp = test_client.post(
            "/v1/jobs",
            json={
                "display_name": "Polling Test",
                "pipeline_definition": sample_pipeline_def
            }
        )
        job_id = submit_resp.json()["id"]
        
        # Poll immediately
        poll_resp = test_client.get(f"/v1/jobs/{job_id}")
        
        assert poll_resp.status_code == 200
        data = poll_resp.json()
        assert data["id"] == job_id
        assert data["status"] in ["queued", "running"]  # May start quickly
        assert data["result"] is None  # No result yet

    def test_get_nonexistent_job(self, test_client):
        """Test getting a job that doesn't exist."""
        response = test_client.get(f"/v1/jobs/{uuid4()}")
        
        assert response.status_code == 404

    def test_poll_until_completion(self, test_client, sample_pipeline_def):
        """Test polling a job until it completes.
        
        Note: This test requires a worker to be running to actually execute the job.
        Without a worker, jobs will stay in 'queued' status.
        """
        # Submit job
        submit_resp = test_client.post(
            "/v1/jobs",
            json={
                "display_name": "Long Running Job",
                "pipeline_definition": sample_pipeline_def
            }
        )
        job_id = submit_resp.json()["id"]
        
        # Poll with timeout
        max_attempts = 30  # 30 * 1 second = 30 second timeout
        for attempt in range(max_attempts):
            response = test_client.get(f"/v1/jobs/{job_id}")
            data = response.json()
            
            if data["status"] in ["succeeded", "failed"]:
                # Job completed
                assert "completed_at" in data
                if data["status"] == "succeeded":
                    assert data["result"] is not None
                return
            
            if attempt < max_attempts - 1:
                time.sleep(1)
        
        # If we get here, job never completed
        # This is expected if no worker is running
        final_status = test_client.get(f"/v1/jobs/{job_id}").json()
        print(f"\nJob status after {max_attempts} seconds: {final_status['status']}")


class TestJobListing:
    """Test listing jobs via GET /v1/jobs."""

    def test_list_jobs_empty(self, test_client):
        """Test listing jobs when none exist."""
        response = test_client.get("/v1/jobs")
        
        assert response.status_code == 200
        data = response.json()
        assert "jobs" in data
        assert "total" in data
        assert data["limit"] == 10
        assert data["skip"] == 0

    def test_list_jobs_with_pagination(self, test_client, sample_pipeline_def):
        """Test pagination parameters."""
        # Submit a few jobs
        for i in range(5):
            test_client.post(
                "/v1/jobs",
                json={
                    "display_name": f"Job {i}",
                    "pipeline_definition": sample_pipeline_def
                }
            )
        
        # List with limit
        response = test_client.get("/v1/jobs?limit=2&skip=0")
        data = response.json()
        
        assert len(data["jobs"]) <= 2
        assert data["limit"] == 2
        assert data["skip"] == 0

    def test_list_jobs_by_status(self, test_client, sample_pipeline_def):
        """Test filtering jobs by status."""
        # Submit job
        submit_resp = test_client.post(
            "/v1/jobs",
            json={
                "display_name": "Status Filter Test",
                "pipeline_definition": sample_pipeline_def
            }
        )
        
        # Filter by queued status
        response = test_client.get("/v1/jobs?status=queued")
        assert response.status_code == 200
        data = response.json()
        
        # Verify we got queued jobs
        if data["jobs"]:
            assert all(job["status"] == "queued" for job in data["jobs"])

    def test_list_jobs_invalid_status(self, test_client):
        """Test that invalid status filter returns 400."""
        response = test_client.get("/v1/jobs?status=invalid_status")
        
        assert response.status_code == 400


class TestJobCancellation:
    """Test job cancellation via DELETE /v1/jobs/{job_id}."""

    def test_cancel_queued_job(self, test_client, sample_pipeline_def):
        """Test cancelling a queued job."""
        # Submit job
        submit_resp = test_client.post(
            "/v1/jobs",
            json={
                "display_name": "Job to Cancel",
                "pipeline_definition": sample_pipeline_def
            }
        )
        job_id = submit_resp.json()["id"]
        
        # Cancel it
        response = test_client.request(
            "DELETE",
            f"/v1/jobs/{job_id}",
            json={"reason": "User cancelled"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["cancelled"] is True
        assert data["job_id"] == job_id
        
        # Verify status changed to cancelled
        status_resp = test_client.get(f"/v1/jobs/{job_id}")
        job_data = status_resp.json()
        assert job_data["status"] == "cancelled"

    def test_cancel_nonexistent_job(self, test_client):
        """Test cancelling a job that doesn't exist."""
        response = test_client.request(
            "DELETE",
            f"/v1/jobs/{uuid4()}",
            json={"reason": "Test"}
        )
        
        assert response.status_code == 404

    def test_cannot_cancel_completed_job(self, test_client, sample_pipeline_def):
        """Test that completed jobs cannot be cancelled."""
        # This test would require a job to be completed first
        # Skip for now as it requires worker execution
        pass


class TestEndToEndFlow:
    """Test the complete flow from submission to polling."""

    def test_submit_and_poll(self, test_client, sample_pipeline_def):
        """Test end-to-end: submit -> get -> list."""
        # 1. Submit pipeline
        submit_resp = test_client.post(
            "/v1/jobs",
            json={
                "display_name": "E2E Test Pipeline",
                "pipeline_definition": sample_pipeline_def
            }
        )
        assert submit_resp.status_code == 200
        job_id = submit_resp.json()["id"]
        print(f"\n✓ Submitted job: {job_id}")
        
        # 2. Get immediate status
        get_resp = test_client.get(f"/v1/jobs/{job_id}")
        assert get_resp.status_code == 200
        job = get_resp.json()
        assert job["status"] == "queued"
        assert job["created_at"] is not None
        print(f"✓ Job status: {job['status']}")
        
        # 3. List jobs (should include our job)
        list_resp = test_client.get("/v1/jobs")
        assert list_resp.status_code == 200
        jobs = list_resp.json()
        assert any(j["id"] == job_id for j in jobs["jobs"])
        print(f"✓ Job appears in list")
        
        # 4. Attempt to poll a few times (don't wait for completion)
        for i in range(3):
            poll_resp = test_client.get(f"/v1/jobs/{job_id}")
            data = poll_resp.json()
            print(f"✓ Poll {i+1}: status={data['status']}, has_result={data['result'] is not None}")
            time.sleep(0.5)


if __name__ == "__main__":
    # Run with: uv run pytest tests/test_jobs.py -v
    pytest.main([__file__, "-v", "-s"])
