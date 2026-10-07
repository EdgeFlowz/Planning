from datetime import datetime, timezone
from enum import StrEnum
from pydantic import BaseModel, Field



class Node(BaseModel):
    id: str
    type: str
    config: dict

class NodeMetadata(BaseModel):
    type: str
    name: str
    description: str
    category: str
    version: int = 1
    config_schema: dict
    input_ports: tuple[str, ...] = ("input",)
    output_ports: tuple[str, ...] = ("output",)

class Condition(BaseModel):
    column: str
    operator: str
    value: object

class Edge(BaseModel):
    source: str
    target: str
    input: str | None = None
    # Which of the source node's output ports this edge draws from (e.g. transform.conditional's
    # "true"/"false"); None means the node's sole/default output port.
    output: str | None = None
    condition: Condition | None = None

class Pipeline(BaseModel):
    id: str
    name: str
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


class PipelineDefinition(BaseModel):
    schema_version: int
    pipeline_id: str
    nodes: list[Node]
    edges: list[Edge]

class PipelineVersion(BaseModel):
    pipeline_id: str
    version: int
    definition: PipelineDefinition
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )

class PipelineRunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class PipelineRun(BaseModel):
    id: str
    pipeline_id: str
    pipeline_version: int

    status: PipelineRunStatus = PipelineRunStatus.QUEUED

    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None

    error: str | None = None


class NodeRunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class NodeRun(BaseModel):
    id: str
    pipeline_run_id: str
    node_id: str
    node_type: str

    status: NodeRunStatus = NodeRunStatus.QUEUED

    started_at: datetime | None = None
    completed_at: datetime | None = None

    rows_read: int | None = None
    rows_written: int | None = None
    columns: list[str] | None = None

    error: str | None = None


class Connection(BaseModel):
    id: str
    type: str
    name: str
    config: dict

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


class JobStatus(StrEnum):
    """Status states for async pipeline execution jobs."""
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class Job(BaseModel):
    """Represents an async pipeline execution job.
    
    Jobs are created when a pipeline is submitted for execution via the job queue.
    They progress through states: queued → running → succeeded/failed/cancelled
    """
    id: str
    display_name: str
    pipeline_definition: PipelineDefinition
    status: JobStatus = JobStatus.QUEUED
    result: dict | None = None
    error: str | None = None
    retry_count: int = 0
    max_retries: int = 3
    
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    started_at: datetime | None = None
    completed_at: datetime | None = None
    cancelled_at: datetime | None = None