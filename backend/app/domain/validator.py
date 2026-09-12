"""Structural validation for pipeline definitions."""

from __future__ import annotations

from dataclasses import dataclass

from app.domain.models import PipelineDefinition

SUPPORTED_NODE_TYPES = {
    "source.csv",
    "source.parquet",
    "source.sql",
    "transform.select",
    "transform.filter",
    "transform.rename",
    "transform.cast",
    "transform.join",
    "transform.aggregate",
    "transform.sort",
    "transform.deduplicate",
    "transform.expression",
    "sink.parquet",
    "sink.csv",
    "sink.sql",
}


@dataclass(frozen=True)
class ValidationIssue:
    code: str
    message: str


class PipelineValidationError(Exception):
    """Raised when a pipeline definition fails validation."""

    def __init__(self, issues: list[ValidationIssue]):
        self.issues = issues
        super().__init__("; ".join(issue.message for issue in issues))


def validate_pipeline(pipeline: PipelineDefinition) -> list[ValidationIssue]:
    """Check a pipeline definition for structural errors and return all issues found."""
    issues: list[ValidationIssue] = []

    node_ids = [node.id for node in pipeline.nodes]
    seen_ids: set[str] = set()
    duplicate_ids: set[str] = set()
    for node_id in node_ids:
        if node_id in seen_ids:
            duplicate_ids.add(node_id)
        seen_ids.add(node_id)
    for node_id in sorted(duplicate_ids):
        issues.append(
            ValidationIssue("duplicate_node_id", f"Node id '{node_id}' is used by more than one node.")
        )

    known_node_ids = set(node_ids)
    for edge in pipeline.edges:
        if edge.source not in known_node_ids:
            issues.append(
                ValidationIssue(
                    "unknown_edge_source",
                    f"Edge source '{edge.source}' does not match any node id.",
                )
            )
        if edge.target not in known_node_ids:
            issues.append(
                ValidationIssue(
                    "unknown_edge_target",
                    f"Edge target '{edge.target}' does not match any node id.",
                )
            )

    for node in pipeline.nodes:
        if node.type not in SUPPORTED_NODE_TYPES:
            issues.append(
                ValidationIssue(
                    "unsupported_node_type",
                    f"Node '{node.id}' has unsupported type '{node.type}'.",
                )
            )

    if not any(node.type.startswith("source.") for node in pipeline.nodes):
        issues.append(
            ValidationIssue("no_source_node", "Pipeline must contain at least one source node.")
        )

    cycle = _find_cycle(pipeline)
    if cycle is not None:
        issues.append(
            ValidationIssue("cycle_detected", f"Pipeline contains a cycle: {' -> '.join(cycle)}.")
        )

    return issues


def _find_cycle(pipeline: PipelineDefinition) -> list[str] | None:
    """Return the node ids forming a cycle, if one exists, using DFS."""
    adjacency: dict[str, list[str]] = {node.id: [] for node in pipeline.nodes}
    for edge in pipeline.edges:
        if edge.source in adjacency and edge.target in adjacency:
            adjacency[edge.source].append(edge.target)

    WHITE, GRAY, BLACK = 0, 1, 2
    color = {node_id: WHITE for node_id in adjacency}
    path: list[str] = []

    def visit(node_id: str) -> list[str] | None:
        color[node_id] = GRAY
        path.append(node_id)
        for neighbor in adjacency[node_id]:
            if color[neighbor] == GRAY:
                cycle_start = path.index(neighbor)
                return path[cycle_start:] + [neighbor]
            if color[neighbor] == WHITE:
                result = visit(neighbor)
                if result is not None:
                    return result
        path.pop()
        color[node_id] = BLACK
        return None

    for node_id in adjacency:
        if color[node_id] == WHITE:
            result = visit(node_id)
            if result is not None:
                return result
    return None
