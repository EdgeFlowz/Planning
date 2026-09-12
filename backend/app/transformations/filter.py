import polars as pl

from app.transformations.base import single_input
from app.transformations.expressions import compile_expression


class FilterTransform:
    def apply(self, inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame:
        return single_input(inputs).filter(compile_expression(config["expression"]))
