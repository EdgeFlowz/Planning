import polars as pl

from app.domain.models import NodeMetadata
from app.transformations.base import single_input
from app.transformations.expressions import compile_expression
from app.transformations.schemas import FilterConfig


class FilterTransform:
    metadata: NodeMetadata = NodeMetadata(
        type="transform.filter",
        name="Filter Transform",
        description="Filter rows based on a specified expression.",
        category="transformation",
        version=1,
        config_schema=FilterConfig.model_json_schema(),
    )
    def apply(self, inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame:
        return single_input(inputs).filter(compile_expression(config["expression"]))
