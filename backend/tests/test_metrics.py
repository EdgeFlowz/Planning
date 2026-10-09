from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_metrics_endpoint_exposes_http_request_metrics():
    health_response = client.get("/health")
    assert health_response.status_code == 200

    for path in ("/metrics", "/v1/metrics", "/api/v1/metrics"):
        response = client.get(path)

        assert response.status_code == 200
        assert "pipeline_api_http_requests_total" in response.text
        assert 'method="GET",route="/health",status="200"' in response.text
        assert "pipeline_api_http_request_duration_seconds" in response.text
        assert "pipeline_api_http_requests_in_progress" in response.text
        assert 'route="/v1/metrics"' not in response.text
        assert 'route="/api/v1/metrics"' not in response.text
