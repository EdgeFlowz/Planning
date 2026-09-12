import polars as pl

from app.transformations.base import single_input

_DTYPES: dict[str, pl.DataType] = {
    "int8": pl.Int8,
    "int16": pl.Int16,
    "int32": pl.Int32,
    "int64": pl.Int64,
    "uint8": pl.UInt8,
    "uint16": pl.UInt16,
    "uint32": pl.UInt32,
    "uint64": pl.UInt64,
    "float32": pl.Float32,
    "float64": pl.Float64,
    "boolean": pl.Boolean,
    "bool": pl.Boolean,
    "string": pl.String,
    "str": pl.String,
    "utf8": pl.String,
    "date": pl.Date,
    "datetime": pl.Datetime,
}


def _resolve_dtype(name: str) -> pl.DataType:
    try:
        return _DTYPES[name.lower()]
    except KeyError:
        raise ValueError(f"Unsupported cast dtype '{name}'") from None


class CastTransform:
    def apply(self, inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame:
        dtypes = {column: _resolve_dtype(dtype) for column, dtype in config["columns"].items()}
        return single_input(inputs).cast(dtypes)
