import polars as pl


class JoinTransform:
    def apply(self, inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame:
        if len(inputs) != 2:
            raise ValueError(f"transform.join expects exactly 2 input frames, got {len(inputs)}")
        left, right = inputs
        how = config.get("how", "inner")
        if "on" in config:
            return left.join(right, on=config["on"], how=how)
        return left.join(right, left_on=config["left_on"], right_on=config["right_on"], how=how)
