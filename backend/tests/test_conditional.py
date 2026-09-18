import polars as pl

from app.domain.models import PipelineDefinition
from app.execution.executor import execute_pipeline


def _write_csv(path, frame: pl.DataFrame) -> str:
    frame.write_csv(path)
    return str(path)


def test_conditional_splits_rows_into_true_and_false_branches(tmp_path):
    input_path = _write_csv(
        tmp_path / "in.csv",
        pl.DataFrame({"region": ["east", "west", "north"], "quantity": [2, 5, 9]}),
    )
    high_output = tmp_path / "high.csv"
    low_output = tmp_path / "low.csv"

    pipeline = PipelineDefinition(
        schema_version=1,
        pipeline_id="p1",
        nodes=[
            {"id": "source", "type": "source.csv", "config": {"path": input_path}},
            {
                "id": "cond",
                "type": "transform.conditional",
                "config": {
                    "condition": {
                        "type": "binary_operation",
                        "operator": ">",
                        "left": {"type": "column", "name": "quantity"},
                        "right": {"type": "literal", "value": 4},
                    }
                },
            },
            {"id": "high_sink", "type": "sink.csv", "config": {"path": str(high_output)}},
            {"id": "low_sink", "type": "sink.csv", "config": {"path": str(low_output)}},
        ],
        edges=[
            {"source": "source", "target": "cond"},
            {"source": "cond", "target": "high_sink", "output": "true"},
            {"source": "cond", "target": "low_sink", "output": "false"},
        ],
    )

    outputs = execute_pipeline(pipeline)

    assert outputs["cond:true"].collect()["region"].to_list() == ["west", "north"]
    assert outputs["cond:false"].collect()["region"].to_list() == ["east"]
    assert pl.read_csv(high_output)["region"].to_list() == ["west", "north"]
    assert pl.read_csv(low_output)["region"].to_list() == ["east"]
