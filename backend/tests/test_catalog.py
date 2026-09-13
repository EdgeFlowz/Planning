from fastapi.testclient import TestClient

from app.domain.validator import SUPPORTED_NODE_TYPES
from app.main import app

client = TestClient(app)


def test_nodes_endpoint_returns_every_supported_node_type():
    response = client.get("/nodes")

    assert response.status_code == 200
    body = response.json()
    assert {node["type"] for node in body} == SUPPORTED_NODE_TYPES


def test_implemented_transform_nodes_expose_a_config_schema():
    response = client.get("/nodes")

    body = {node["type"]: node for node in response.json()}

    assert body["transform.select"]["implemented"] is True
    assert body["transform.select"]["config_schema"]["required"] == ["columns"]
    assert body["source.csv"]["implemented"] is True
    assert body["source.csv"]["config_schema"]["required"] == ["path"]
    assert body["source.sql"]["implemented"] is False
    assert body["source.sql"]["config_schema"] == {}
