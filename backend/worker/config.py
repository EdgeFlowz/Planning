"""Shared configuration for worker service."""

from app.config import settings
from pydantic_settings import BaseSettings, SettingsConfigDict


class WorkerSettings(BaseSettings):
    """Settings for the background worker service."""

    # Inherit database and Redis config from app.config
    database_url: str = settings.database_url
    redis_host: str = settings.redis_host
    redis_port: int = settings.redis_port
    redis_db: int = settings.redis_db

    # Worker behavior
    worker_name: str = "default"
    worker_timeout: int = 14400  # 4 hours in seconds
    max_retries: int = 3
    log_level: str = "INFO"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="WORKER_",
    )


worker_settings = WorkerSettings()
