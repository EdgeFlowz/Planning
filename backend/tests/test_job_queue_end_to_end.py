#!/usr/bin/env python
"""Test script for async job queue functionality.

This script demonstrates how to:
1. Submit a pipeline for async execution
2. Poll for job status
3. Retrieve results when complete

Prerequisites:
    - Backend API running on http://localhost:8000
    - Redis running on localhost:6379
    - Worker service running

Usage:
    python -m tests.test_job_queue
"""

import asyncio
import json
import time
from pathlib import Path

import httpx


API_BASE = "http://localhost:8000"
POLL_INTERVAL = 1.0  # seconds
MAX_POLL_TIME = 300.0  # 5 minutes


def create_test_pipeline():
    """Create a simple test pipeline definition."""
    return {
        "schema_version": 1,
        "pipeline_id": "test-pipeline-async",
        "nodes": [
            {
                "id": "source_1",
                "type": "source.csv",
                "config": {
                    "path": "example_data/sales.csv"
                }
            },
            {
                "id": "transform_1",
                "type": "transform.select",
                "config": {
                    "columns": ["Amount", "Product"]
                }
            }
        ],
        "edges": [
            {
                "source": "source_1",
                "target": "transform_1",
                "output": None,
                "input": None,
                "condition": None
            }
        ]
    }


async def submit_job(client: httpx.AsyncClient, pipeline_def: dict) -> str:
    """Submit a pipeline for async execution.
    
    Args:
        client: Async HTTP client
        pipeline_def: Pipeline definition dict
        
    Returns:
        job_id string
    """
    print("\n🚀 Submitting pipeline for async execution...")
    
    response = await client.post(
        f"{API_BASE}/v1/jobs",
        json={
            "display_name": "Test Run #1",
            "pipeline_definition": pipeline_def
        }
    )
    
    if response.status_code != 200:
        print(f"❌ Failed to submit job: {response.status_code}")
        print(response.json())
        raise Exception("Job submission failed")
    
    job_data = response.json()
    job_id = job_data["id"]
    
    print(f"✅ Job submitted successfully!")
    print(f"   Job ID: {job_id}")
    print(f"   Status: {job_data['status']}")
    print(f"   Display Name: {job_data['display_name']}")
    
    return job_id


async def poll_job_status(client: httpx.AsyncClient, job_id: str) -> dict:
    """Poll job status with exponential backoff.
    
    Args:
        client: Async HTTP client
        job_id: Job UUID string
        
    Returns:
        Final job data dict
    """
    print(f"\n⏳ Polling job status (max {MAX_POLL_TIME}s)...")
    
    poll_count = 0
    elapsed = 0.0
    backoff = 1.0
    
    while elapsed < MAX_POLL_TIME:
        poll_count += 1
        
        response = await client.get(f"{API_BASE}/v1/jobs/{job_id}")
        
        if response.status_code != 200:
            print(f"❌ Failed to get job status: {response.status_code}")
            raise Exception("Status polling failed")
        
        job_data = response.json()
        status = job_data["status"]
        
        # Print current status
        status_emoji = {
            "queued": "⏳",
            "running": "🔄",
            "succeeded": "✅",
            "failed": "❌",
            "cancelled": "⛔",
        }
        
        elapsed_display = f"{elapsed:.1f}s"
        print(f"   [{elapsed_display}] {status_emoji.get(status, '?')} Status: {status}")
        
        # Check if job is complete
        if status in ("succeeded", "failed", "cancelled"):
            print(f"\n✅ Job execution complete after {elapsed:.1f}s ({poll_count} polls)")
            return job_data
        
        # Wait before next poll (exponential backoff: 1s, 2s, 4s... capped at 5s)
        await asyncio.sleep(min(backoff, 5.0))
        elapsed += min(backoff, 5.0)
        backoff *= 2.0
    
    print(f"\n⏱️  Job polling timeout after {MAX_POLL_TIME}s. Job may still be running.")
    return job_data


