import polars as pl

from app.domain.models import NodeMetadata
from app.transformations.schemas import JoinConfig


class JoinTransform:
    metadata: NodeMetadata = NodeMetadata(
        type="transform.join",
        name="Join Transform",
        description="Join two data frames based on specified keys.",
        category="transformation",
        version=1,
        config_schema=JoinConfig.model_json_schema(),
        input_ports=("left", "right"),
        output_ports=("output",)
    )

    def apply(self, inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame:
        if len(inputs) != 2:
            raise ValueError(f"transform.join expects exactly 2 input frames, got {len(inputs)}")
        left, right = inputs
        how = config.get("how", "inner")
        if "on" in config:
            return left.join(right, on=config["on"], how=how)
        return left.join(right, left_on=config["left_on"], right_on=config["right_on"], how=how)
