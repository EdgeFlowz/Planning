from typing import Callable

import polars as pl

from app.transformations.base import single_input

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


class AggregateTransform:
    def apply(self, inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame:
        frame = single_input(inputs)
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
