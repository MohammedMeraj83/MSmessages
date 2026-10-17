"""Message persistence and read receipt operations."""

from typing import Any

from backend.utils.database import database_cursor

MESSAGE_SELECT = (
	"SELECT m.id, m.conversation_id, m.sender_id, m.message_type, m.message_text, m.media_id, m.reel_id, "
	"m.reply_to_message_id, m.is_deleted, m.view_once, m.viewed_at, m.delivered_at, m.created_at, m.updated_at, "
	"med.file_name AS media_file_name, med.original_name AS media_original_name, med.file_type AS media_file_type, "
	"med.file_size AS media_file_size, med.mime_type AS media_mime_type, "
	"r.title AS reel_title, r.source_url AS reel_source_url, r.embed_url AS reel_embed_url, "
	"r.thumbnail_url AS reel_thumbnail_url, r.platform AS reel_platform, "
	"EXISTS (SELECT 1 FROM message_reads mr WHERE mr.message_id = m.id AND mr.user_id <> m.sender_id) AS is_read_by_recipient "
	"FROM messages m LEFT JOIN media med ON med.id = m.media_id LEFT JOIN reels r ON r.id = m.reel_id "
)


def create_message(
	*, conversation_id: int, sender_id: int, message_type: str, message_text: str | None,
	media_id: int | None = None, reel_id: int | None = None, reply_to_message_id: int | None = None, view_once: bool = False,
) -> dict[str, Any]:
	with database_cursor(write=True) as cursor:
		if media_id is not None:
			cursor.execute("SELECT id FROM media WHERE id = %s AND user_id = %s", (media_id, sender_id))
			if cursor.fetchone() is None:
				raise PermissionError("Media is not available to this user")
		if reel_id is not None:
			cursor.execute("SELECT id FROM reels WHERE id = %s", (reel_id,))
			if cursor.fetchone() is None:
				raise LookupError("Reel was not found")
		if reply_to_message_id is not None:
			cursor.execute(
				"SELECT id FROM messages WHERE id = %s AND conversation_id = %s",
				(reply_to_message_id, conversation_id),
			)
			if cursor.fetchone() is None:
				raise LookupError("Replied-to message was not found")
		cursor.execute(
			"INSERT INTO messages (conversation_id, sender_id, message_type, message_text, media_id, reel_id, reply_to_message_id, view_once) "
			"VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
			(conversation_id, sender_id, message_type, message_text, media_id, reel_id, reply_to_message_id, view_once),
		)
		message_id = int(cursor.lastrowid)
		cursor.execute("UPDATE conversations SET updated_at = CURRENT_TIMESTAMP(6) WHERE id = %s", (conversation_id,))
		cursor.execute(
			MESSAGE_SELECT + "WHERE m.id = %s", (message_id,)
		)
		return cursor.fetchone()


def list_messages(conversation_id: int, *, limit: int, before_id: int = 0) -> list[dict[str, Any]]:
	with database_cursor() as cursor:
		cursor.execute(
			MESSAGE_SELECT + "WHERE m.conversation_id = %s AND (%s = 0 OR m.id < %s) "
			"ORDER BY m.id DESC LIMIT %s",
			(conversation_id, before_id, before_id, limit),
		)
		return list(reversed(cursor.fetchall()))


def find_message(message_id: int, conversation_id: int) -> dict[str, Any] | None:
	with database_cursor() as cursor:
		cursor.execute(MESSAGE_SELECT + "WHERE m.id = %s AND m.conversation_id = %s", (message_id, conversation_id))
		return cursor.fetchone()


