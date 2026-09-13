import polars as pl

from app.domain.models import NodeMetadata
from app.transformations.base import single_input
from app.transformations.schemas import RenameConfig


class RenameTransform:
    metadata: NodeMetadata = NodeMetadata(
        type="transform.rename",
        name="Rename Transform",
        description="Rename columns based on a specified mapping.",
        category="transformation",
        version=1,
        config_schema=RenameConfig.model_json_schema(),
    )

    def apply(self, inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame:
        return single_input(inputs).rename(config["mapping"])
