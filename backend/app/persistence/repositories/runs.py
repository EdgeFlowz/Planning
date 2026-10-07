from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.models import (
    Connection as ConnectionDomain,
    NodeRun as NodeRunDomain,
    NodeRunStatus,
    PipelineRun as PipelineRunDomain,
    PipelineRunStatus,
)
from app.persistence.models import Connection, NodeRun, PipelineRun, PipelineVersion


class PipelineRunRepository:
    def __init__(self, session: Session):
        self.session = session

    def create(
        self,
        pipeline_run: PipelineRunDomain,
    ) -> PipelineRunDomain:
        """Create a new pipeline run."""
        version_statement = select(PipelineVersion).where(
            PipelineVersion.pipeline_id == UUID(pipeline_run.pipeline_id),
            PipelineVersion.version == pipeline_run.pipeline_version,
        )
        version = self.session.scalar(version_statement)
        if version is None:
            raise ValueError(
                f"Pipeline version {pipeline_run.pipeline_id}:{pipeline_run.pipeline_version} not found"
            )

        run_orm = PipelineRun(
            id=UUID(pipeline_run.id),
            pipeline_version_id=version.id,
            job_id=UUID(pipeline_run.job_id) if pipeline_run.job_id else None,
            status=pipeline_run.status.value,
            created_at=pipeline_run.created_at,
            started_at=pipeline_run.started_at,
            completed_at=pipeline_run.completed_at,
            error=pipeline_run.error,
        )

        self.session.add(run_orm)
        self.session.commit()
        self.session.refresh(run_orm)

        return pipeline_run

    def get_by_job_id(self, job_id: str) -> PipelineRunDomain | None:
        statement = select(PipelineRun).where(PipelineRun.job_id == UUID(job_id))
        run_orm = self.session.scalar(statement)
        return self._to_domain(run_orm) if run_orm is not None else None

    def get(self, run_id: str) -> PipelineRunDomain | None:
        """Get a pipeline run by ID."""
        statement = select(PipelineRun).where(
            PipelineRun.id == UUID(run_id)
        )

        run_orm = self.session.scalar(statement)

        if run_orm is None:
            return None

        return self._to_domain(run_orm)

    @staticmethod
    def _to_domain(run_orm: PipelineRun) -> PipelineRunDomain:
        return PipelineRunDomain(
            id=str(run_orm.id),
            pipeline_id=str(run_orm.pipeline_version.pipeline_id),
            pipeline_version=run_orm.pipeline_version.version,
            job_id=str(run_orm.job_id) if run_orm.job_id else None,
            status=PipelineRunStatus(run_orm.status),
            created_at=run_orm.created_at,
            started_at=run_orm.started_at,
            completed_at=run_orm.completed_at,
            error=run_orm.error,
        )

    def update_status(
        self,
        run_id: str,
        status: PipelineRunStatus,
        started_at: datetime | None = None,
        completed_at: datetime | None = None,
        error: str | None = None,
    ) -> None:
        """Update the status of a pipeline run."""
        statement = select(PipelineRun).where(
            PipelineRun.id == UUID(run_id)
        )

        run_orm = self.session.scalar(statement)

        if run_orm is None:
            raise ValueError(f"Pipeline run {run_id} not found")

        run_orm.status = status.value
        if started_at is not None:
            run_orm.started_at = started_at
        if completed_at is not None:
            run_orm.completed_at = completed_at
        if error is not None:
            run_orm.error = error

        self.session.commit()

    def list_by_pipeline(self, pipeline_id: str) -> list[PipelineRunDomain]:
        """List all runs for a pipeline."""
        statement = (
            select(PipelineRun)
            .join(PipelineVersion)
            .where(PipelineVersion.pipeline_id == UUID(pipeline_id))
        )

        runs_orm = self.session.scalars(statement).all()

        return [self._to_domain(run) for run in runs_orm]


