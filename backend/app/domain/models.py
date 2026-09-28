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