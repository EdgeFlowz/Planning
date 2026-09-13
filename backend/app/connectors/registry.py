"""Registry mapping source/sink node types to their connector implementation."""

from __future__ import annotations

from app.connectors.base import SinkConnector, SourceConnector
from app.connectors.csv import CSVSink, CSVSource
from app.connectors.parquet import ParquetSink, ParquetSource
from app.domain.models import NodeMetadata

SOURCES: dict[str, SourceConnector] = {
    "source.csv": CSVSource(),
    "source.parquet": ParquetSource(),
}

SINKS: dict[str, SinkConnector] = {
    "sink.csv": CSVSink(),
    "sink.parquet": ParquetSink(),
}


def get_source(node_type: str) -> SourceConnector:
    try:
        return SOURCES[node_type]
    except KeyError:
        raise KeyError(f"No source connector registered for node type '{node_type}'") from None


def get_sink(node_type: str) -> SinkConnector:
    try:
        return SINKS[node_type]
    except KeyError:
        raise KeyError(f"No sink connector registered for node type '{node_type}'") from None


def get_source_metadata(node_type: str) -> NodeMetadata:
    return get_source(node_type).metadata


def get_sink_metadata(node_type: str) -> NodeMetadata:
    return get_sink(node_type).metadata
