"""Pydantic config schemas for each registered connector, used for catalog generation."""

from __future__ import annotations

from pydantic import BaseModel


class CsvSourceConfig(BaseModel):
    path: str
    delimiter: str = ","
    header: bool = True



class CsvSinkConfig(BaseModel):
    path: str


class ParquetSourceConfig(BaseModel):
    path: str


class ParquetSinkConfig(BaseModel):
    path: str
