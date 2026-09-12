"""Pydantic config schemas for each registered transform, used for validation and catalog generation."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class SelectConfig(BaseModel):
    columns: list[str]


class FilterConfig(BaseModel):
    expression: dict


class RenameConfig(BaseModel):
    mapping: dict[str, str]


class CastConfig(BaseModel):
    columns: dict[str, str]


class JoinConfig(BaseModel):
    how: Literal["inner", "left", "right", "full", "semi", "anti", "cross"] = "inner"
    on: str | list[str] | None = None
    left_on: str | list[str] | None = None
    right_on: str | list[str] | None = None


class AggregationSpec(BaseModel):
    column: str
    function: Literal["sum", "mean", "min", "max", "count", "median", "std", "n_unique", "first", "last"]
    alias: str | None = None


class AggregateConfig(BaseModel):
    group_by: list[str] = []
    aggregations: list[AggregationSpec]


class SortConfig(BaseModel):
    by: list[str]
    descending: bool | list[bool] = False


class DeduplicateConfig(BaseModel):
    subset: list[str] | None = None
    keep: Literal["first", "last", "any", "none"] = "any"


class ExpressionColumnSpec(BaseModel):
    alias: str
    expression: dict


class ExpressionConfig(BaseModel):
    columns: list[ExpressionColumnSpec]


TRANSFORM_CONFIG_MODELS: dict[str, type[BaseModel]] = {
    "transform.select": SelectConfig,
    "transform.filter": FilterConfig,
    "transform.rename": RenameConfig,
    "transform.cast": CastConfig,
    "transform.join": JoinConfig,
    "transform.aggregate": AggregateConfig,
    "transform.sort": SortConfig,
    "transform.deduplicate": DeduplicateConfig,
    "transform.expression": ExpressionConfig,
}
