"""Private conversation endpoints."""

from flask import Blueprint, request
from flask_jwt_extended import jwt_required

from backend.extensions import socketio

from backend.models import conversation, user
from backend.services.chat_service import ChatAccessError, open_private_conversation
from backend.utils.helpers import error_response, serialize_value, success_response
from backend.sockets.chat_events import join_user_to_conversation
from backend.utils.security import authenticated_user_id

conversations_bp = Blueprint("conversations", __name__, url_prefix="/api/conversations")


@conversations_bp.get("")
@jwt_required()
def list_user_conversations():
	return success_response({"conversations": serialize_value(conversation.list_conversations(authenticated_user_id()))})


@conversations_bp.post("")
@jwt_required()
def create_conversation():
	data = request.get_json(silent=True) or {}
	target_user_id = data.get("target_user_id")
	if target_user_id is None and isinstance(data.get("target_username"), str):
		target = user.find_user_by_username(data["target_username"].strip().removeprefix("@"))
		target_user_id = target["id"] if target else None
	try:
		target_user_id = int(target_user_id)
	except (TypeError, ValueError):
		return error_response("USER_NOT_FOUND", "Target user was not found", status=404)
	try:
		conversation_id, created = open_private_conversation(authenticated_user_id(), target_user_id)
	except LookupError:
		return error_response("USER_NOT_FOUND", "Target user was not found", status=404)
	except PermissionError as exc:
		return error_response("CONVERSATION_BLOCKED", str(exc), status=403)
	except ValueError as exc:
		return error_response("VALIDATION_ERROR", str(exc))
	me = authenticated_user_id()
	conversation_data = serialize_value(conversation.get_conversation(conversation_id, me))
	if created and conversation_data:
		# Both people (all their open tabs) join the room, and each gets the chat from their own point of view.
		for member_id in (me, target_user_id):
			join_user_to_conversation(member_id, conversation_id)
			view = serialize_value(conversation.get_conversation(conversation_id, member_id))
			socketio.emit("conversation_created", {"success": True, "data": {"conversation": view}}, to=f"user_{member_id}")
	return success_response({"conversation": conversation_data, "created": created}, status=201 if created else 200)


@conversations_bp.get("/<int:conversation_id>")
@jwt_required()
def get_conversation(conversation_id: int):
	try:
		from backend.services.chat_service import require_conversation_member

		require_conversation_member(conversation_id, authenticated_user_id())
	except ChatAccessError:
		return error_response("CONVERSATION_NOT_FOUND", "Conversation not found", status=404)
	return success_response({"conversation": serialize_value(conversation.get_conversation(conversation_id, authenticated_user_id()))})

