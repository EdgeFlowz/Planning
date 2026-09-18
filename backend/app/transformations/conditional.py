import polars as pl

from app.domain.models import NodeMetadata
from app.transformations.base import single_input
from app.transformations.expressions import compile_expression
from app.transformations.schemas import ConditionalConfig


class ConditionalTransform:
    """A branching node: one input, two named outputs ("true"/"false") instead of one."""

    metadata = NodeMetadata(
        type="transform.conditional",
        name="Conditional Transform",
        description="Splits input rows into two branches based on whether a condition is true or false.",
        category="transformation",
        version=1,
        config_schema=ConditionalConfig.model_json_schema(),
        input_ports=("input",),
        output_ports=("true", "false"),
    )

    def apply(self, inputs: list[pl.LazyFrame], config: dict) -> dict[str, pl.LazyFrame]:
        lf = single_input(inputs)
        predicate = compile_expression(config["condition"])
        return {"true": lf.filter(predicate), "false": lf.filter(~predicate)}
