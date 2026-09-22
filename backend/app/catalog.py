"""Node type catalog: the machine-readable contract the frontend builds its palette/forms from."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from app.connectors.registry import get_sink_metadata, get_source_metadata
from app.transformations.registry import get_transform_metadata

NodeCategory = Literal["source", "transform", "sink"]


class NodeTypeDefinition(BaseModel):
    type: str
    category: NodeCategory
    display_name: str
    implemented: bool
    config_schema: dict
    input_ports: tuple[str, ...] = ()
    output_ports: tuple[str, ...] = ()


def _transform_entry(node_type: str) -> NodeTypeDefinition:
    metadata = get_transform_metadata(node_type)
    return NodeTypeDefinition(
        type=metadata.type,
        category="transform",
        display_name=metadata.name,
        implemented=True,
        config_schema=metadata.config_schema,
        input_ports=metadata.input_ports,
        output_ports=metadata.output_ports,
    )


def _source_entry(node_type: str) -> NodeTypeDefinition:
    metadata = get_source_metadata(node_type)
    return NodeTypeDefinition(
        type=metadata.type,
        category="source",
        display_name=metadata.name,
        implemented=True,
        config_schema=metadata.config_schema,
        # A source reads from outside the pipeline, so it has no inbound port regardless of what
        # its metadata says — NodeMetadata.input_ports defaults to ("input",) for the benefit of
        # transforms, and connectors don't override it. Publishing that default would contradict
        # the validator, which rejects any edge into a source node.
        input_ports=(),
        output_ports=metadata.output_ports,
    )


def _sink_entry(node_type: str) -> NodeTypeDefinition:
    metadata = get_sink_metadata(node_type)
    return NodeTypeDefinition(
        type=metadata.type,
        category="sink",
        display_name=metadata.name,
        implemented=True,
        config_schema=metadata.config_schema,
        input_ports=metadata.input_ports,
        # Mirror of the source case: a sink terminates the pipeline, so nothing reads from it.
        output_ports=(),
    )


def _unimplemented_entry(
    node_type: str,
    category: NodeCategory,
    display_name: str,
    input_ports: tuple[str, ...] = (),
    output_ports: tuple[str, ...] = (),
) -> NodeTypeDefinition:
    # No connector implementation registered yet for this node type (see app/connectors).
    return NodeTypeDefinition(
        type=node_type,
        category=category,
        display_name=display_name,
        implemented=False,
        config_schema={},
        input_ports=input_ports,
        output_ports=output_ports,
    )


NODE_CATALOG: list[NodeTypeDefinition] = [
    _source_entry("source.csv"),
    _source_entry("source.parquet"),
    _unimplemented_entry("source.sql", "source", "SQL Source", output_ports=("output",)),
    _transform_entry("transform.select"),
    _transform_entry("transform.filter"),
    _transform_entry("transform.rename"),
    _transform_entry("transform.cast"),
    _transform_entry("transform.join"),
    _transform_entry("transform.aggregate"),
    _transform_entry("transform.sort"),
    _transform_entry("transform.deduplicate"),
    _transform_entry("transform.expression"),
    _transform_entry("transform.conditional"),
    _sink_entry("sink.csv"),
    _sink_entry("sink.parquet"),
    _unimplemented_entry("sink.sql", "sink", "SQL Sink", input_ports=("input",)),
]


