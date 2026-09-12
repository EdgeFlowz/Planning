from pydantic import BaseModel


class Node(BaseModel):
    id: str
    type: str
    config: dict


class Edge(BaseModel):
    source: str
    target: str


class PipelineDefinition(BaseModel):
    schema_version: int
    pipeline_id: str
    nodes: list[Node]
    edges: list[Edge]