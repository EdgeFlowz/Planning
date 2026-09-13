import polars as pl

from app.domain.models import NodeMetadata
from app.transformations.base import single_input
from app.transformations.schemas import SelectConfig


class SelectTransform:

    metadata = NodeMetadata(
        type="transform.select",
        name="Select Transform",
        description="Select specific columns from the input data.",
        category="transformation",
        version=1,
        config_schema=SelectConfig.model_json_schema(),
    )
    def apply(self, inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame:
        return single_input(inputs).select(config["columns"])
