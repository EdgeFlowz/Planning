"""Shared interface every source/sink connector conforms to."""

from __future__ import annotations

from typing import Protocol

import polars as pl

from app.domain.models import NodeMetadata


class SourceConnector(Protocol):
    metadata: NodeMetadata

    def read(self, config: dict) -> pl.LazyFrame: ...


class SinkConnector(Protocol):
    metadata: NodeMetadata

    def write(self, lf: pl.LazyFrame, config: dict) -> None: ...
