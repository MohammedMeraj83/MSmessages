"""Conversation message history, sending, and read receipts."""

from flask import Blueprint, request
from flask_jwt_extended import jwt_required

from backend.extensions import limiter, socketio
from backend.models import message
from backend.services.chat_service import ChatAccessError, broadcast_message, message_payload, require_conversation_member, send_conversation_message
from backend.utils.helpers import error_response, pagination_args, serialize_value, success_response
from backend.utils.security import authenticated_user_id
from backend.utils.validators import validate_message

messages_bp = Blueprint("messages", __name__, url_prefix="/api/conversations")


def _send(conversation_id: int):
	data = request.get_json(silent=True) or {}
	message_type = data.get("message_type", "text")
	text = data.get("message_text")
	media_id = data.get("media_id")
	reel_id = data.get("reel_id")
	reply_id = data.get("reply_to_message_id")
	view_once = data.get("view_once", False)
	if not isinstance(view_once, bool):
		return error_response("VALIDATION_ERROR", "view_once must be a boolean")
	for name, value in (("media_id", media_id), ("reel_id", reel_id), ("reply_to_message_id", reply_id)):
		if value is not None and (not isinstance(value, int) or isinstance(value, bool)):
			return error_response("VALIDATION_ERROR", f"{name} must be an integer")
	issue = validate_message(message_type, text, media_id, reel_id)
	if issue:
		return error_response("VALIDATION_ERROR", issue)
	try:
		row = send_conversation_message(
			conversation_id=conversation_id, sender_id=authenticated_user_id(), message_type=message_type,
			message_text=text, media_id=media_id, reel_id=reel_id, reply_to_message_id=reply_id,
			view_once=view_once,
		)
	except ChatAccessError:
		return error_response("CONVERSATION_NOT_FOUND", "Conversation not found", status=404)
	except PermissionError as exc:
		return error_response("MESSAGE_BLOCKED", str(exc), status=403)
	except LookupError as exc:
		return error_response("RELATED_ITEM_NOT_FOUND", str(exc), status=404)
	payload = {"success": True, "data": {"message": serialize_value(message_payload(row))}}
	broadcast_message(conversation_id, payload)
	return success_response(payload["data"], status=201)


@messages_bp.get("/<int:conversation_id>/messages")
@jwt_required()
def get_messages(conversation_id: int):
	try:
		require_conversation_member(conversation_id, authenticated_user_id())
	except ChatAccessError:
		return error_response("CONVERSATION_NOT_FOUND", "Conversation not found", status=404)
	limit, before_id = pagination_args()
	rows = message.list_messages(conversation_id, limit=limit, before_id=before_id)
	return success_response({"messages": serialize_value([message_payload(row) for row in rows]), "limit": limit})


@messages_bp.post("/<int:conversation_id>/messages")
@jwt_required()
@limiter.limit("60 per minute")
def post_message(conversation_id: int):
	return _send(conversation_id)


@messages_bp.post("/<int:conversation_id>/messages/<int:message_id>/read")
@jwt_required()
def mark_read(conversation_id: int, message_id: int):
	try:
		require_conversation_member(conversation_id, authenticated_user_id())
	except ChatAccessError:
		return error_response("CONVERSATION_NOT_FOUND", "Conversation not found", status=404)
	sender_id = message.mark_message_read(message_id, authenticated_user_id(), conversation_id)
	if sender_id is None:
		return error_response("MESSAGE_NOT_FOUND", "Message not found", status=404)
	return success_response({"message_id": message_id, "read": True})



@messages_bp.post("/<int:conversation_id>/read")
@jwt_required()
def mark_conversation_read(conversation_id: int):
	try:
		require_conversation_member(conversation_id, authenticated_user_id())
	except ChatAccessError:
		return error_response("CONVERSATION_NOT_FOUND", "Conversation not found", status=404)
	ids = message.mark_conversation_read(conversation_id, authenticated_user_id())
	if ids:
		socketio.emit(
			"messages_read",
			{"conversation_id": conversation_id, "message_ids": ids, "user_id": authenticated_user_id()},
			to=f"conversation_{conversation_id}",
		)
	return success_response({"conversation_id": conversation_id, "message_ids": ids})
