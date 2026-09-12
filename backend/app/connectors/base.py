"""Shared interface every source/sink connector conforms to."""

from __future__ import annotations

from typing import Protocol

import polars as pl


class SourceConnector(Protocol):
    def read(self, config: dict) -> pl.LazyFrame: ...


class SinkConnector(Protocol):
    def write(self, lf: pl.LazyFrame, config: dict) -> None: ...
