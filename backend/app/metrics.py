"""Prometheus metrics for the HTTP API."""

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram

registry = CollectorRegistry()

http_requests_total = Counter(
    "pipeline_api_http_requests_total",
    "Total HTTP requests handled by the API, excluding the metrics scrape endpoint.",
    labelnames=("method", "route", "status"),
    registry=registry,
)
http_request_duration_seconds = Histogram(
    "pipeline_api_http_request_duration_seconds",
    "HTTP request duration in seconds, excluding the metrics scrape endpoint.",
    labelnames=("method", "route"),
    registry=registry,
)
http_requests_in_progress = Gauge(
    "pipeline_api_http_requests_in_progress",
    "Number of HTTP requests currently being handled, excluding the metrics scrape endpoint.",
    registry=registry,
)
