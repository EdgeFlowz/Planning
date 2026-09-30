from datetime import datetime, timezone

from sqlalchemy import select

from app.persistence.database import SessionLocal
from app.persistence.models import Pipeline, PipelineVersion


def test_pipeline_persistence():
    pipeline = Pipeline(
        name="Integration Test Pipeline",
    )

    definition = {
        "schema_version": 1,
        "pipeline_id": str(pipeline.id),
        "nodes": [
            {
                "id": "source_1",
                "type": "csv",
                "config": {
                    "path": "example.csv",
                },
            }
        ],
        "edges": [],
    }

    version = PipelineVersion(
        pipeline=pipeline,
        version=1,
        definition=definition,
    )

    with SessionLocal() as session:
        session.add(pipeline)
        pipeline.versions.append(version)

        session.commit()

        pipeline_id = pipeline.id

    with SessionLocal() as session:
        saved_pipeline = session.scalar(
            select(Pipeline).where(Pipeline.id == pipeline_id)
        )

        assert saved_pipeline is not None
        assert saved_pipeline.name == "Integration Test Pipeline"
        assert len(saved_pipeline.versions) == 1

        saved_version = saved_pipeline.versions[0]

        assert saved_version.version == 1
        assert saved_version.definition == definition

        session.delete(saved_pipeline)
        session.commit()