class NodeRunRepository:
    def __init__(self, session: Session):
        self.session = session

    def create(
        self,
        node_run: NodeRunDomain,
    ) -> NodeRunDomain:
        """Create a new node run."""
        run_orm = NodeRun(
            id=UUID(node_run.id),
            pipeline_run_id=UUID(node_run.pipeline_run_id),
            node_id=node_run.node_id,
            node_type=node_run.node_type,
            status=node_run.status.value,
            started_at=node_run.started_at,
            completed_at=node_run.completed_at,
            rows_read=node_run.rows_read,
            rows_written=node_run.rows_written,
            columns=node_run.columns,
            error=node_run.error,
        )

        self.session.add(run_orm)
        self.session.commit()
        self.session.refresh(run_orm)

        return node_run

    def get(self, run_id: str) -> NodeRunDomain | None:
        """Get a node run by ID."""
        statement = select(NodeRun).where(
            NodeRun.id == UUID(run_id)
        )

        run_orm = self.session.scalar(statement)

        if run_orm is None:
            return None

        return NodeRunDomain(
            id=str(run_orm.id),
            pipeline_run_id=str(run_orm.pipeline_run_id),
            node_id=run_orm.node_id,
            node_type=run_orm.node_type,
            status=NodeRunStatus(run_orm.status),
            started_at=run_orm.started_at,
            completed_at=run_orm.completed_at,
            rows_read=run_orm.rows_read,
            rows_written=run_orm.rows_written,
            columns=run_orm.columns,
            error=run_orm.error,
        )

    def update_status(
        self,
        run_id: str,
        status: NodeRunStatus,
        started_at: datetime | None = None,
        completed_at: datetime | None = None,
        rows_read: int | None = None,
        rows_written: int | None = None,
        columns: list[str] | None = None,
        error: str | None = None,
    ) -> None:
        """Update the status and metrics of a node run."""
        statement = select(NodeRun).where(
            NodeRun.id == UUID(run_id)
        )

        run_orm = self.session.scalar(statement)

        if run_orm is None:
            raise ValueError(f"Node run {run_id} not found")

        run_orm.status = status.value
        if started_at is not None:
            run_orm.started_at = started_at
        if completed_at is not None:
            run_orm.completed_at = completed_at
        if rows_read is not None:
            run_orm.rows_read = rows_read
        if rows_written is not None:
            run_orm.rows_written = rows_written
        if columns is not None:
            run_orm.columns = columns
        if error is not None:
            run_orm.error = error

        self.session.commit()

    def reset_for_retry(self, pipeline_run_id: str) -> None:
        """Clear node attempt details before retrying the same persisted run."""
        statement = select(NodeRun).where(NodeRun.pipeline_run_id == UUID(pipeline_run_id))
        for node_run in self.session.scalars(statement):
            node_run.status = NodeRunStatus.QUEUED.value
            node_run.started_at = None
            node_run.completed_at = None
            node_run.rows_read = None
            node_run.rows_written = None
            node_run.columns = None
            node_run.error = None
        self.session.commit()

    def finish_unfinished(
        self,
        pipeline_run_id: str,
        status: NodeRunStatus,
        error: str | None = None,
    ) -> None:
        """Set a terminal state on node records that did not complete."""
        statement = select(NodeRun).where(
            NodeRun.pipeline_run_id == UUID(pipeline_run_id),
            NodeRun.status.in_([NodeRunStatus.QUEUED.value, NodeRunStatus.RUNNING.value]),
        )
        now = datetime.now(timezone.utc)
        for node_run in self.session.scalars(statement):
            node_run.status = status.value
            node_run.completed_at = now
            node_run.error = error
        self.session.commit()

    def list_by_pipeline_run(self, pipeline_run_id: str) -> list[NodeRunDomain]:
        """List all node runs for a pipeline run."""
        statement = select(NodeRun).where(
            NodeRun.pipeline_run_id == UUID(pipeline_run_id)
        )

        runs_orm = self.session.scalars(statement).all()

        return [
            NodeRunDomain(
                id=str(run.id),
                pipeline_run_id=str(run.pipeline_run_id),
                node_id=run.node_id,
                node_type=run.node_type,
                status=NodeRunStatus(run.status),
                started_at=run.started_at,
                completed_at=run.completed_at,
                rows_read=run.rows_read,
                rows_written=run.rows_written,
                columns=run.columns,
                error=run.error,
            )
            for run in runs_orm
        ]


class ConnectionRepository:
    def __init__(self, session: Session):
        self.session = session

    def create(
        self,
        connection: ConnectionDomain,
    ) -> ConnectionDomain:
        """Create a new connection."""
        conn_orm = Connection(
            id=UUID(connection.id),
            type=connection.type,
            name=connection.name,
            config=connection.config,
            created_at=connection.created_at,
        )

        self.session.add(conn_orm)
        self.session.commit()
        self.session.refresh(conn_orm)

        return connection

    def get(self, connection_id: str) -> ConnectionDomain | None:
        """Get a connection by ID."""
        statement = select(Connection).where(
            Connection.id == UUID(connection_id)
        )

        conn_orm = self.session.scalar(statement)

        if conn_orm is None:
            return None

        return ConnectionDomain(
            id=str(conn_orm.id),
            type=conn_orm.type,
            name=conn_orm.name,
            config=conn_orm.config,
            created_at=conn_orm.created_at,
        )

    def list(self) -> list[ConnectionDomain]:
        """List all connections."""
        statement = select(Connection)
        conns_orm = self.session.scalars(statement).all()

        return [
            ConnectionDomain(
                id=str(conn.id),
                type=conn.type,
                name=conn.name,
                config=conn.config,
                created_at=conn.created_at,
            )
            for conn in conns_orm
        ]

    def update(
        self,
        connection_id: str,
        connection: ConnectionDomain,
    ) -> ConnectionDomain:
        """Update a connection."""
        statement = select(Connection).where(
            Connection.id == UUID(connection_id)
        )

        conn_orm = self.session.scalar(statement)

        if conn_orm is None:
            raise ValueError(f"Connection {connection_id} not found")

        conn_orm.type = connection.type
        conn_orm.name = connection.name
        conn_orm.config = connection.config

        self.session.commit()
        self.session.refresh(conn_orm)

        return connection

    def delete(self, connection_id: str) -> None:
        """Delete a connection."""
        statement = select(Connection).where(
            Connection.id == UUID(connection_id)
        )

        conn_orm = self.session.scalar(statement)

        if conn_orm is None:
            raise ValueError(f"Connection {connection_id} not found")

        self.session.delete(conn_orm)
        self.session.commit()