def mark_message_read(message_id: int, user_id: int, conversation_id: int) -> int | None:
	with database_cursor(write=True) as cursor:
		cursor.execute("SELECT sender_id FROM messages WHERE id = %s AND conversation_id = %s", (message_id, conversation_id))
		message = cursor.fetchone()
		if not message or int(message["sender_id"]) == user_id:
			return None
		cursor.execute(
			"INSERT IGNORE INTO message_reads (message_id, user_id) VALUES (%s, %s)",
			(message_id, user_id),
		)
		# A read receipt is shown through the message ticks; it must not spam the notification list.
		cursor.execute(
			"UPDATE messages SET delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP(6)) WHERE id = %s",
			(message_id,),
		)
		return int(message["sender_id"])


def mark_conversation_read(conversation_id: int, user_id: int) -> list[int]:
	"""Mark every incoming message in a conversation as read; return the ids that changed."""
	with database_cursor(write=True) as cursor:
		cursor.execute(
			"SELECT m.id FROM messages m WHERE m.conversation_id = %s AND m.sender_id <> %s "
			"AND NOT EXISTS (SELECT 1 FROM message_reads mr WHERE mr.message_id = m.id AND mr.user_id = %s) "
			"ORDER BY m.id LIMIT 1000",
			(conversation_id, user_id, user_id),
		)
		ids = [int(row["id"]) for row in cursor.fetchall()]
		if not ids:
			return []
		cursor.executemany(
			"INSERT IGNORE INTO message_reads (message_id, user_id) VALUES (%s, %s)",
			[(message_id, user_id) for message_id in ids],
		)
		placeholders = ", ".join(["%s"] * len(ids))
		cursor.execute(
			f"UPDATE messages SET delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP(6)) WHERE id IN ({placeholders})",
			ids,
		)
		return ids


def mark_undelivered_as_delivered(user_id: int) -> list[dict[str, Any]]:
	"""Called when a user comes online: everything sent to them while offline is now delivered."""
	with database_cursor(write=True) as cursor:
		cursor.execute(
			"SELECT m.id, m.conversation_id, m.sender_id FROM messages m "
			"JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = %s "
			"WHERE m.sender_id <> %s AND m.delivered_at IS NULL ORDER BY m.id DESC LIMIT 1000",
			(user_id, user_id),
		)
		rows = cursor.fetchall()
		if not rows:
			return []
		placeholders = ", ".join(["%s"] * len(rows))
		cursor.execute(
			f"UPDATE messages SET delivered_at = CURRENT_TIMESTAMP(6) WHERE delivered_at IS NULL AND id IN ({placeholders})",
			[row["id"] for row in rows],
		)
		return rows


def mark_message_delivered(message_id: int, user_id: int, conversation_id: int) -> int | None:
	with database_cursor(write=True) as cursor:
		cursor.execute("SELECT sender_id FROM messages WHERE id = %s AND conversation_id = %s", (message_id, conversation_id))
		row = cursor.fetchone()
		if not row or int(row["sender_id"]) == user_id:
			return None
		cursor.execute("UPDATE messages SET delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP(6)) WHERE id = %s", (message_id,))
		return int(row["sender_id"])


def consume_view_once(message_id: int, user_id: int, conversation_id: int) -> dict[str, Any] | None:
	"""Atomically mark a view-once media message as consumed and return its media metadata."""
	with database_cursor(write=True) as cursor:
		cursor.execute(
			"SELECT m.id, m.sender_id, m.media_id, m.view_once, m.viewed_at, "
			"med.file_name, med.original_name, med.mime_type, med.storage_path "
			"FROM messages m JOIN media med ON med.id = m.media_id "
			"JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = %s "
			"WHERE m.id = %s AND m.conversation_id = %s FOR UPDATE",
			(user_id, message_id, conversation_id),
		)
		row = cursor.fetchone()
		if not row or not row["view_once"] or int(row["sender_id"]) == user_id or row["viewed_at"] is not None:
			return None
		cursor.execute("UPDATE messages SET viewed_at = CURRENT_TIMESTAMP(6) WHERE id = %s AND viewed_at IS NULL", (message_id,))
		if cursor.rowcount != 1:
			return None
		return row
