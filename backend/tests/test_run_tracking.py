from datetime import datetime, timezone
from uuid import uuid4

import polars as pl

from app.domain.models import Job, JobStatus, Node, PipelineDefinition
from app.persistence.models import NodeRun as NodeRunORM, PipelineRun as PipelineRunORM
from app.persistence.repositories.jobs import JobRepository
from app.persistence.repositories.runs import NodeRunRepository, PipelineRunRepository
from worker import executor as worker_executor


def test_async_job_execution_persists_pipeline_and_node_runs(db_session, monkeypatch):
    pipeline_definition = PipelineDefinition(
        schema_version=1,
        pipeline_id="unsaved-pipeline-name",
        nodes=[Node(id="source_1", type="source.csv", config={"path": "unused.csv"})],
        edges=[],
    )
    job_id = str(uuid4())
    JobRepository(db_session).create(
        Job(
            id=job_id,
            display_name="Persistence Test",
            pipeline_definition=pipeline_definition,
            status=JobStatus.QUEUED,
            max_retries=0,
            created_at=datetime.now(timezone.utc),
        )
    )
    monkeypatch.setattr(worker_executor, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(
        worker_executor,
        "execute_pipeline",
        lambda _definition: {"source_1": pl.DataFrame({"amount": [2, 4, 6]}).lazy()},
    )

    result = worker_executor.execute_job(
        {
            "job_id": job_id,
            "display_name": "Persistence Test",
            "pipeline_definition": pipeline_definition.model_dump(),
        }
    )

    assert result["status"] == "succeeded"
    run = db_session.query(PipelineRunORM).filter_by(job_id=job_id).one()
    node_run = db_session.query(NodeRunORM).filter_by(pipeline_run_id=run.id).one()
    assert run.status == "succeeded"
    assert run.pipeline_version_id is not None
    assert node_run.node_id == "source_1"
    assert node_run.status == "succeeded"
    assert node_run.rows_written == 3
    assert node_run.columns == ["amount"]
    assert JobRepository(db_session).get(job_id).status == JobStatus.SUCCEEDED

    run_domain = PipelineRunRepository(db_session).get_by_job_id(job_id)
    assert run_domain is not None
    assert run_domain.pipeline_id == str(run.pipeline_version.pipeline_id)
    assert run_domain.pipeline_version == run.pipeline_version.version


def test_async_job_execution_persists_failed_node(db_session, monkeypatch):
    pipeline_definition = PipelineDefinition(
        schema_version=1,
        pipeline_id="failed-pipeline",
        nodes=[Node(id="source_1", type="source.csv", config={"path": "unused.csv"})],
        edges=[],
    )
    job_id = str(uuid4())
    JobRepository(db_session).create(
        Job(
            id=job_id,
            display_name="Failed Persistence Test",
            pipeline_definition=pipeline_definition,
            status=JobStatus.QUEUED,
            max_retries=0,
            created_at=datetime.now(timezone.utc),
        )
    )
    monkeypatch.setattr(worker_executor, "SessionLocal", lambda: db_session)

    class FailingFrame:
        def collect(self):
            raise FileNotFoundError("missing source file")

    monkeypatch.setattr(
        worker_executor,
        "execute_pipeline",
        lambda _definition: {"source_1": FailingFrame()},
    )

    result = worker_executor.execute_job(
        {
            "job_id": job_id,
            "display_name": "Failed Persistence Test",
            "pipeline_definition": pipeline_definition.model_dump(),
        }
    )

    run = db_session.query(PipelineRunORM).filter_by(job_id=job_id).one()
    node_run = db_session.query(NodeRunORM).filter_by(pipeline_run_id=run.id).one()
    assert result["status"] == "failed"
    assert run.status == "failed"
    assert node_run.status == "failed"
    assert node_run.error == "missing source file"
    assert JobRepository(db_session).get(job_id).status == JobStatus.FAILED


def test_retry_reuses_run_records_and_persists_successful_attempt(db_session, monkeypatch):
    pipeline_definition = PipelineDefinition(
        schema_version=1,
        pipeline_id="retry-pipeline",
        nodes=[Node(id="source_1", type="source.csv", config={"path": "unused.csv"})],
        edges=[],
    )
    job_id = str(uuid4())
    JobRepository(db_session).create(
        Job(
            id=job_id,
            display_name="Retry Persistence Test",
            pipeline_definition=pipeline_definition,
            status=JobStatus.QUEUED,
            max_retries=1,
            created_at=datetime.now(timezone.utc),
        )
    )
    monkeypatch.setattr(worker_executor, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(worker_executor.time, "sleep", lambda _seconds: None)

    attempts = iter((False, True))

    class FailingFrame:
        def collect(self):
            raise OSError("temporary read failure")

    def execute(_definition):
        if not next(attempts):
            return {"source_1": FailingFrame()}
        return {"source_1": pl.DataFrame({"amount": [9]}).lazy()}

    monkeypatch.setattr(worker_executor, "execute_pipeline", execute)
    result = worker_executor.execute_job(
        {
            "job_id": job_id,
            "display_name": "Retry Persistence Test",
            "pipeline_definition": pipeline_definition.model_dump(),
        }
    )

    run = db_session.query(PipelineRunORM).filter_by(job_id=job_id).one()
    node_run = db_session.query(NodeRunORM).filter_by(pipeline_run_id=run.id).one()
    job = JobRepository(db_session).get(job_id)
    assert result["status"] == "succeeded"
    assert job.retry_count == 1
    assert run.status == "succeeded"
    assert node_run.status == "succeeded"
    assert node_run.rows_written == 1
