"""Background worker service for async pipeline execution.

This service runs separately from the API and continuously processes
jobs from the Redis queue. It handles:
- Job pickup and execution
- Status updates
- Retry logic
- Error handling
- Graceful shutdown

Usage:
    python -m worker.main              # Run single worker
    python -m worker.main --workers=3  # Run 3 worker processes
"""

import argparse
import logging
import signal
import sys
from redis import Redis
from rq import Queue, SimpleWorker
from rq.job import Job as RQJob

from worker.config import worker_settings

# Configure logging
logging.basicConfig(
    level=worker_settings.log_level,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def get_redis_connection() -> Redis:
    """Get Redis connection with RQ-compatible defaults.
    
    Uses redis-py defaults:
    - decode_responses defaults to False (returns bytes)
    - encoding defaults to 'utf-8' (internal command encoding)
    
    This allows RQ's pickle serializer to work correctly.
    """
    return Redis(
        host=worker_settings.redis_host,
        port=worker_settings.redis_port,
        db=worker_settings.redis_db,
    )


def create_worker(name: str = None) -> SimpleWorker:
    """Create an RQ SimpleWorker instance.

    We use SimpleWorker (runs jobs in-process) instead of the default fork-based
    Worker. On macOS, forking a process that has already touched the Objective-C
    runtime (via polars/SQLAlchemy threads, etc.) crashes with SIGABRT - this is
    enforced unconditionally by the OS and cannot be disabled via
    OBJC_DISABLE_INITIALIZE_FORK_SAFETY on current macOS versions. SimpleWorker
    avoids fork() entirely, at the cost of not isolating crashed jobs from the
    worker process itself (a hard crash in a job takes the worker down).

    Note: Job timeout is set when enqueueing (in JobQueueClient.enqueue_pipeline),
    not on the worker itself. The worker just executes whatever timeout was specified.
    We disable use_intermediate_queue to avoid RQ 2.x serialization issues.
    """
    if name is None:
        name = worker_settings.worker_name

    redis_conn = get_redis_connection()
    queue = Queue(connection=redis_conn, use_intermediate_queue=False)

    # Create worker with minimal required parameters
    # Job timeout and TTLs are set at enqueue time, not worker creation time
    return SimpleWorker(
        [queue],
        connection=redis_conn,
        name=name,
    )


def handle_shutdown(signum, frame):
    """Handle graceful shutdown on SIGTERM or SIGINT."""
    logger.info("Shutdown signal received, stopping worker...")
    sys.exit(0)


def run_worker(num_workers: int = 1) -> None:
    """Run worker(s) to process jobs from the queue.

    Args:
        num_workers: Number of worker processes to spawn (1 for single-threaded)
    """
    logger.info(f"Starting {num_workers} worker(s)...")
    logger.info(f"Redis: {worker_settings.redis_host}:{worker_settings.redis_port}")
    logger.info(f"Database: {worker_settings.database_url}")
    logger.info(f"Job timeout: {worker_settings.worker_timeout}s ({worker_settings.worker_timeout/3600:.1f}h)")

    # Setup signal handlers for graceful shutdown
    signal.signal(signal.SIGTERM, handle_shutdown)
    signal.signal(signal.SIGINT, handle_shutdown)

    if num_workers == 1:
        # Single worker process
        worker = create_worker()
        logger.info(f"Worker '{worker.name}' started, processing jobs...")
        try:
            worker.work()
        except KeyboardInterrupt:
            logger.info("Worker interrupted by user")
    else:
        # Multiple worker processes (requires multiprocessing)
        import multiprocessing as mp
        processes = []

        try:
            for i in range(num_workers):
                worker_name = f"{worker_settings.worker_name}-{i+1}"
                p = mp.Process(
                    target=run_single_worker,
                    args=(worker_name,),
                    name=worker_name,
                )
                p.start()
                processes.append(p)
                logger.info(f"Started worker process {i+1}/{num_workers}: {worker_name}")

            # Wait for all processes
            for p in processes:
                p.join()

        except KeyboardInterrupt:
            logger.info("Terminating all worker processes...")
            for p in processes:
                p.terminate()
            for p in processes:
                p.join(timeout=5)
                if p.is_alive():
                    p.kill()


def run_single_worker(name: str) -> None:
    """Run a single worker process (for multiprocessing)."""
    worker = create_worker(name=name)
    logger.info(f"Worker '{name}' started, processing jobs...")
    worker.work()


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Background worker for async pipeline execution"
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=1,
        help="Number of worker processes (default: 1)",
    )
    parser.add_argument(
        "--name",
        type=str,
        default=None,
        help=f"Worker name (default: {worker_settings.worker_name})",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=None,
        help=f"Job timeout in seconds (default: {worker_settings.worker_timeout})",
    )

    args = parser.parse_args()

    if args.timeout:
        worker_settings.worker_timeout = args.timeout

    try:
        run_worker(num_workers=args.workers)
    except Exception as e:
        logger.error(f"Worker error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
