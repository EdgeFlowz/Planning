import polars as pl

from app.domain.models import NodeMetadata
from app.transformations.base import single_input
from app.transformations.schemas import SortConfig


class SortTransform:
    metadata: NodeMetadata = NodeMetadata(
        type="transform.sort",
        name="Sort Transform",
        description="Sort rows based on specified columns.",
        category="transformation",
        version=1,
        config_schema=SortConfig.model_json_schema(),
    )

    def apply(self, inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame:
        return single_input(inputs).sort(config["by"], descending=config.get("descending", False))
