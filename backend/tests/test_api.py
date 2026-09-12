import polars as pl
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_run_pipeline_succeeds(tmp_path):
    input_path = tmp_path / "in.csv"
    pl.DataFrame({"region": ["east", "west"], "quantity": [2, 5]}).write_csv(input_path)

    body = {
        "schema_version": 1,
        "pipeline_id": "p1",
        "nodes": [
            {"id": "source", "type": "source.csv", "config": {"path": str(input_path)}},
            {"id": "select", "type": "transform.select", "config": {"columns": ["region", "quantity"]}},
        ],
        "edges": [{"source": "source", "target": "select"}],
    }

    response = client.post("/pipelines/run", json=body)

    assert response.status_code == 200
    result = response.json()
    assert result["pipeline_id"] == "p1"
    select_result = next(n for n in result["node_results"] if n["node_id"] == "select")
    assert select_result["rows"] == 2
    assert select_result["columns"] == ["region", "quantity"]


def test_run_pipeline_rejects_invalid_definition():
    body = {
        "schema_version": 1,
        "pipeline_id": "p2",
        "nodes": [{"id": "a", "type": "source.csv", "config": {"path": "x.csv"}}],
        "edges": [{"source": "a", "target": "missing"}],
    }

    response = client.post("/pipelines/run", json=body)

    assert response.status_code == 422
    assert any(issue["code"] == "unknown_edge_target" for issue in response.json()["detail"])
