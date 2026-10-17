"""Authenticated, membership-checked private chat Socket.IO handlers."""

import time
from collections import defaultdict, deque
from threading import RLock
from typing import Any
from uuid import UUID, uuid4

from flask import request
from flask_socketio import emit, join_room, leave_room

from backend.extensions import socketio
from backend.models import conversation, message, user
from backend.services.auth_service import session_is_active
from backend.services.chat_service import ChatAccessError, broadcast_message, message_payload, send_conversation_message
from backend.utils.helpers import serialize_value
from backend.utils.database import database_cursor
from backend.utils.validators import validate_message

_socket_users: dict[str, int] = {}
_socket_jtis: dict[str, str] = {}
_socket_users_lock = RLock()
_user_sockets: dict[int, set[str]] = {}
_send_times: dict[int, deque] = defaultdict(deque)
MAX_MESSAGES_PER_MINUTE = 60


def _rate_limited(user_id: int) -> bool:
	now = time.monotonic()
	with _socket_users_lock:
		bucket = _send_times[user_id]
		while bucket and now - bucket[0] > 60:
			bucket.popleft()
		if len(bucket) >= MAX_MESSAGES_PER_MINUTE:
			return True
		bucket.append(now)
	return False


def join_user_to_conversation(user_id: int, conversation_id: int) -> None:
	"""Put every live socket of a user into a conversation room (used for brand-new chats)."""
	with _socket_users_lock:
		sids = list(_user_sockets.get(user_id, ()))
	for sid in sids:
		socketio.server.enter_room(sid, f"conversation_{conversation_id}", namespace="/")


def authenticated_socket_user() -> int | None:
	with _socket_users_lock:
		user_id = _socket_users.get(request.sid)
		jti = _socket_jtis.get(request.sid)
	if user_id is None or jti is None:
		return None
	try:
		return user_id if session_is_active(jti) else None
	except Exception:
		return None


def disconnect_session_sockets(jti: str) -> None:
	with _socket_users_lock:
		socket_ids = [sid for sid, connected_jti in _socket_jtis.items() if connected_jti == jti]
	for sid in socket_ids:
		socketio.server.disconnect(sid, namespace="/")


def _conversation_id(payload: dict[str, Any]) -> int | None:
	try:
		value = int(payload.get("conversation_id"))
		return value if value > 0 else None
	except (TypeError, ValueError):
		return None


def start_call(payload: dict[str, Any] | None):
	caller_id = authenticated_socket_user()
	data = payload or {}
	conversation_id = _conversation_id(data)
	call_type = data.get("call_type")
	if caller_id is None:
		return {"success": False, "error": {"code": "UNAUTHENTICATED", "message": "Authentication required"}}
	if conversation_id is None or call_type not in {"audio", "video"}:
		return {"success": False, "error": {"code": "INVALID_CALL", "message": "A valid conversation and call type are required"}}
	if not conversation.is_member(conversation_id, caller_id):
		return {"success": False, "error": {"code": "CONVERSATION_NOT_FOUND", "message": "Conversation not found"}}
	with database_cursor() as cursor:
		cursor.execute("SELECT user_id FROM conversation_members WHERE conversation_id = %s", (conversation_id,))
		members = [int(row["user_id"]) for row in cursor.fetchall()]
	if len(members) != 2:
		return {"success": False, "error": {"code": "INVALID_CONVERSATION", "message": "Calls require a private one-to-one conversation"}}
	recipient_id = next((member_id for member_id in members if member_id != caller_id), None)
	if recipient_id is None or conversation.are_blocked(caller_id, recipient_id):
		return {"success": False, "error": {"code": "CALL_UNAVAILABLE", "message": "This user is unavailable for calls"}}
	with _socket_users_lock:
		recipient_online = bool(_user_sockets.get(recipient_id))
	if not recipient_online:
		return {"success": False, "error": {"code": "CALL_UNAVAILABLE", "message": "This user is offline right now"}}
	caller = user.find_user_by_id(caller_id)
	if not caller:
		return {"success": False, "error": {"code": "USER_NOT_FOUND", "message": "Caller account was not found"}}
	call_id = str(uuid4())
	socketio.emit(
		"incoming_call",
		{
			"call_id": call_id,
			"conversation_id": conversation_id,
			"call_type": call_type,
			"caller": {"id": caller_id, "username": caller["username"], "full_name": caller["full_name"], "avatar": caller["avatar"]},
		},
		to=f"user_{recipient_id}",
	)
	return {"success": True, "data": {"call_id": call_id, "conversation_id": conversation_id, "to_user_id": recipient_id}}


