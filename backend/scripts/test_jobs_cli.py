#!/usr/bin/env python3
"""Simple CLI tool for end-users to test the async job queue system.

Usage:
    uv run python scripts/test_jobs_cli.py submit "My Pipeline"
    uv run python scripts/test_jobs_cli.py status <job_id>
    uv run python scripts/test_jobs_cli.py list
    uv run python scripts/test_jobs_cli.py wait <job_id>   # Poll until complete
    uv run python scripts/test_jobs_cli.py cancel <job_id>
"""

import json
import time
import sys
import argparse
from datetime import datetime
from pathlib import Path

import httpx


# Configuration
API_BASE_URL = "http://localhost:8000"
POLL_INTERVAL = 1  # seconds
POLL_TIMEOUT = 300  # 5 minutes


def pretty_print_job(job: dict) -> None:
    """Pretty print a job status."""
    print(f"\n{'='*70}")
    print(f"Job ID:          {job['id']}")
    print(f"Name:            {job['display_name']}")
    print(f"Status:          {job['status'].upper()}")
    print(f"Created:         {job['created_at']}")
    
    if job.get('started_at'):
        print(f"Started:         {job['started_at']}")
    
    if job.get('completed_at'):
        print(f"Completed:       {job['completed_at']}")
    
    if job.get('retry_count'):
        print(f"Retries:         {job['retry_count']}/{job['max_retries']}")
    
    if job.get('error'):
        print(f"\nError:\n{job['error']}")
    
    if job.get('result'):
        print(f"\nResult:")
        print(json.dumps(job['result'], indent=2))
    
    print(f"{'='*70}\n")


def submit_job(client: httpx.Client, display_name: str) -> str:
    """Submit a sample pipeline job."""
    pipeline_definition = {
        "schema_version": 1,
        "pipeline_id": "example-pipeline",
        "nodes": [
            {
                "id": "source_1",
                "type": "source.csv",
                "config": {
                    "path": "../example_data/sales.csv"
                }
            },
            {
                "id": "filter_1",
                "type": "transform.filter",
                "config": {
                    "expression": {
                        "type": "binary_operation",
                        "operator": ">",
                        "left": {"type": "column", "name": "quantity"},
                        "right": {"type": "literal", "value": 0}
                    }
                }
            },
            {
                "id": "sink_1",
                "type": "sink.csv",
                "config": {
                    "path": "results.csv"
                }
            }
        ],
        "edges": [
            {
                "source": "source_1",
                "target": "filter_1",
                "output": None,
                "input": None
            },
            {
                "source": "filter_1",
                "target": "sink_1",
                "output": None,
                "input": None
            }
        ]
    }
    
    response = client.post(
        "/v1/jobs",
        json={
            "display_name": display_name,
            "pipeline_definition": pipeline_definition
        }
    )
    
    if response.status_code == 200:
        job = response.json()
        print(f"✓ Job submitted successfully")
        pretty_print_job(job)
        return job['id']
    else:
        print(f"✗ Failed to submit job: {response.status_code}")
        print(f"  {response.text}")
        sys.exit(1)


def get_job_status(client: httpx.Client, job_id: str) -> dict:
    """Get the current status of a job."""
    response = client.get(f"/v1/jobs/{job_id}")
    
    if response.status_code == 200:
        return response.json()
    elif response.status_code == 404:
        print(f"✗ Job not found: {job_id}")
        sys.exit(1)
    else:
        print(f"✗ Error: {response.status_code}")
        print(f"  {response.text}")
        sys.exit(1)


def list_jobs(client: httpx.Client, status_filter: str = None) -> None:
    """List all jobs, optionally filtered by status."""
    params = {}
    if status_filter:
        params['status'] = status_filter
    
    response = client.get("/v1/jobs", params=params)
    
    if response.status_code == 200:
        data = response.json()
        jobs = data.get('jobs', [])
        total = data.get('total', 0)
        
        if not jobs:
            print(f"No jobs found")
            return
        
        print(f"\n{'='*70}")
        print(f"Jobs ({len(jobs)} of {total} total)")
        print(f"{'='*70}")
        
        for job in jobs:
            status_emoji = {
                'queued': '⏳',
                'running': '▶️',
                'succeeded': '✓',
                'failed': '✗',
                'cancelled': '⊘',
            }.get(job['status'], '?')
            
            print(f"{status_emoji} [{job['id'][:8]}] {job['display_name']:30} {job['status']:12} {job['created_at']}")
        
        print(f"{'='*70}\n")
    else:
        print(f"✗ Error: {response.status_code}")
        print(f"  {response.text}")
        sys.exit(1)


