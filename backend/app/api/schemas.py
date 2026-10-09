"""API request/response schemas and error models."""

from pydantic import BaseModel


# ============================================================================
# Error Response Models
# ============================================================================

class ErrorDetail(BaseModel):
    """Individual error detail."""

    code: str
    message: str
    node_id: str | None = None
    field: str | None = None


class ErrorResponse(BaseModel):
    """Structured error response per requirements.md 15."""

    error: dict
    
    class Config:
        json_schema_extra = {
            "example": {
                "error": {
                    "code": "PIPELINE_VALIDATION_FAILED",
                    "message": "The pipeline contains validation errors.",
                    "details": [
                        {
                            "node_id": "filter_1",
                            "code": "UNKNOWN_COLUMN",
                            "message": "Column 'revenue' does not exist."
                        }
                    ],
                    "request_id": "req_123"
                }
            }
        }


# ============================================================================
# Upload Response
# ============================================================================

class UploadResponse(BaseModel):
    """File upload response."""

    path: str


# ============================================================================
# Pipeline Responses
# ============================================================================

class PipelineResponse(BaseModel):
    """Pipeline metadata response."""

    id: str
    name: str
    created_at: str
    updated_at: str


class PipelineListResponse(BaseModel):
    """Paginated pipeline list."""

    pipelines: list[PipelineResponse]
    total: int
    page: int
    page_size: int


class PipelineVersionResponse(BaseModel):
    """Pipeline version response."""

    id: str
    pipeline_id: str
    version: int
    created_at: str
    checksum: str | None = None


class PipelineVersionListResponse(BaseModel):
    """List of pipeline versions."""

    versions: list[PipelineVersionResponse]
    total: int


# ============================================================================
# Run Responses
# ============================================================================

class NodeResult(BaseModel):
    """Individual node execution result."""

    node_id: str
    node_type: str
    port: str
    rows: int
    columns: list[str]


class PipelineRunResponse(BaseModel):
    """Pipeline run response."""

    id: str
    pipeline_id: str
    pipeline_version: int
    status: str
    created_at: str
    started_at: str | None = None
    completed_at: str | None = None
    error: str | None = None


class PipelineRunDetailResponse(BaseModel):
    """Detailed pipeline run with node results."""

    run: PipelineRunResponse
    node_results: list[NodeResult]


class NodeRunResponse(BaseModel):
    """Individual node run response."""

    id: str
    node_id: str
    node_type: str
    status: str
    started_at: str | None = None
    completed_at: str | None = None
    rows_read: int | None = None
    rows_written: int | None = None
    columns: list[str] | None = None
    error: str | None = None


class PipelineRunListResponse(BaseModel):
    """List of pipeline runs."""

    runs: list[PipelineRunResponse]
    total: int
    page: int
    page_size: int


# ============================================================================
# Connection Responses
# ============================================================================

class ConnectionResponse(BaseModel):
    """Connection response (config omitted in list views)."""

    id: str
    type: str
    name: str
    created_at: str


class ConnectionDetailResponse(BaseModel):
    """Connection detail response (includes config)."""

    id: str
    type: str
    name: str
    config: dict
    created_at: str


class ConnectionListResponse(BaseModel):
    """List of connections."""

    connections: list[ConnectionResponse]
    total: int


# ============================================================================
# Connector/Node Type Response
# ============================================================================

class NodeTypeResponse(BaseModel):
    """Available node type."""

    type: str
    category: str
    name: str
    description: str
    version: int
    config_schema: dict
    input_ports: tuple[str, ...] = ("input",)
    output_ports: tuple[str, ...] = ("output",)


class ConnectorListResponse(BaseModel):
    """List of available node types."""

    connectors: list[NodeTypeResponse]
    total: int


# ============================================================================
# Validation Response
# ============================================================================

class ValidationIssueResponse(BaseModel):
    """Validation issue detail."""

    code: str
    message: str
    node_id: str | None = None
    field: str | None = None


class ValidationResponse(BaseModel):
    """Pipeline validation result."""

    valid: bool
    errors: list[ValidationIssueResponse]
    warnings: list[ValidationIssueResponse]


# ============================================================================
# Job Responses (Async Execution)
# ============================================================================

class JobSubmitRequest(BaseModel):
    """Request to submit a pipeline for async execution."""

    display_name: str
    pipeline_definition: dict


class JobResponse(BaseModel):
    """Job status and metadata."""

    id: str
    display_name: str
    status: str
    result: dict | None = None
    error: str | None = None
    retry_count: int
    max_retries: int
    created_at: str
    started_at: str | None = None
    completed_at: str | None = None
    cancelled_at: str | None = None


class JobListResponse(BaseModel):
    """Paginated list of jobs."""

    jobs: list[JobResponse]
    total: int
    skip: int
    limit: int


class JobCancelRequest(BaseModel):
    """Request to cancel a job."""

    reason: str = "User requested cancellation"
