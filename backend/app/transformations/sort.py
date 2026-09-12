import polars as pl

from app.transformations.base import single_input


class SortTransform:
    def apply(self, inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame:
        return single_input(inputs).sort(config["by"], descending=config.get("descending", False))
