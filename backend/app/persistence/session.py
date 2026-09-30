"""Database session management for FastAPI."""

from typing import Generator

from sqlalchemy.orm import Session, sessionmaker

from app.config import settings

# Create session factory
SessionLocal = sessionmaker(
    bind=None,  # Will be bound to engine in main.py
    class_=Session,
    expire_on_commit=False,
)


def get_db() -> Generator[Session, None, None]:
    """Dependency to inject database session into FastAPI endpoints.
    
    Usage:
        @app.get("/endpoint")
        def my_endpoint(db: Session = Depends(get_db)):
            # Use db for queries
            pass
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
