# Day 1 — Backend Overview

What exists today, where it lives, and how the pieces fit together.

## Architecture

```
Pipeline JSON
      │
      ▼
domain/models.py        <- what IS a pipeline (Node, Edge, PipelineDefinition)
      │
      ▼
domain/validator.py     <- structural checks (cycles, unknown edges, duplicate ids, ...)
      │
      ▼
execution/executor.py   <- the conductor: walks nodes in dependency order
      │
      ├──► connectors/registry.py   ──► csv.py / parquet.py   (read/write data)
      ├──► transformations/registry.py ──► select.py, filter.py, ... (Polars ops)
      │
      ▼
   Polars LazyFrame
```

The executor never contains logic for how a specific node type works — it only asks the
connector/transform registries for an implementation and calls it. This mirrors the
"conductor vs. instruments" split from the requirements doc (§31 Plugin Architecture).

## `app/domain/` — what a pipeline *is*

- **`models.py`** — Pydantic models: `Node` (`id`, `type`, `config: dict`), `Edge`
  (`source`, `target`), `PipelineDefinition` (`schema_version`, `pipeline_id`, `nodes`, `edges`).
- **`validator.py`** — `validate_pipeline(pipeline) -> list[ValidationIssue]`. Checks (all
  collected, not fail-fast):
  - duplicate node ids
  - edges referencing unknown source/target node ids
  - unsupported node types (must be in `SUPPORTED_NODE_TYPES`)
  - at least one `source.*` node present
  - no cycles (DFS with white/gray/black coloring)

  `SUPPORTED_NODE_TYPES` is the master list of every node type the system knows about —
  15 types: `source.csv`, `source.parquet`, `source.sql`, 9 `transform.*` types, `sink.csv`,
  `sink.parquet`, `sink.sql`. Not all of them are implemented yet (see Gaps below).

## `app/transformations/` — how transforms operate

One class per transform type, each implementing a shared `Transform` protocol
(`base.py`): `apply(inputs: list[pl.LazyFrame], config: dict) -> pl.LazyFrame`.
`inputs` is a list (not a single frame) so `join` can take two upstream frames while
everything else just uses `single_input()`.

| File | Node type | Config shape |
|---|---|---|
| `select.py` | `transform.select` | `{"columns": [...]}` |
| `filter.py` | `transform.filter` | `{"expression": <DSL>}` |
| `rename.py` | `transform.rename` | `{"mapping": {old: new}}` |
| `cast.py` | `transform.cast` | `{"columns": {col: dtype_name}}` |
| `join.py` | `transform.join` | `{"how", "on"}` or `{"how", "left_on", "right_on"}` (2 inputs) |
| `aggregate.py` | `transform.aggregate` | `{"group_by": [...], "aggregations": [{"column","function","alias"}]}` |
| `sort.py` | `transform.sort` | `{"by": [...], "descending"}` |
| `deduplicate.py` | `transform.deduplicate` | `{"subset", "keep"}` |
| `calculate.py` | `transform.expression` | `{"columns": [{"alias","expression"}]}` (adds calculated columns) |

- **`expressions.py`** — compiles the declarative expression DSL from requirements.md §7.2
  (`{"type": "column"/"literal"/"binary_operation", ...}`) into a `pl.Expr`. Shared by
  `filter.py` and `calculate.py`.
- **`schemas.py`** — a Pydantic config model per transform (`SelectConfig`, `FilterConfig`,
  etc.) used to generate JSON Schema for the node catalog.
- **`registry.py`** — `TRANSFORMS: dict[node_type -> instance]`, plus `get_transform()` /
  `apply_transform()`.

## `app/connectors/` — how data gets in and out

- **`base.py`** — `SourceConnector.read(config) -> pl.LazyFrame`,
  `SinkConnector.write(lf, config) -> None` protocols.
