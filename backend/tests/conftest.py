"""Pytest fixtures for all tests."""

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, Session

from app.config import settings


@pytest.fixture(scope="session")
def engine():
    """Reuse the configured database's existing schema (never create/drop tables here)."""
    engine = create_engine(settings.database_url, echo=False)
    yield engine
    engine.dispose()


@pytest.fixture(scope="function")
def db_session(engine) -> Session:
    """Isolate each test in a SAVEPOINT that is rolled back at teardown, so
    test data (and any commit() calls made by repository code) never
    persists to the real database.
    """
    connection = engine.connect()
    outer_transaction = connection.begin()
    SessionLocal = sessionmaker(bind=connection)
    session = SessionLocal()

    nested = connection.begin_nested()

    @event.listens_for(session, "after_transaction_end")
    def restart_savepoint(sess, transaction):
        nonlocal nested
        if not nested.is_active:
            nested = connection.begin_nested()

    yield session

    session.close()
    outer_transaction.rollback()
    connection.close()

