import polars as pl

from app.connectors.schemas import CsvSinkConfig, CsvSourceConfig
from app.domain.models import NodeMetadata


class CSVSource:
    metadata = NodeMetadata(
        type="source.csv",
        name="CSV Source",
        description="Read data from a CSV file.",
        category="source",
        version=1,
        config_schema=CsvSourceConfig.model_json_schema(),
    )

    def read(self, config: dict) -> pl.LazyFrame:
        return pl.scan_csv(config["path"])


class CSVSink:
    metadata = NodeMetadata(
        type="sink.csv",
        name="CSV Sink",
        description="Write data to a CSV file.",
        category="sink",
        version=1,
        config_schema=CsvSinkConfig.model_json_schema(),
    )

    def write(self, lf: pl.LazyFrame, config: dict) -> None:
        lf.sink_csv(config["path"])
