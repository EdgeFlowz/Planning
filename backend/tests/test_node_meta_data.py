from app.transformations.select import SelectTransform


def test_select_transform_metadata():
    metadata = SelectTransform.metadata

    assert metadata.type == "transform.select"
    assert metadata.name == "Select Transform"
    assert metadata.description == "Select specific columns from the input data."
    assert metadata.category == "transformation"
    assert metadata.version == 1