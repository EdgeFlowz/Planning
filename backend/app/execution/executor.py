"""Conductor: walks the DAG in dependency order and delegates to connectors/transforms.

This module does not know how any individual node type works — it only
resolves each node's implementation from the connector/transform registries.
"""

from __future__ import annotations

import polars as pl

from app.connectors.registry import get_sink, get_source
from app.domain.models import PipelineDefinition
from app.domain.validator import PipelineValidationError, validate_pipeline
from app.execution.planner import predecessors, topological_order
from app.transformations.registry import apply_transform


def execute_pipeline(pipeline: PipelineDefinition) -> dict[str, pl.LazyFrame]:
    """Validate and run every node in dependency order, returning each node's output frame."""
    issues = validate_pipeline(pipeline)
    if issues:
        raise PipelineValidationError(issues)

    nodes_by_id = {node.id: node for node in pipeline.nodes}
    upstream = predecessors(pipeline)
    order = topological_order(pipeline)

    outputs: dict[str, pl.LazyFrame] = {}
    for node_id in order:
        node = nodes_by_id[node_id]
        inputs = [outputs[parent_id] for parent_id in upstream[node_id]]

        if node.type.startswith("source."):
            outputs[node_id] = get_source(node.type).read(node.config)
        elif node.type.startswith("sink."):
            get_sink(node.type).write(inputs[0], node.config)
            outputs[node_id] = inputs[0]
        else:
            outputs[node_id] = apply_transform(node.type, inputs, node.config)

    return outputs
