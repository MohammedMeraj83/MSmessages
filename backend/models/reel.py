"""Reel URL metadata persistence."""

from typing import Any

from backend.utils.database import database_cursor


def create_reel(*, title: str, source_url: str, embed_url: str | None, thumbnail_url: str | None, platform: str, created_by: int) -> int:
	with database_cursor(write=True) as cursor:
		cursor.execute(
			"INSERT INTO reels (title, source_url, embed_url, thumbnail_url, platform, created_by) "
			"VALUES (%s, %s, %s, %s, %s, %s)",
			(title, source_url, embed_url, thumbnail_url, platform, created_by),
		)
		return int(cursor.lastrowid)


def list_reels(*, limit: int, before_id: int = 0) -> list[dict[str, Any]]:
	with database_cursor() as cursor:
		cursor.execute(
			"SELECT id, title, source_url, embed_url, thumbnail_url, platform, created_by, created_at "
			"FROM reels WHERE (%s = 0 OR id < %s) ORDER BY id DESC LIMIT %s",
			(before_id, before_id, limit),
		)
		return cursor.fetchall()
