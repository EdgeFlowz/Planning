import polars as pl

from app.transformations.base import single_input
from app.transformations.expressions import compile_expression


class CalculateTransform:
    """Implements transform.expression: adds calculated columns."""

    def apply(self, inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame:
        columns = [compile_expression(col["expression"]).alias(col["alias"]) for col in config["columns"]]
        return single_input(inputs).with_columns(columns)
