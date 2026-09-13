import polars as pl

from app.connectors.schemas import ParquetSinkConfig, ParquetSourceConfig
from app.domain.models import NodeMetadata


class ParquetSource:
    metadata = NodeMetadata(
        type="source.parquet",
        name="Parquet Source",
        description="Read data from a Parquet file.",
        category="source",
        version=1,
        config_schema=ParquetSourceConfig.model_json_schema(),
    )

    def read(self, config: dict) -> pl.LazyFrame:
        return pl.scan_parquet(config["path"])


class ParquetSink:
    metadata = NodeMetadata(
        type="sink.parquet",
        name="Parquet Sink",
        description="Write data to a Parquet file.",
        category="sink",
        version=1,
        config_schema=ParquetSinkConfig.model_json_schema(),
    )

    def write(self, lf: pl.LazyFrame, config: dict) -> None:
        lf.sink_parquet(config["path"])
