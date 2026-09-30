from uuid import uuid4

from app.domain.models import (
    Pipeline as PipelineDomain,
    PipelineDefinition,
    PipelineVersion as PipelineVersionDomain,
)
from app.persistence.database import SessionLocal
from app.persistence.models import Pipeline
from app.persistence.repositories.pipelines import PipelineRepository


def test_pipeline_repository_create_and_get():
    pipeline_id = str(uuid4())

    pipeline = PipelineDomain(
        id=pipeline_id,
        name="Repository Test Pipeline",
    )

    definition = PipelineDefinition(
        schema_version=1,
        pipeline_id=pipeline_id,
        nodes=[],
        edges=[],
    )

    version = PipelineVersionDomain(
        pipeline_id=pipeline_id,
        version=1,
        definition=definition,
    )

    with SessionLocal() as session:
        repository = PipelineRepository(session)

        created = repository.create(
            pipeline,
            version,
        )

        assert created.id == pipeline_id
        assert created.name == "Repository Test Pipeline"

    with SessionLocal() as session:
        repository = PipelineRepository(session)

        loaded = repository.get(pipeline_id)

        assert loaded is not None
        assert loaded.id == pipeline_id
        assert loaded.name == "Repository Test Pipeline"

        loaded_version = repository.get_version(
            pipeline_id,
            1,
        )

        assert loaded_version is not None
        assert loaded_version.pipeline_id == pipeline_id
        assert loaded_version.version == 1
        assert loaded_version.definition == definition


    with SessionLocal() as session:
        pipeline_orm = session.get(
            Pipeline,
            pipeline_id,
        )

        assert pipeline_orm is not None

        session.delete(pipeline_orm)
        session.commit()

