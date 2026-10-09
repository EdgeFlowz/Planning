from datetime import datetime, timezone
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

        return self._to_version_domain(version_orm)

    def get_latest_version(self, pipeline_id: str) -> PipelineVersionDomain | None:
        statement = (
            select(PipelineVersion)
            .where(PipelineVersion.pipeline_id == UUID(pipeline_id))
            .order_by(PipelineVersion.version.desc())
            .limit(1)
        )

        version_orm = self.session.scalar(statement)

        if version_orm is None:
            return None

        return self._to_version_domain(version_orm)

    def save_version(
        self,
        pipeline_id: str,
        definition: PipelineDefinition,
        name: str | None = None,
    ) -> tuple[PipelineDomain, PipelineVersionDomain, bool] | None:
        """Save `definition` as the pipeline's next version, optionally renaming it.

        A definition identical to the latest version doesn't create a new one (the worker
        dedupes versions the same way), so re-saving unchanged work doesn't pile up copies.
        Returns (pipeline, latest version, whether a version was created), or None if the
        pipeline doesn't exist.
        """
        pipeline_orm = self.session.get(Pipeline, UUID(pipeline_id))
        if pipeline_orm is None:
            return None

        # Stored definitions always carry the pipeline's own id, which is how the worker links
        # runs back to the pipeline.
        data = definition.model_copy(update={"pipeline_id": pipeline_id}).model_dump(mode="json")
        latest = self.session.scalar(
            select(PipelineVersion)
            .where(PipelineVersion.pipeline_id == pipeline_orm.id)
            .order_by(PipelineVersion.version.desc())
            .limit(1)
        )

        now = datetime.now(timezone.utc)
        created = latest is None or latest.definition != data
        if created:
            latest = PipelineVersion(
                pipeline_id=pipeline_orm.id,
                version=latest.version + 1 if latest else 1,
                definition=data,
                created_at=now,
            )
            self.session.add(latest)

        renamed = bool(name) and name != pipeline_orm.name
        if renamed:
            pipeline_orm.name = name
        if created or renamed:
            pipeline_orm.updated_at = now

        self.session.commit()
        self.session.refresh(pipeline_orm)
        self.session.refresh(latest)

        pipeline = PipelineDomain(
            id=str(pipeline_orm.id),
            name=pipeline_orm.name,
            created_at=pipeline_orm.created_at,
            updated_at=pipeline_orm.updated_at,
        )
        return pipeline, self._to_version_domain(latest), created

    @staticmethod
    def _to_version_domain(version_orm: PipelineVersion) -> PipelineVersionDomain:
        return PipelineVersionDomain(
            pipeline_id=str(version_orm.pipeline_id),
            version=version_orm.version,
            definition=PipelineDefinition.model_validate(
                version_orm.definition
            ),
            created_at=version_orm.created_at,
        )

