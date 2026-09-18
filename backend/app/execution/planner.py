"""Determines the order in which pipeline nodes must execute."""

from __future__ import annotations

from collections import deque

from app.domain.models import PipelineDefinition


def topological_order(pipeline: PipelineDefinition) -> list[str]:
    """Return node ids ordered so every node appears after all of its upstream dependencies."""
    node_ids = [node.id for node in pipeline.nodes]
    in_degree = {node_id: 0 for node_id in node_ids}
    adjacency: dict[str, list[str]] = {node_id: [] for node_id in node_ids}

    for edge in pipeline.edges:
        adjacency[edge.source].append(edge.target)
        in_degree[edge.target] += 1

    queue = deque(node_id for node_id in node_ids if in_degree[node_id] == 0)
    order: list[str] = []

    while queue:
        node_id = queue.popleft()
        order.append(node_id)
        for neighbor in adjacency[node_id]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    if len(order) != len(node_ids):
        raise ValueError("Pipeline contains a cycle and cannot be ordered.")

    return order


def predecessors(pipeline: PipelineDefinition) -> dict[str, list[str]]:
    """Map each node id to the output keys (see execution/executor.py) feeding it, in edge order.

    An output key is the producing node's id alone for its default output port, or
    "node_id:port" when the edge is drawn from a specific named port (e.g. transform.conditional's
    "true"/"false" branches).
    """
    result: dict[str, list[str]] = {node.id: [] for node in pipeline.nodes}
    for edge in pipeline.edges:
        key = f"{edge.source}:{edge.output}" if edge.output else edge.source
        result[edge.target].append(key)
    return result
