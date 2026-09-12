from fastapi import FastAPI

from app.catalog import NODE_CATALOG, NodeTypeDefinition

app = FastAPI(title="Pipeline Builder API")


@app.get("/nodes", response_model=list[NodeTypeDefinition])
def list_node_types() -> list[NodeTypeDefinition]:
    """Return every node type the frontend can offer, with its config JSON schema."""
    return NODE_CATALOG
