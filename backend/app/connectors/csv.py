import polars as pl


class CSVSource:
    def read(self, config: dict) -> pl.LazyFrame:
        return pl.scan_csv(config["path"])


class CSVSink:
    def write(self, lf: pl.LazyFrame, config: dict) -> None:
        lf.sink_csv(config["path"])
