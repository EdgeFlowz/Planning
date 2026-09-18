from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from app.catalog import NODE_CATALOG, NodeTypeDefinition
from app.domain.models import PipelineDefinition
from app.domain.validator import PipelineValidationError
from app.execution.executor import execute_pipeline

app = FastAPI(title="Pipeline Builder API")


@app.get("/nodes", response_model=list[NodeTypeDefinition])
def list_node_types() -> list[NodeTypeDefinition]:
    """Return every node type the frontend can offer, with its config JSON schema."""
    return NODE_CATALOG


class NodeResult(BaseModel):
    node_id: str
    node_type: str
    port: str
    rows: int
    columns: list[str]


class PipelineRunResult(BaseModel):
    pipeline_id: str
    node_results: list[NodeResult]


@app.post("/pipelines/run", response_model=PipelineRunResult)
def run_pipeline(pipeline: PipelineDefinition) -> PipelineRunResult:
    """Validate and execute a pipeline definition, returning row/column counts per node.

    This runs synchronously in the API process, which is fine for local development
    but not the target architecture (see requirements.md 2.3) — real execution should
    be handed off to a worker process.
    """
    try:
        outputs = execute_pipeline(pipeline)
    except PipelineValidationError as exc:
        raise HTTPException(status_code=422, detail=[issue.__dict__ for issue in exc.issues]) from exc
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    node_types = {node.id: node.type for node in pipeline.nodes}
    node_results = []
    for key, lazy_frame in outputs.items():
        node_id, _, port = key.partition(":")
        frame = lazy_frame.collect()
        node_results.append(
            NodeResult(
                node_id=node_id,
                node_type=node_types[node_id],
                port=port or "output",
                rows=frame.height,
                columns=frame.columns,
            )
        )

    return PipelineRunResult(pipeline_id=pipeline.pipeline_id, node_results=node_results)