def call_signal(payload: dict[str, Any] | None):
	sender_id = authenticated_socket_user()
	data = payload or {}
	conversation_id = _conversation_id(data)
	signal_type = data.get("signal_type")
	call_id = data.get("call_id")
	target_id = data.get("to_user_id")
	if sender_id is None:
		return {"success": False, "error": {"code": "UNAUTHENTICATED", "message": "Authentication required"}}
	try:
		UUID(str(call_id))
		target_id = int(target_id)
	except (ValueError, TypeError, AttributeError):
		return {"success": False, "error": {"code": "INVALID_CALL", "message": "Call identifiers are invalid"}}
	if conversation_id is None or target_id == sender_id or signal_type not in {"accept", "reject", "end", "offer", "answer", "ice_candidate"}:
		return {"success": False, "error": {"code": "INVALID_CALL_SIGNAL", "message": "Call signal is invalid"}}
	with database_cursor() as cursor:
		cursor.execute(
			"SELECT user_id FROM conversation_members WHERE conversation_id = %s AND user_id IN (%s, %s)",
			(conversation_id, sender_id, target_id),
		)
		members = {int(row["user_id"]) for row in cursor.fetchall()}
	if members != {sender_id, target_id}:
		return {"success": False, "error": {"code": "CALL_FORBIDDEN", "message": "Call participants must belong to this conversation"}}
	signal = data.get("signal")
	if signal_type in {"offer", "answer"}:
		if not isinstance(signal, dict) or signal.get("type") != signal_type or not isinstance(signal.get("sdp"), str) or len(signal["sdp"]) > 100000:
			return {"success": False, "error": {"code": "INVALID_CALL_SIGNAL", "message": "Session description is invalid"}}
	elif signal_type == "ice_candidate":
		if not isinstance(signal, dict) or not isinstance(signal.get("candidate"), str) or len(signal["candidate"]) > 4096:
			return {"success": False, "error": {"code": "INVALID_CALL_SIGNAL", "message": "ICE candidate is invalid"}}
	socketio.emit(
		"call_signal",
		{
			"call_id": str(call_id), "conversation_id": conversation_id,
			"from_user_id": sender_id, "signal_type": signal_type, "signal": signal,
		},
		to=f"user_{target_id}",
	)
	return {"success": True, "data": {"call_id": str(call_id), "signal_type": signal_type}}


def join_conversation(payload: dict[str, Any] | None):
	user_id = authenticated_socket_user()
	conversation_id = _conversation_id(payload or {})
	if user_id is None:
		return {"success": False, "error": {"code": "UNAUTHENTICATED", "message": "Authentication required"}}
	if conversation_id is None or not conversation.is_member(conversation_id, user_id):
		return {"success": False, "error": {"code": "CONVERSATION_NOT_FOUND", "message": "Conversation not found"}}
	join_room(f"conversation_{conversation_id}")
	emit("user_online", {"user_id": user_id}, to=f"conversation_{conversation_id}")
	return {"success": True, "data": {"conversation_id": conversation_id}}


def leave_conversation(payload: dict[str, Any] | None):
	user_id = authenticated_socket_user()
	conversation_id = _conversation_id(payload or {})
	if user_id is None:
		return {"success": False, "error": {"code": "UNAUTHENTICATED", "message": "Authentication required"}}
	if conversation_id is None or not conversation.is_member(conversation_id, user_id):
		return {"success": False, "error": {"code": "CONVERSATION_NOT_FOUND", "message": "Conversation not found"}}
	leave_room(f"conversation_{conversation_id}")
	return {"success": True, "data": {"conversation_id": conversation_id}}


def send_message(payload: dict[str, Any] | None):
	user_id = authenticated_socket_user()
	data = payload or {}
	conversation_id = _conversation_id(data)
	if user_id is None:
		return {"success": False, "error": {"code": "UNAUTHENTICATED", "message": "Authentication required"}}
	if conversation_id is None:
		return {"success": False, "error": {"code": "VALIDATION_ERROR", "message": "conversation_id is required"}}
	if _rate_limited(user_id):
		return {"success": False, "error": {"code": "RATE_LIMITED", "message": "You are sending messages too fast"}}
	message_type = data.get("message_type", "text")
	text = data.get("message_text")
	media_id = data.get("media_id")
	reel_id = data.get("reel_id")
	reply_id = data.get("reply_to_message_id")
	view_once = bool(data.get("view_once", False))
	if any(value is not None and (not isinstance(value, int) or isinstance(value, bool)) for value in (media_id, reel_id, reply_id)):
		return {"success": False, "error": {"code": "VALIDATION_ERROR", "message": "Media, reel, and reply IDs must be integers"}}
	issue = validate_message(message_type, text, media_id, reel_id)
	if issue:
		return {"success": False, "error": {"code": "VALIDATION_ERROR", "message": issue}}
	try:
		row = send_conversation_message(
			conversation_id=conversation_id, sender_id=user_id, message_type=message_type,
			message_text=text, media_id=media_id, reel_id=reel_id, reply_to_message_id=reply_id, view_once=view_once,
		)
	except ChatAccessError:
		return {"success": False, "error": {"code": "CONVERSATION_NOT_FOUND", "message": "Conversation not found"}}
	except (PermissionError, LookupError) as exc:
		return {"success": False, "error": {"code": "MESSAGE_REJECTED", "message": str(exc)}}
	except Exception:
		return {"success": False, "error": {"code": "MESSAGE_FAILED", "message": "Message could not be sent"}}
	result = {"success": True, "data": {"message": serialize_value(message_payload(row))}}
	broadcast_message(conversation_id, result)
	return result


