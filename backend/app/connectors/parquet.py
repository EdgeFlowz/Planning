import polars as pl


class ParquetSource:
    def read(self, config: dict) -> pl.LazyFrame:
        return pl.scan_parquet(config["path"])


class ParquetSink:
    def write(self, lf: pl.LazyFrame, config: dict) -> None:
        lf.sink_parquet(config["path"])
