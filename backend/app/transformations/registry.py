"""Registry mapping transform node types to their Transform implementation.

The executor looks nodes up here — it never needs to know how a given
transform type actually manipulates a LazyFrame.
"""

from __future__ import annotations

import polars as pl

from app.domain.models import NodeMetadata
from app.transformations.aggregate import AggregateTransform
from app.transformations.base import Transform
from app.transformations.calculate import CalculateTransform
from app.transformations.cast import CastTransform
from app.transformations.conditional import ConditionalTransform
from app.transformations.deduplicate import DeduplicateTransform
from app.transformations.filter import FilterTransform
from app.transformations.join import JoinTransform
from app.transformations.rename import RenameTransform
from app.transformations.select import SelectTransform
from app.transformations.sort import SortTransform

TRANSFORMS: dict[str, Transform] = {
    "transform.select": SelectTransform(),
    "transform.filter": FilterTransform(),
    "transform.rename": RenameTransform(),
    "transform.cast": CastTransform(),
    "transform.join": JoinTransform(),
    "transform.aggregate": AggregateTransform(),
    "transform.sort": SortTransform(),
    "transform.deduplicate": DeduplicateTransform(),
    "transform.expression": CalculateTransform(),
    "transform.conditional": ConditionalTransform(),
}


def get_transform(node_type: str) -> Transform:
    try:
        return TRANSFORMS[node_type]
    except KeyError:
        raise KeyError(f"No transform registered for node type '{node_type}'") from None

def get_transform_metadata(node_type: str) -> NodeMetadata:
    return get_transform(node_type).metadata


def apply_transform(node_type: str, inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame | dict[str, pl.LazyFrame]:
    """Apply the transform registered for `node_type` to the given upstream frame(s).

    Returns a single LazyFrame for ordinary single-output transforms, or a dict of named
    LazyFrames (keyed by output port) for a multi-output transform like transform.conditional.
    """
    return get_transform(node_type).apply(inputs, config)