- **`csv.py`** — `CSVSource` (`pl.scan_csv`), `CSVSink` (`lf.sink_csv`).
- **`parquet.py`** — `ParquetSource` (`pl.scan_parquet`), `ParquetSink` (`lf.sink_parquet`).
- **`registry.py`** — `SOURCES`/`SINKS` dicts + `get_source()`/`get_sink()`.

Only CSV and Parquet are implemented. `source.sql`/`sink.sql` are declared as supported
node types but have no connector — using them raises `KeyError` at execution time.

Paths in `config.path` resolve relative to the server process's working directory, not
the pipeline JSON's location, and the parent directory must already exist (Polars does
not create missing folders).

## `app/execution/` — what order things run in

- **`planner.py`** — `topological_order(pipeline) -> list[node_id]` (Kahn's algorithm) and
  `predecessors(pipeline) -> dict[node_id, list[parent_id]]` (in edge order, so a join's
  two inputs land in a predictable order).
- **`executor.py`** — `execute_pipeline(pipeline) -> dict[node_id, pl.LazyFrame]`:
  1. Runs `validate_pipeline`; raises `PipelineValidationError` if anything's wrong.
  2. Computes execution order + predecessors.
  3. For each node, in order: gathers its upstream `LazyFrame`(s), then dispatches to
     `get_source()` (if `source.*`), `get_sink()` (if `sink.*`), or `apply_transform()`
     (everything else).
  4. Sink nodes physically write their output as a side effect; their "output" frame is
     just passed through.

## `app/catalog.py` + `app/main.py` — the API

- **`catalog.py`** — `NODE_CATALOG: list[NodeTypeDefinition]`, one entry per
  `SUPPORTED_NODE_TYPES` value: `type`, `category`, `display_name`, `implemented`
  (`False` for the unbuilt connectors), `config_schema` (real JSON Schema for the 9
  implemented transforms, `{}` otherwise). This is the frontend's contract — a form
  builder can be driven directly off it instead of reading Python.
- **`main.py`** — FastAPI app with two endpoints:
  - `GET /nodes` → returns `NODE_CATALOG`.
  - `POST /pipelines/run` → accepts a `PipelineDefinition` JSON body, runs it via
    `execute_pipeline`, and returns row/column counts per node (not the raw data — sinks
    still write their files as a side effect). Validation failures → `422` with the list
    of `ValidationIssue`s; runtime errors (bad config, unimplemented connector) → `400`.

  This runs synchronously inside the request handler, which is fine for local dev but
  not the target architecture — requirements.md §2.3 calls for execution to happen in a
  separate worker process, not the API process.

## Tests (`backend/tests/`)

- `test_pipeline.py` — validator: valid pipeline, unknown edge, cycle, duplicate id,
  unsupported type.
- `test_executor.py` — end-to-end source → transform → sink, plus a join with two inputs.
- `test_catalog.py` — `/nodes` returns every supported type; implemented transforms carry
  a real config schema.
- `test_api.py` — `/pipelines/run` happy path and a validation-failure (`422`) case.

Run everything with `cd backend && uv run pytest`.

## Running the API locally

```bash
cd backend
uv run uvicorn app.main:app --reload --port 8000
```

- `GET  http://127.0.0.1:8000/nodes`
- `POST http://127.0.0.1:8000/pipelines/run` with a `PipelineDefinition` JSON body
- `GET  http://127.0.0.1:8000/docs` — interactive Swagger UI

`example_data/sales_pipeline.json` is a working end-to-end example (CSV source → select →
filter → calculated column → aggregate → Parquet sink).

## Known gaps / next steps

- No Postgres/SQL, S3, or other connectors — only CSV and Parquet.
- No config-shape validation at execution time (the Pydantic models in `schemas.py` are
  only used for the catalog's JSON Schema, not enforced before a node runs).
- Pipeline execution is synchronous inside the API process — no worker/queue yet.
- No persistence layer (Workspace/Pipeline/PipelineVersion/PipelineRun from
  requirements.md §4 don't exist yet — everything is stateless, request-scoped).
- No frontend yet.
