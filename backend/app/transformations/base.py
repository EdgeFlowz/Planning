"""Shared interface every transform implementation conforms to."""

from __future__ import annotations

from typing import Protocol

import polars as pl

from app.domain.models import NodeMetadata


class Transform(Protocol):
    metadata: NodeMetadata

    def apply(self, inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame | dict[str, pl.LazyFrame]: ...


def single_input(inputs: list[pl.LazyFrame]) -> pl.LazyFrame:
    if len(inputs) != 1:
        raise ValueError(f"Expected exactly one input frame, got {len(inputs)}")
    return inputs[0]
