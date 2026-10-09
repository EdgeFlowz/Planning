"""link pipeline runs to async jobs

Revision ID: 9c21df786a40
Revises: 407958a2060d
Create Date: 2026-10-07
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "9c21df786a40"
down_revision: Union[str, Sequence[str], None] = "407958a2060d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "pipeline_runs",
        sa.Column("job_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_pipeline_runs_job_id_jobs",
        "pipeline_runs",
        "jobs",
        ["job_id"],
        ["id"],
    )
    op.create_unique_constraint(
        "uq_pipeline_runs_job_id",
        "pipeline_runs",
        ["job_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_pipeline_runs_job_id", "pipeline_runs", type_="unique")
    op.drop_constraint("fk_pipeline_runs_job_id_jobs", "pipeline_runs", type_="foreignkey")
    op.drop_column("pipeline_runs", "job_id")
