"""Media metadata persistence and access checks."""

from typing import Any

from backend.utils.database import database_cursor


def create_media(*, user_id: int, file_name: str, original_name: str, file_type: str, file_size: int, storage_path: str, mime_type: str) -> int:
	with database_cursor(write=True) as cursor:
		cursor.execute(
			"INSERT INTO media (user_id, file_name, original_name, file_type, file_size, storage_path, mime_type) "
			"VALUES (%s, %s, %s, %s, %s, %s, %s)",
			(user_id, file_name, original_name, file_type, file_size, storage_path, mime_type),
		)
		return int(cursor.lastrowid)


def find_media(media_id: int) -> dict[str, Any] | None:
	with database_cursor() as cursor:
		cursor.execute("SELECT * FROM media WHERE id = %s", (media_id,))
		return cursor.fetchone()


def media_accessible_to_user(media_id: int, user_id: int) -> bool:
	with database_cursor() as cursor:
		cursor.execute(
			"SELECT 1 FROM media med WHERE med.id = %s AND (med.user_id = %s OR EXISTS ("
			"SELECT 1 FROM messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id "
			"WHERE m.media_id = med.id AND cm.user_id = %s)) LIMIT 1",
			(media_id, user_id, user_id),
		)
		return cursor.fetchone() is not None



def view_once_state(media_id: int, user_id: int) -> dict[str, Any] | None:
    with database_cursor() as cursor:
        cursor.execute(
            "SELECT m.id AS message_id, m.sender_id, m.view_once, m.viewed_at "
            "FROM messages m WHERE m.media_id = %s ORDER BY m.id DESC LIMIT 1",
            (media_id,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        return {
            "message_id": int(row["message_id"]),
            "sender_id": int(row["sender_id"]),
            "view_once": bool(row["view_once"]),
            "viewed_at": row["viewed_at"],
            "is_sender": int(row["sender_id"]) == int(user_id),
        }
