"""Compiler for the declarative expression DSL (see requirements.md section 7.2)."""

from __future__ import annotations

from typing import Callable

import polars as pl

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
