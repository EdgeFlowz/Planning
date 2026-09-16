"""Pydantic config schemas for each registered connector, used for catalog generation."""

from __future__ import annotations

from pydantic import BaseModel, Field


class CsvSourceConfig(BaseModel):
    path: str = Field(description="Path to the CSV file, resolved relative to the server's working directory.")
    delimiter: str = ","
    header: bool = True


class CsvSinkConfig(BaseModel):
    path: str = Field(description="Destination path for the CSV file, resolved relative to the server's working directory.")


class ParquetSourceConfig(BaseModel):
    path: str = Field(description="Path to the Parquet file, resolved relative to the server's working directory.")


class ParquetSinkConfig(BaseModel):
    path: str = Field(description="Destination path for the Parquet file, resolved relative to the server's working directory.")
