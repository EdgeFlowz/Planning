import polars as pl

from app.domain.models import NodeMetadata
from app.transformations.base import single_input
from app.transformations.expressions import compile_expression
from app.transformations.schemas import ExpressionConfig


class CalculateTransform:
    """Implements transform.expression: adds calculated columns."""
    metadata: NodeMetadata = NodeMetadata(
        type="transform.expression",
        name="Calculate Transform",
        description="Adds calculated columns based on specified expressions.",
        category="transformation",
        version=1,
        config_schema=ExpressionConfig.model_json_schema(),
    )

    def apply(self, inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame:
        columns = [compile_expression(col["expression"]).alias(col["alias"]) for col in config["columns"]]
        return single_input(inputs).with_columns(columns)
