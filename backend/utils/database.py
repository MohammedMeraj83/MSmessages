"""Short-lived MySQL connections and transaction-scoped dictionary cursors."""

from contextlib import contextmanager
from typing import Generator

import pymysql
from flask import current_app
from pymysql.cursors import DictCursor


@contextmanager
def database_cursor(*, write: bool = False) -> Generator[DictCursor, None, None]:
    """Yield a cursor and close the connection, committing writes on success."""
    settings = current_app.config["DATABASE"]
    connection = pymysql.connect(
        host=settings["host"],
        port=settings["port"],
        user=settings["user"],
        password=settings["password"],
        database=settings["database"],
        charset="utf8mb4",
        cursorclass=DictCursor,
        autocommit=False,
        connect_timeout=5,
        read_timeout=15,
        write_timeout=15,
    )
    try:
        with connection.cursor() as cursor:
            yield cursor
        if write:
            connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
