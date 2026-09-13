from pydantic import BaseModel


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
    # ports will come next

class Edge(BaseModel):
    source: str
    target: str


class PipelineDefinition(BaseModel):
    schema_version: int
    pipeline_id: str
    nodes: list[Node]
    edges: list[Edge]