"""Pydantic config schemas for each registered transform, used for validation and catalog generation.

Fields that must be filled in from a column name the backend can't know statically (it depends on
whatever flows into the node at runtime) carry an `x-widget: "column"` / `"column-map"` JSON Schema
extra. The frontend's generic config-form renderer resolves those against the node's actual upstream
columns instead of rendering a free-text box; everything else in these schemas — types, enums,
required-ness, nesting — is plain JSON Schema and needs no special handling.
"""

from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field

BinaryOperator = Literal["==", "!=", ">", ">=", "<", "<=", "and", "or", "+", "-", "*", "/"]


class ColumnExpr(BaseModel):
    model_config = ConfigDict(title="Column")

    type: Literal["column"] = "column"
    name: str = Field(json_schema_extra={"x-widget": "column"})


class LiteralExpr(BaseModel):
    model_config = ConfigDict(title="Fixed value")

    type: Literal["literal"] = "literal"
    value: str | float | int | bool


class BinaryExpr(BaseModel):
    model_config = ConfigDict(title="Operation")

    type: Literal["binary_operation"] = "binary_operation"
    operator: BinaryOperator
    left: "Expression"
    right: "Expression"


# Recursive, discriminated on `type` — mirrors expressions.py's compile_expression grammar exactly,
# so the catalog schema and what the executor actually accepts never drift apart.
Expression = Annotated[Union[ColumnExpr, LiteralExpr, BinaryExpr], Field(discriminator="type")]
BinaryExpr.model_rebuild()


class SelectConfig(BaseModel):
    columns: list[str] = Field(json_schema_extra={"x-widget": "column"})


class FilterConfig(BaseModel):
    # Root must be an operation — a bare column or fixed value isn't a usable filter predicate.
    expression: BinaryExpr


class RenameConfig(BaseModel):
    mapping: dict[str, str] = Field(json_schema_extra={"x-widget": "column-map"})


CastType = Literal[
    "string",
    "boolean",
    "int8",
    "int16",
    "int32",
    "int64",
    "uint8",
    "uint16",
    "uint32",
    "uint64",
    "float32",
    "float64",
    "date",
    "datetime",
]


class CastConfig(BaseModel):
    columns: dict[str, CastType] = Field(json_schema_extra={"x-widget": "column-map"})


class JoinConfig(BaseModel):
    how: Literal["inner", "left", "right", "full", "semi", "anti", "cross"] = "inner"
    on: str | list[str] | None = Field(default=None, json_schema_extra={"x-widget": "column"})
    left_on: str | list[str] | None = Field(default=None, json_schema_extra={"x-widget": "column"})
    right_on: str | list[str] | None = Field(default=None, json_schema_extra={"x-widget": "column"})


class AggregationSpec(BaseModel):
    column: str = Field(json_schema_extra={"x-widget": "column"})
    function: Literal["sum", "mean", "min", "max", "count", "median", "std", "n_unique", "first", "last"]
    alias: str | None = None


class AggregateConfig(BaseModel):
    group_by: list[str] = Field(default=[], json_schema_extra={"x-widget": "column"})
    aggregations: list[AggregationSpec]


class SortConfig(BaseModel):
    by: list[str] = Field(json_schema_extra={"x-widget": "column"})
    descending: bool | list[bool] = False


class DeduplicateConfig(BaseModel):
    subset: list[str] | None = Field(default=None, json_schema_extra={"x-widget": "column"})
    keep: Literal["first", "last", "any", "none"] = "any"


class ExpressionColumnSpec(BaseModel):
    alias: str
    # Root must be an operation — a bare column copy or constant belongs in select/rename instead.
    expression: BinaryExpr


class ExpressionConfig(BaseModel):
    columns: list[ExpressionColumnSpec]