def print_job_results(job_data: dict) -> None:
    """Print job results in a nice format.
    
    Args:
        job_data: Job response dict
    """
    print("\n" + "=" * 60)
    print("JOB EXECUTION RESULTS")
    print("=" * 60)
    
    print(f"\nJob ID: {job_data['id']}")
    print(f"Display Name: {job_data['display_name']}")
    print(f"Status: {job_data['status']}")
    print(f"Retries: {job_data['retry_count']}/{job_data['max_retries']}")
    
    timestamps = {
        "Created": job_data['created_at'],
        "Started": job_data['started_at'],
        "Completed": job_data['completed_at'],
    }
    
    print(f"\nTimestamps:")
    for label, ts in timestamps.items():
        if ts:
            print(f"  {label}: {ts}")
    
    if job_data['status'] == 'succeeded':
        print(f"\n✅ SUCCESS")
        if job_data['result']:
            print(f"\nExecution Results:")
            result = job_data['result']
            if 'node_results' in result:
                for node_result in result['node_results']:
                    print(f"\n  Node: {node_result['node_id']} ({node_result['node_type']})")
                    print(f"    Rows: {node_result['rows']}")
                    print(f"    Columns: {', '.join(node_result['columns'][:3])}...")
    elif job_data['status'] == 'failed':
        print(f"\n❌ FAILED")
        if job_data['error']:
            print(f"\nError Message:")
            print(job_data['error'])
    elif job_data['status'] == 'cancelled':
        print(f"\n⛔ CANCELLED")
        if job_data['error']:
            print(f"\nCancellation Reason:")
            print(job_data['error'])
    
    print("\n" + "=" * 60)


async def test_job_queue():
    """Main test function."""
    print("\n" + "=" * 60)
    print("ASYNC JOB QUEUE TEST")
    print("=" * 60)
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            # Check API health
            print("\n🔍 Checking API health...")
            response = await client.get(f"{API_BASE}/health")
            if response.status_code != 200:
                print("❌ API is not healthy")
                return
            print("✅ API is healthy")
            
            # Create test pipeline
            pipeline_def = create_test_pipeline()
            print(f"\n📋 Test pipeline created:")
            print(f"   Nodes: {[n['id'] for n in pipeline_def['nodes']]}")
            print(f"   Edges: {len(pipeline_def['edges'])}")
            
            # Submit job
            job_id = await submit_job(client, pipeline_def)
            
            # Poll for completion
            job_data = await poll_job_status(client, job_id)
            
            # Print results
            print_job_results(job_data)
            
            # Test polling a specific job
            print("\n\n🔍 Testing list jobs endpoint...")
            response = await client.get(f"{API_BASE}/v1/jobs")
            if response.status_code == 200:
                jobs_list = response.json()
                print(f"✅ Retrieved {jobs_list['total']} total jobs in system")
                print(f"   Showing {len(jobs_list['jobs'])} jobs (limit: {jobs_list['limit']})")
            
        except Exception as e:
            print(f"\n❌ Test failed with error: {e}")
            import traceback
            traceback.print_exc()


if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("SETUP REQUIRED")
    print("=" * 60)
    print("\nBefore running this test, ensure:")
    print("  1. Backend API running:     uv run uvicorn app.main:app --port 8000")
    print("  2. Redis running:           docker-compose up redis")
    print("  3. Worker running:          python -m worker.main")
    print("\nOr run all at once with:")
    print("  # Terminal 1: Redis + Database")
    print("  cd backend && docker-compose up")
    print("\n  # Terminal 2: Backend API")
    print("  cd backend && uv run uvicorn app.main:app --port 8000 --reload")
    print("\n  # Terminal 3: Background Worker")
    print("  cd backend && python -m worker.main")
    print("\n  # Terminal 4: Run this test")
    print("  cd backend && python -m tests.test_job_queue")
    print("\n" + "=" * 60)
    
    # Run the test
    try:
        asyncio.run(test_job_queue())
    except KeyboardInterrupt:
        print("\n\n⛔ Test interrupted by user")
