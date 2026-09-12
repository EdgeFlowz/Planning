import polars as pl

from app.transformations.base import single_input


class DeduplicateTransform:
    def apply(self, inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame:
        return single_input(inputs).unique(subset=config.get("subset"), keep=config.get("keep", "any"))
