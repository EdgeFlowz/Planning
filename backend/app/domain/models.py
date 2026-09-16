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
    condition: Condition | None = None


class PipelineDefinition(BaseModel):
    schema_version: int
    pipeline_id: str
    nodes: list[Node]
    edges: list[Edge]