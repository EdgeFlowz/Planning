from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.models import (
    Pipeline as PipelineDomain,
    PipelineDefinition,
    PipelineVersion as PipelineVersionDomain,
)
from app.persistence.models import Pipeline, PipelineVersion


class PipelineRepository:
    def __init__(self, session: Session):
        self.session = session

    def create(
        self,
        pipeline: PipelineDomain,
        version: PipelineVersionDomain,
    ) -> PipelineDomain:
        pipeline_orm = Pipeline(
            id=UUID(pipeline.id),
            name=pipeline.name,
            created_at=pipeline.created_at,
            updated_at=pipeline.updated_at,
        )

        version_orm = PipelineVersion(
            pipeline=pipeline_orm,
            version=version.version,
            definition=version.definition.model_dump(),
            created_at=version.created_at,
        )

        self.session.add(pipeline_orm)
        self.session.commit()
        self.session.refresh(pipeline_orm)

        return pipeline

    def get(self, pipeline_id: str) -> PipelineDomain | None:
        statement = select(Pipeline).where(
            Pipeline.id == UUID(pipeline_id)
        )

        pipeline_orm = self.session.scalar(statement)

        if pipeline_orm is None:
            return None

        return PipelineDomain(
            id=str(pipeline_orm.id),
            name=pipeline_orm.name,
            created_at=pipeline_orm.created_at,
            updated_at=pipeline_orm.updated_at,
        )

    def get_version(
        self,
        pipeline_id: str,
        version: int,
    ) -> PipelineVersionDomain | None:
        statement = select(PipelineVersion).where(
            PipelineVersion.pipeline_id == UUID(pipeline_id),
            PipelineVersion.version == version,
        )

        version_orm = self.session.scalar(statement)

        if version_orm is None:
            return None

        return PipelineVersionDomain(
            pipeline_id=str(version_orm.pipeline_id),
            version=version_orm.version,
            definition=PipelineDefinition.model_validate(
                version_orm.definition
            ),
            created_at=version_orm.created_at,
        )

