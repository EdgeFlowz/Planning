"""Registry mapping transform node types to Polars LazyFrame operations."""

from __future__ import annotations

from typing import Callable

import polars as pl

TransformFn = Callable[[list[pl.LazyFrame], dict], pl.LazyFrame]

_REGISTRY: dict[str, TransformFn] = {}


def register(node_type: str) -> Callable[[TransformFn], TransformFn]:
    def decorator(fn: TransformFn) -> TransformFn:
        _REGISTRY[node_type] = fn
        return fn

    return decorator


def get_transform(node_type: str) -> TransformFn:
    try:
        return _REGISTRY[node_type]
    except KeyError:
        raise KeyError(f"No transform registered for node type '{node_type}'") from None


def apply_transform(node_type: str, inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame:
    """Apply the transform registered for `node_type` to the given upstream frame(s)."""
    return get_transform(node_type)(inputs, config)


def _single(inputs: list[pl.LazyFrame]) -> pl.LazyFrame:
    if len(inputs) != 1:
        raise ValueError(f"Expected exactly one input frame, got {len(inputs)}")
    return inputs[0]


# --- Declarative expression DSL (see requirements.md section 7.2) ---

_BINARY_OPERATORS: dict[str, Callable[[pl.Expr, pl.Expr], pl.Expr]] = {
    ">": lambda l, r: l > r,
    ">=": lambda l, r: l >= r,
    "<": lambda l, r: l < r,
    "<=": lambda l, r: l <= r,
    "==": lambda l, r: l == r,
    "!=": lambda l, r: l != r,
    "and": lambda l, r: l & r,
    "or": lambda l, r: l | r,
    "+": lambda l, r: l + r,
    "-": lambda l, r: l - r,
    "*": lambda l, r: l * r,
    "/": lambda l, r: l / r,
}


def compile_expression(expr: dict) -> pl.Expr:
    """Compile a declarative expression node into a Polars expression."""
    expr_type = expr["type"]
    if expr_type == "column":
        return pl.col(expr["name"])
    if expr_type == "literal":
        return pl.lit(expr["value"])
    if expr_type == "binary_operation":
        try:
            operator = _BINARY_OPERATORS[expr["operator"]]
        except KeyError:
            raise ValueError(f"Unsupported operator '{expr['operator']}'") from None
        return operator(compile_expression(expr["left"]), compile_expression(expr["right"]))
    raise ValueError(f"Unsupported expression type '{expr_type}'")


@register("transform.select")
def _select(inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame:
    return _single(inputs).select(config["columns"])


@register("transform.filter")
def _filter(inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame:
    return _single(inputs).filter(compile_expression(config["expression"]))


@register("transform.rename")
def _rename(inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame:
    return _single(inputs).rename(config["mapping"])


_DTYPES: dict[str, pl.DataType] = {
    "int8": pl.Int8,
    "int16": pl.Int16,
    "int32": pl.Int32,
    "int64": pl.Int64,
    "uint8": pl.UInt8,
    "uint16": pl.UInt16,
    "uint32": pl.UInt32,
    "uint64": pl.UInt64,
    "float32": pl.Float32,
    "float64": pl.Float64,
    "boolean": pl.Boolean,
    "bool": pl.Boolean,
    "string": pl.String,
    "str": pl.String,
    "utf8": pl.String,
    "date": pl.Date,
    "datetime": pl.Datetime,
}


def _resolve_dtype(name: str) -> pl.DataType:
    try:
        return _DTYPES[name.lower()]
    except KeyError:
        raise ValueError(f"Unsupported cast dtype '{name}'") from None


@register("transform.cast")
def _cast(inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame:
    dtypes = {column: _resolve_dtype(dtype) for column, dtype in config["columns"].items()}
    return _single(inputs).cast(dtypes)


@register("transform.join")
def _join(inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame:
    if len(inputs) != 2:
        raise ValueError(f"transform.join expects exactly 2 input frames, got {len(inputs)}")
    left, right = inputs
    how = config.get("how", "inner")
    if "on" in config:
        return left.join(right, on=config["on"], how=how)
    return left.join(right, left_on=config["left_on"], right_on=config["right_on"], how=how)


_AGG_FUNCTIONS: dict[str, Callable[[pl.Expr], pl.Expr]] = {
    "sum": pl.Expr.sum,
    "mean": pl.Expr.mean,
    "min": pl.Expr.min,
    "max": pl.Expr.max,
    "count": pl.Expr.count,
    "median": pl.Expr.median,
    "std": pl.Expr.std,
    "n_unique": pl.Expr.n_unique,
    "first": pl.Expr.first,
    "last": pl.Expr.last,
}


@register("transform.aggregate")
def _aggregate(inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame:
    frame = _single(inputs)
    aggregations = []
    for spec in config["aggregations"]:
        try:
            func = _AGG_FUNCTIONS[spec["function"]]
        except KeyError:
            raise ValueError(f"Unsupported aggregation function '{spec['function']}'") from None
        alias = spec.get("alias", f"{spec['function']}_{spec['column']}")
        aggregations.append(func(pl.col(spec["column"])).alias(alias))

    group_by = config.get("group_by", [])
    if group_by:
        return frame.group_by(group_by).agg(aggregations)
    return frame.select(aggregations)


@register("transform.sort")
def _sort(inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame:
    return _single(inputs).sort(config["by"], descending=config.get("descending", False))


@register("transform.deduplicate")
def _deduplicate(inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame:
    return _single(inputs).unique(subset=config.get("subset"), keep=config.get("keep", "any"))


@register("transform.expression")
def _expression(inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame:
    columns = [compile_expression(col["expression"]).alias(col["alias"]) for col in config["columns"]]
    return _single(inputs).with_columns(columns)