def _typing(payload: dict[str, Any] | None, active: bool):
	user_id = authenticated_socket_user()
	conversation_id = _conversation_id(payload or {})
	if user_id is None:
		return {"success": False, "error": {"code": "UNAUTHENTICATED", "message": "Authentication required"}}
	if conversation_id is None or not conversation.is_member(conversation_id, user_id):
		return {"success": False, "error": {"code": "CONVERSATION_NOT_FOUND", "message": "Conversation not found"}}
	event = "typing_start" if active else "typing_stop"
	socketio.emit(event, {"conversation_id": conversation_id, "user_id": user_id}, to=f"conversation_{conversation_id}", include_self=False)
	return {"success": True, "data": {"conversation_id": conversation_id}}


def typing_start(payload: dict[str, Any] | None):
	return _typing(payload, True)


def typing_stop(payload: dict[str, Any] | None):
	return _typing(payload, False)


def message_read(payload: dict[str, Any] | None):
	user_id = authenticated_socket_user()
	data = payload or {}
	conversation_id = _conversation_id(data)
	try:
		message_id = int(data.get("message_id"))
	except (TypeError, ValueError):
		message_id = 0
	if user_id is None:
		return {"success": False, "error": {"code": "UNAUTHENTICATED", "message": "Authentication required"}}
	if conversation_id is None or message_id <= 0 or not conversation.is_member(conversation_id, user_id):
		return {"success": False, "error": {"code": "CONVERSATION_NOT_FOUND", "message": "Conversation not found"}}
	sender_id = message.mark_message_read(message_id, user_id, conversation_id)
	if sender_id is None:
		return {"success": False, "error": {"code": "MESSAGE_NOT_FOUND", "message": "Message not found"}}
	receipt = {"success": True, "data": {"conversation_id": conversation_id, "message_id": message_id, "user_id": user_id}}
	socketio.emit("message_read", receipt, to=f"conversation_{conversation_id}")
	return receipt



def message_delivered(payload: dict[str, Any] | None):
	user_id = authenticated_socket_user()
	data = payload or {}
	conversation_id = _conversation_id(data)
	try:
		message_id = int(data.get("message_id"))
	except (TypeError, ValueError):
		message_id = 0
	if user_id is None or conversation_id is None or message_id <= 0 or not conversation.is_member(conversation_id, user_id):
		return {"success": False, "error": {"code": "UNAUTHORIZED", "message": "Unauthorized delivery receipt"}}
	row = message.find_message(message_id, conversation_id)
	if not row or int(row["sender_id"]) == user_id:
		return {"success": False, "error": {"code": "MESSAGE_NOT_FOUND", "message": "Message not found"}}
	sender_id = message.mark_message_delivered(message_id, user_id, conversation_id)
	if sender_id is None:
		return {"success": False, "error": {"code": "MESSAGE_NOT_FOUND", "message": "Message not found"}}
	receipt = {"success": True, "data": {"conversation_id": conversation_id, "message_id": message_id, "user_id": user_id}}
	socketio.emit("message_delivered", receipt, to=f"conversation_{conversation_id}")
	return receipt


def conversation_read(payload: dict[str, Any] | None):
	user_id = authenticated_socket_user()
	conversation_id = _conversation_id(payload or {})
	if user_id is None:
		return {"success": False, "error": {"code": "UNAUTHENTICATED", "message": "Authentication required"}}
	if conversation_id is None or not conversation.is_member(conversation_id, user_id):
		return {"success": False, "error": {"code": "CONVERSATION_NOT_FOUND", "message": "Conversation not found"}}
	ids = message.mark_conversation_read(conversation_id, user_id)
	if ids:
		socketio.emit(
			"messages_read",
			{"conversation_id": conversation_id, "message_ids": ids, "user_id": user_id},
			to=f"conversation_{conversation_id}",
		)
	return {"success": True, "data": {"conversation_id": conversation_id, "message_ids": ids}}
