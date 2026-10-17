"""Authorized conversation and message workflows shared by routes and sockets."""

from typing import Any

from backend.extensions import socketio
from backend.models import conversation, message, user
from backend.utils.database import database_cursor


class ChatAccessError(Exception):
	pass


def require_conversation_member(conversation_id: int, user_id: int) -> None:
	if not conversation.is_member(conversation_id, user_id):
		raise ChatAccessError("Conversation not found")


def broadcast_message(conversation_id: int, payload: dict[str, Any]) -> None:
	"""Deliver a message to every member's personal room.

	This does not depend on the client having joined the conversation room first, so the
	recipient gets new messages (and brand-new chats) live in every open tab.
	"""
	for member_id in conversation.member_ids(conversation_id):
		socketio.emit("message_received", payload, to=f"user_{member_id}")


def open_private_conversation(user_id: int, target_user_id: int) -> tuple[int, bool]:
	if user_id == target_user_id:
		raise ValueError("A conversation requires another user")
	if conversation.are_blocked(user_id, target_user_id):
		raise PermissionError("A conversation cannot be created with this user")
	return conversation.create_private_conversation(user_id, target_user_id)


def send_conversation_message(
	*, conversation_id: int, sender_id: int, message_type: str, message_text: str | None,
	media_id: int | None = None, reel_id: int | None = None, reply_to_message_id: int | None = None, view_once: bool = False,
) -> dict[str, Any]:
	require_conversation_member(conversation_id, sender_id)
	with database_cursor() as cursor:
		cursor.execute(
			"SELECT user_id FROM conversation_members WHERE conversation_id = %s AND user_id <> %s",
			(conversation_id, sender_id),
		)
		recipients = [int(row["user_id"]) for row in cursor.fetchall()]
	if any(conversation.are_blocked(sender_id, recipient_id) for recipient_id in recipients):
		raise PermissionError("Messages cannot be sent in this conversation")
	created = message.create_message(
		conversation_id=conversation_id,
		sender_id=sender_id,
		message_type=message_type,
		message_text=message_text,
		media_id=media_id,
		reel_id=reel_id,
		reply_to_message_id=reply_to_message_id, view_once=view_once,
	)
	if recipients:
		sender = user.find_user_by_id(sender_id) or {}
		name = sender.get("full_name") or sender.get("username") or "Someone"
		labels = {
			"reel": ("reel_shared", "Reel shared", f"{name} shared a reel with you"),
			"image": ("new_message", "New photo", f"{name} sent you a photo"),
			"video": ("new_message", "New video", f"{name} sent you a video"),
			"audio": ("new_message", "New voice message", f"{name} sent you a voice message"),
			"file": ("new_message", "New file", f"{name} sent you a file"),
		}
		notification_type, title, body = labels.get(message_type, ("new_message", "New message", f"{name} sent you a message"))
		with database_cursor(write=True) as cursor:
			cursor.executemany(
				"INSERT INTO notifications (user_id, type, title, body, related_message_id) VALUES (%s, %s, %s, %s, %s)",
				[(recipient_id, notification_type, title, body, created["id"]) for recipient_id in recipients],
			)
	return created


def message_payload(row: dict[str, Any]) -> dict[str, Any]:
	metadata_fields = {
		"media_file_name", "media_original_name", "media_file_type", "media_file_size", "media_mime_type",
		"reel_title", "reel_source_url", "reel_embed_url", "reel_thumbnail_url", "reel_platform",
	}
	result = {key: value for key, value in row.items() if key not in metadata_fields}
	result["media"] = None
	if row.get("media_id") is not None:
		result["media"] = {
			"id": row["media_id"], "file_name": row.get("media_file_name"),
			"original_name": row.get("media_original_name"), "file_type": row.get("media_file_type"),
			"file_size": row.get("media_file_size"), "mime_type": row.get("media_mime_type"),
			"media_url": f"/api/media/{row['media_id']}",
		}
	result["reel"] = None
	if row.get("reel_id") is not None:
		result["reel"] = {
			"id": row["reel_id"], "title": row.get("reel_title"),
			"source_url": row.get("reel_source_url"), "embed_url": row.get("reel_embed_url"),
			"thumbnail_url": row.get("reel_thumbnail_url"), "platform": row.get("reel_platform"),
		}
	return result

