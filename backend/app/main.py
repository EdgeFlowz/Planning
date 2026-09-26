import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.catalog import NODE_CATALOG, NodeTypeDefinition
from app.domain.models import PipelineDefinition
from app.domain.validator import PipelineValidationError
from app.execution.executor import execute_pipeline

# Create uploads directory for temporary file storage
UPLOAD_DIR = Path("./uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Pipeline Builder API")


@app.get("/nodes", response_model=list[NodeTypeDefinition])
def list_node_types() -> list[NodeTypeDefinition]:
    """Return every node type the frontend can offer, with its config JSON schema."""
    return NODE_CATALOG


class UploadResponse(BaseModel):
    path: str


@app.post("/upload", response_model=UploadResponse)
async def upload_file(file: UploadFile = File(...)) -> UploadResponse:
    """Upload a CSV or Parquet file and return its server-side path.
    
    The returned path can be used directly in source.csv/source.parquet node configs.
    Files are stored in ./uploads/ with UUID-based names to avoid collisions.
    """
    try:
        # Generate unique filename to avoid collisions
        file_ext = Path(file.filename or "").suffix or ".bin"
        unique_name = f"{uuid.uuid4()}{file_ext}"
        file_path = UPLOAD_DIR / unique_name

        # Read and save file
        contents = await file.read()
        with open(file_path, "wb") as f:
            f.write(contents)

        # Return absolute path for backend to use
        return UploadResponse(path=str(file_path.resolve()))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to upload file: {str(exc)}") from exc


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