def wait_for_completion(client: httpx.Client, job_id: str) -> None:
    """Poll a job until it completes."""
    print(f"\n⏳ Waiting for job to complete (timeout: {POLL_TIMEOUT}s)...\n")
    
    start_time = time.time()
    last_status = None
    
    while True:
        job = get_job_status(client, job_id)
        elapsed = time.time() - start_time
        
        if job['status'] != last_status:
            timestamp = datetime.now().strftime("%H:%M:%S")
            print(f"[{timestamp}] Status: {job['status'].upper()}")
            last_status = job['status']
        
        if job['status'] in ['succeeded', 'failed', 'cancelled']:
            pretty_print_job(job)
            return
        
        if elapsed > POLL_TIMEOUT:
            print(f"\n✗ Timeout: Job did not complete within {POLL_TIMEOUT}s")
            print(f"  Current status: {job['status']}")
            sys.exit(1)
        
        time.sleep(POLL_INTERVAL)


def cancel_job(client: httpx.Client, job_id: str) -> None:
    """Cancel a job."""
    response = client.request(
        "DELETE",
        f"/v1/jobs/{job_id}",
        json={"reason": "Cancelled by user via CLI"}
    )
    
    if response.status_code == 200:
        print(f"✓ Job cancelled successfully")
        job = get_job_status(client, job_id)
        pretty_print_job(job)
    elif response.status_code == 404:
        print(f"✗ Job not found: {job_id}")
        sys.exit(1)
    elif response.status_code == 400:
        print(f"✗ Cannot cancel job: {response.json().get('detail', 'Unknown error')}")
        sys.exit(1)
    else:
        print(f"✗ Error: {response.status_code}")
        print(f"  {response.text}")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="CLI tool for testing async job queue",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s submit "My first pipeline"
  %(prog)s status a1b2c3d4-e5f6-...
  %(prog)s list
  %(prog)s list --status running
  %(prog)s wait a1b2c3d4-e5f6-...  # Poll until complete
  %(prog)s cancel a1b2c3d4-e5f6-...
        """
    )
    
    subparsers = parser.add_subparsers(dest='command', help='Command to run')
    
    # Submit command
    submit_parser = subparsers.add_parser('submit', help='Submit a new pipeline')
    submit_parser.add_argument('name', help='Display name for the job')
    
    # Status command
    status_parser = subparsers.add_parser('status', help='Get job status')
    status_parser.add_argument('job_id', help='Job ID')
    
    # List command
    list_parser = subparsers.add_parser('list', help='List jobs')
    list_parser.add_argument('--status', help='Filter by status (queued, running, succeeded, failed, cancelled)')
    
    # Wait command
    wait_parser = subparsers.add_parser('wait', help='Wait for job to complete')
    wait_parser.add_argument('job_id', help='Job ID')
    
    # Cancel command
    cancel_parser = subparsers.add_parser('cancel', help='Cancel a job')
    cancel_parser.add_argument('job_id', help='Job ID')
    
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        sys.exit(1)
    
    # Create HTTP client
    client = httpx.Client(base_url=API_BASE_URL, timeout=30)
    
    try:
        if args.command == 'submit':
            job_id = submit_job(client, args.name)
            print(f"\n💡 Next steps:")
            print(f"   Check status:  uv run python scripts/test_jobs_cli.py status {job_id}")
            print(f"   Wait for completion: uv run python scripts/test_jobs_cli.py wait {job_id}")
            print(f"   Cancel job:    uv run python scripts/test_jobs_cli.py cancel {job_id}\n")
        
        elif args.command == 'status':
            job = get_job_status(client, args.job_id)
            pretty_print_job(job)
        
        elif args.command == 'list':
            list_jobs(client, args.status)
        
        elif args.command == 'wait':
            wait_for_completion(client, args.job_id)
        
        elif args.command == 'cancel':
            cancel_job(client, args.job_id)
    
    except KeyboardInterrupt:
        print("\n\n✗ Interrupted by user")
        sys.exit(1)
    
    except httpx.ConnectError:
        print(f"\n✗ Could not connect to API at {API_BASE_URL}")
        print(f"  Make sure the backend is running:")
        print(f"    uv run uvicorn app.main:app --port 8000")
        sys.exit(1)
    
    finally:
        client.close()


if __name__ == '__main__':
    main()
