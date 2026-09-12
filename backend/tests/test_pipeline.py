from app.domain.models import PipelineDefinition
from app.domain.validator import validate_pipeline


def _pipeline(nodes, edges):
    return PipelineDefinition(schema_version=1, pipeline_id="p1", nodes=nodes, edges=edges)


def test_valid_pipeline_passes():
    pipeline = _pipeline(
        nodes=[
            {"id": "a", "type": "source.csv", "config": {}},
            {"id": "b", "type": "transform.select", "config": {}},
            {"id": "c", "type": "sink.csv", "config": {}},
        ],
        edges=[
            {"source": "a", "target": "b"},
            {"source": "b", "target": "c"},
        ],
    )

    assert validate_pipeline(pipeline) == []


def test_unknown_edge_reference_fails():
    pipeline = _pipeline(
        nodes=[
            {"id": "a", "type": "source.csv", "config": {}},
            {"id": "b", "type": "sink.csv", "config": {}},
        ],
        edges=[
            {"source": "a", "target": "missing"},
        ],
    )

    issues = validate_pipeline(pipeline)

    assert any(issue.code == "unknown_edge_target" for issue in issues)


def test_cycle_fails():
    pipeline = _pipeline(
        nodes=[
            {"id": "a", "type": "source.csv", "config": {}},
            {"id": "b", "type": "transform.select", "config": {}},
        ],
        edges=[
            {"source": "a", "target": "b"},
            {"source": "b", "target": "a"},
        ],
    )

    issues = validate_pipeline(pipeline)

    assert any(issue.code == "cycle_detected" for issue in issues)


def test_duplicate_node_id_fails():
    pipeline = _pipeline(
        nodes=[
            {"id": "a", "type": "source.csv", "config": {}},
            {"id": "a", "type": "sink.csv", "config": {}},
        ],
        edges=[],
    )

    issues = validate_pipeline(pipeline)

    assert any(issue.code == "duplicate_node_id" for issue in issues)


def test_unsupported_node_type_fails():
    pipeline = _pipeline(
        nodes=[
            {"id": "a", "type": "source.csv", "config": {}},
            {"id": "b", "type": "transform.mystery", "config": {}},
        ],
        edges=[
            {"source": "a", "target": "b"},
        ],
    )

    issues = validate_pipeline(pipeline)

    assert any(issue.code == "unsupported_node_type" for issue in issues)
