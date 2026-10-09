"""Redis and job queue configuration."""

from redis import Redis
from rq import Queue

from app.config import settings


def get_redis_connection() -> Redis:
    """Get Redis connection using settings.
    
    Uses redis-py defaults which are RQ-compatible:
    - decode_responses defaults to False (returns bytes)
    - encoding defaults to 'utf-8' (used internally for command encoding)
    
    This allows RQ to receive raw bytes for pickle deserialization.
    """
    return Redis(
        host=settings.redis_host,
        port=settings.redis_port,
        db=settings.redis_db,
    )


def get_job_queue() -> Queue:
    """Get RQ job queue.
    
    Note: We disable use_intermediate_queue to avoid RQ 2.x serialization issues
    with the intermediate_queue.cleanup() method. The intermediate queue is an
    optimization for job state tracking that we don't need.
    """
    redis_conn = get_redis_connection()
    return Queue(connection=redis_conn, use_intermediate_queue=False)
