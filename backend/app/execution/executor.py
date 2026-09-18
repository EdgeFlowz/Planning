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
    """Validate and run every node in dependency order, returning each node's output frame(s).

    Keyed by node id for an ordinary single-output node; a multi-output node (e.g.
    transform.conditional) additionally exposes each of its branches as "node_id:port".
    """
    issues = validate_pipeline(pipeline)
    if issues:
        raise PipelineValidationError(issues)

    nodes_by_id = {node.id: node for node in pipeline.nodes}
    upstream = predecessors(pipeline)
    order = topological_order(pipeline)

    outputs: dict[str, pl.LazyFrame] = {}
    for node_id in order:
        node = nodes_by_id[node_id]
        try:
            inputs = [outputs[key] for key in upstream[node_id]]
        except KeyError as exc:
            raise KeyError(f"Node '{node_id}' expects input '{exc.args[0]}', which was never produced.") from exc

        if node.type.startswith("source."):
            outputs[node_id] = get_source(node.type).read(node.config)
        elif node.type.startswith("sink."):
            get_sink(node.type).write(inputs[0], node.config)
            outputs[node_id] = inputs[0]
        else:
            result = apply_transform(node.type, inputs, node.config)
            if isinstance(result, dict):
                for port, frame in result.items():
                    outputs[f"{node_id}:{port}"] = frame
            else:
                outputs[node_id] = result

    return outputs
