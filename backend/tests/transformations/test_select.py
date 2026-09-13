

from app.transformations.registry import get_transform_metadata


def test_get_transform_metadata():
    metadata = get_transform_metadata("transform.select")

    assert metadata.type == "transform.select"
    assert metadata.name == "Select Transform"
    assert metadata.version == 1