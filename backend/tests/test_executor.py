import polars as pl

from app.domain.models import PipelineDefinition
from app.execution.executor import execute_pipeline


def _write_csv(path, frame: pl.DataFrame) -> str:
    frame.write_csv(path)
    return str(path)


def test_execute_pipeline_runs_source_transform_and_sink(tmp_path):
    input_path = _write_csv(
        tmp_path / "in.csv",
        pl.DataFrame({"region": ["east", "west"], "quantity": [2, 5], "price": [10, 20]}),
    )
    output_path = tmp_path / "out.csv"

    pipeline = PipelineDefinition(
        schema_version=1,
        pipeline_id="p1",
        nodes=[
            {"id": "source", "type": "source.csv", "config": {"path": input_path}},
            {"id": "calc", "type": "transform.expression", "config": {
                "columns": [{
                    "alias": "total",
                    "expression": {
                        "type": "binary_operation",
                        "operator": "*",
                        "left": {"type": "column", "name": "quantity"},
                        "right": {"type": "column", "name": "price"},
                    },
                }]
            }},
            {"id": "sink", "type": "sink.csv", "config": {"path": str(output_path)}},
        ],
        edges=[
            {"source": "source", "target": "calc"},
            {"source": "calc", "target": "sink"},
        ],
    )

    outputs = execute_pipeline(pipeline)

    assert outputs["calc"].collect()["total"].to_list() == [20, 100]
    assert output_path.exists()
    assert pl.read_csv(output_path)["total"].to_list() == [20, 100]


def test_execute_pipeline_supports_join_with_two_inputs(tmp_path):
    left_path = _write_csv(tmp_path / "left.csv", pl.DataFrame({"region": ["east", "west"], "quantity": [2, 5]}))
    right_path = _write_csv(tmp_path / "right.csv", pl.DataFrame({"region": ["east", "west"], "manager": ["alice", "bob"]}))

    pipeline = PipelineDefinition(
        schema_version=1,
        pipeline_id="p2",
        nodes=[
            {"id": "left", "type": "source.csv", "config": {"path": left_path}},
            {"id": "right", "type": "source.csv", "config": {"path": right_path}},
            {"id": "join", "type": "transform.join", "config": {"on": "region", "how": "inner"}},
        ],
        edges=[
            {"source": "left", "target": "join"},
            {"source": "right", "target": "join"},
        ],
    )

    outputs = execute_pipeline(pipeline)

    result = outputs["join"].collect().sort("region")
    assert result["manager"].to_list() == ["alice", "bob"]
