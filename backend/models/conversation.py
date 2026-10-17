"""Private conversation persistence and membership checks."""

from typing import Any

from backend.utils.database import database_cursor


def is_member(conversation_id: int, user_id: int) -> bool:
	with database_cursor() as cursor:
		cursor.execute(
			"SELECT 1 FROM conversation_members WHERE conversation_id = %s AND user_id = %s",
			(conversation_id, user_id),
		)
		return cursor.fetchone() is not None


def create_private_conversation(first_user_id: int, second_user_id: int) -> tuple[int, bool]:
	with database_cursor(write=True) as cursor:
		cursor.execute("SELECT id FROM users WHERE id IN (%s, %s) ORDER BY id FOR UPDATE", (first_user_id, second_user_id))
		if len(cursor.fetchall()) != 2:
			raise LookupError("Target user was not found")
		cursor.execute(
			"SELECT cm.conversation_id FROM conversation_members cm "
			"WHERE cm.user_id IN (%s, %s) GROUP BY cm.conversation_id "
			"HAVING COUNT(DISTINCT cm.user_id) = 2 "
			"AND (SELECT COUNT(*) FROM conversation_members all_cm WHERE all_cm.conversation_id = cm.conversation_id) = 2 "
			"LIMIT 1",
			(first_user_id, second_user_id),
		)
		existing = cursor.fetchone()
		if existing:
			return int(existing["conversation_id"]), False
		cursor.execute("INSERT INTO conversations () VALUES ()")
		conversation_id = int(cursor.lastrowid)
		cursor.executemany(
			"INSERT INTO conversation_members (conversation_id, user_id) VALUES (%s, %s)",
			[(conversation_id, first_user_id), (conversation_id, second_user_id)],
		)
		return conversation_id, True


_SUMMARY_SELECT = (
	"SELECT c.id, c.created_at, c.updated_at, "
	"u.id AS other_user_id, u.username AS other_username, u.full_name AS other_full_name, "
	"u.avatar AS other_avatar, u.bio AS other_bio, u.is_online AS other_is_online, u.last_seen AS other_last_seen, "
	"lm.id AS last_message_id, lm.sender_id AS last_message_sender_id, lm.message_type AS last_message_type, "
	"lm.message_text AS last_message_text, lm.created_at AS last_message_at, "
	"(SELECT COUNT(*) FROM messages um WHERE um.conversation_id = c.id AND um.sender_id <> %(me)s "
	"AND NOT EXISTS (SELECT 1 FROM message_reads mr WHERE mr.message_id = um.id AND mr.user_id = %(me)s)) AS unread_count, "
	"EXISTS (SELECT 1 FROM messages rm WHERE rm.conversation_id = c.id AND rm.message_type = 'reel') AS has_reels "
	"FROM conversation_members mine "
	"JOIN conversations c ON c.id = mine.conversation_id "
	"JOIN conversation_members theirs ON theirs.conversation_id = c.id AND theirs.user_id <> mine.user_id "
	"JOIN users u ON u.id = theirs.user_id "
	"LEFT JOIN messages lm ON lm.id = (SELECT MAX(lmx.id) FROM messages lmx WHERE lmx.conversation_id = c.id) "
	"WHERE mine.user_id = %(me)s "
)


def get_conversation(conversation_id: int, user_id: int) -> dict[str, Any] | None:
	with database_cursor() as cursor:
		cursor.execute(_SUMMARY_SELECT + "AND c.id = %(cid)s", {"me": user_id, "cid": conversation_id})
		return cursor.fetchone()


def list_conversations(user_id: int) -> list[dict[str, Any]]:
	with database_cursor() as cursor:
		cursor.execute(
			_SUMMARY_SELECT + "ORDER BY COALESCE(lm.created_at, c.created_at) DESC, c.id DESC",
			{"me": user_id},
		)
		return cursor.fetchall()


def conversation_ids_for_user(user_id: int) -> list[int]:
	with database_cursor() as cursor:
		cursor.execute("SELECT conversation_id FROM conversation_members WHERE user_id = %s", (user_id,))
		return [int(row["conversation_id"]) for row in cursor.fetchall()]


def member_ids(conversation_id: int) -> list[int]:
	with database_cursor() as cursor:
		cursor.execute(
			"SELECT user_id FROM conversation_members WHERE conversation_id = %s",
			(conversation_id,),
		)
		return [int(row["user_id"]) for row in cursor.fetchall()]


def are_blocked(first_user_id: int, second_user_id: int) -> bool:
	with database_cursor() as cursor:
		cursor.execute(
			"SELECT 1 FROM blocked_users WHERE (blocker_id = %s AND blocked_id = %s) "
			"OR (blocker_id = %s AND blocked_id = %s) LIMIT 1",
			(first_user_id, second_user_id, second_user_id, first_user_id),
		)
		return cursor.fetchone() is not None

