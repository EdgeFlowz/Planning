import polars as pl

from app.transformations.base import single_input


class SelectTransform:
    def apply(self, inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame:
        return single_input(inputs).select(config["columns"])
