"""Connection authentication and conversation-scoped presence events."""

from flask import current_app, request
from flask_jwt_extended import decode_token
from flask_socketio import join_room

from backend.extensions import socketio
from backend.models import conversation, message, user
from backend.services.auth_service import session_is_active
from backend.sockets.chat_events import _socket_jtis, _socket_users, _socket_users_lock, _user_sockets


def connect(auth: dict | None):
	credentials = auth or {}
	token = credentials.get("token") or credentials.get("access_token")
	if not isinstance(token, str):
		header = request.headers.get("Authorization", "")
		token = header[7:] if header.lower().startswith("bearer ") else None
	if not token:
		return False
	try:
		claims = decode_token(token)
		user_id = int(claims["sub"])
		if not session_is_active(claims["jti"]) or not user.find_user_by_id(user_id):
			return False
	except Exception:
		current_app.logger.info("Rejected unauthenticated Socket.IO connection")
		return False
	sid = request.sid
	conversation_ids = conversation.conversation_ids_for_user(user_id)
	with _socket_users_lock:
		_socket_users[sid] = user_id
		_socket_jtis[sid] = claims["jti"]
		sockets = _user_sockets.setdefault(user_id, set())
		was_offline = not sockets
		sockets.add(sid)
		join_room(f"user_{user_id}")
		# Join every conversation room server-side so live messages, typing and receipts always work.
		for conversation_id in conversation_ids:
			join_room(f"conversation_{conversation_id}")
	if was_offline:
		user.update_online_status(user_id, True)
		for conversation_id in conversation_ids:
			socketio.emit("user_online", {"user_id": user_id}, to=f"conversation_{conversation_id}")
	# Anything sent while this user was offline is now delivered: tell the senders.
	try:
		for row in message.mark_undelivered_as_delivered(user_id):
			socketio.emit(
				"message_delivered",
				{"success": True, "data": {
					"conversation_id": int(row["conversation_id"]), "message_id": int(row["id"]), "user_id": user_id,
				}},
				to=f"user_{int(row['sender_id'])}",
			)
	except Exception:
		current_app.logger.exception("Could not mark offline messages as delivered")
	return True


def disconnect(reason=None):
	del reason
	sid = request.sid
	with _socket_users_lock:
		user_id = _socket_users.pop(sid, None)
		_socket_jtis.pop(sid, None)
		if user_id is None:
			return
		sockets = _user_sockets.get(user_id, set())
		sockets.discard(sid)
		is_offline = not sockets
		if is_offline:
			_user_sockets.pop(user_id, None)
	if is_offline:
		user.update_online_status(user_id, False)
		for conversation_id in conversation.conversation_ids_for_user(user_id):
			socketio.emit("user_offline", {"user_id": user_id}, to=f"conversation_{conversation_id}")
