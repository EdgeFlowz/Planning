"""Node type catalog: the machine-readable contract the frontend builds its palette/forms from."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from app.transformations.schemas import TRANSFORM_CONFIG_MODELS

NodeCategory = Literal["source", "transform", "sink"]


class NodeTypeDefinition(BaseModel):
    type: str
    category: NodeCategory
    display_name: str
    implemented: bool
    config_schema: dict


def _transform_entry(node_type: str, display_name: str) -> NodeTypeDefinition:
    config_model = TRANSFORM_CONFIG_MODELS[node_type]
    return NodeTypeDefinition(
        type=node_type,
        category="transform",
        display_name=display_name,
        implemented=True,
        config_schema=config_model.model_json_schema(),
    )


def _unimplemented_entry(node_type: str, category: NodeCategory, display_name: str) -> NodeTypeDefinition:
    # Connector not built yet (see app/connectors); config shape is not final.
    return NodeTypeDefinition(
        type=node_type,
        category=category,
        display_name=display_name,
        implemented=False,
        config_schema={},
    )


NODE_CATALOG: list[NodeTypeDefinition] = [
    _unimplemented_entry("source.csv", "source", "CSV Source"),
    _unimplemented_entry("source.parquet", "source", "Parquet Source"),
    _unimplemented_entry("source.sql", "source", "SQL Source"),
    _transform_entry("transform.select", "Select Columns"),
    _transform_entry("transform.filter", "Filter Rows"),
    _transform_entry("transform.rename", "Rename Columns"),
    _transform_entry("transform.cast", "Cast Types"),
    _transform_entry("transform.join", "Join"),
    _transform_entry("transform.aggregate", "Aggregate"),
    _transform_entry("transform.sort", "Sort"),
    _transform_entry("transform.deduplicate", "Deduplicate"),
    _transform_entry("transform.expression", "Add Calculated Column"),
    _unimplemented_entry("sink.csv", "sink", "CSV Sink"),
    _unimplemented_entry("sink.parquet", "sink", "Parquet Sink"),
    _unimplemented_entry("sink.sql", "sink", "SQL Sink"),
]
