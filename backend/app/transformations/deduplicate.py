import polars as pl

from app.domain.models import NodeMetadata
from app.transformations.base import single_input
from app.transformations.schemas import DeduplicateConfig


class DeduplicateTransform:
    metadata: NodeMetadata = NodeMetadata(
        type="transform.deduplicate",
        name="Deduplicate Transform",
        description="Remove duplicate rows based on specified columns.",
        category="transformation",
        version=1,
        config_schema=DeduplicateConfig.model_json_schema(),
    )

    def apply(self, inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame:
        return single_input(inputs).unique(subset=config.get("subset"), keep=config.get("keep", "any"))
