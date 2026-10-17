"""Private media upload and authorized download endpoints."""

from pathlib import Path

from flask import Blueprint, current_app, request, send_from_directory
from flask_jwt_extended import jwt_required

from backend.extensions import limiter
from backend.models import media, message
from backend.services.media_service import store_upload
from backend.utils.database import database_cursor
from backend.utils.helpers import error_response, success_response
from backend.utils.security import authenticated_user_id

media_bp = Blueprint("media", __name__, url_prefix="/api/media")


@media_bp.post("/upload")
@jwt_required()
@limiter.limit("60 per hour")
def upload_media():
	upload = request.files.get("file")
	try:
		uploaded = store_upload(upload, authenticated_user_id())
	except ValueError as exc:
		return error_response("INVALID_UPLOAD", str(exc), status=400)
	return success_response(uploaded, status=201)


@media_bp.get("/<int:media_id>")
@jwt_required()
def get_media(media_id: int):
	if not media.media_accessible_to_user(media_id, authenticated_user_id()):
		return error_response("MEDIA_NOT_FOUND", "Media not found", status=404)
	record = media.find_media(media_id)
	if not record:
		return error_response("MEDIA_NOT_FOUND", "Media not found", status=404)
	view_state = media.view_once_state(media_id, authenticated_user_id())
	if view_state and view_state["view_once"] and not view_state["is_sender"]:
		return error_response("VIEW_ONCE_MEDIA", "This photo can only be opened once", status=410)
	relative_path = Path(record["storage_path"])
	if relative_path.is_absolute() or ".." in relative_path.parts or len(relative_path.parts) != 2:
		return error_response("MEDIA_NOT_FOUND", "Media not found", status=404)
	category, file_name = relative_path.parts
	return send_from_directory(Path(current_app.config["UPLOAD_ROOT"]) / category, file_name, mimetype=record["mime_type"], as_attachment=False, download_name=record["original_name"])



@media_bp.post("/<int:media_id>/view-once")
@jwt_required()
def view_once_media(media_id: int):
	user_id = authenticated_user_id()
	state = media.view_once_state(media_id, user_id)
	if not state or not state["view_once"] or state["is_sender"] or state["viewed_at"] is not None:
		return error_response("VIEW_ONCE_UNAVAILABLE", "This photo has already been opened or is unavailable", status=410)
	row = message.consume_view_once(state["message_id"], user_id, _conversation_id_for_message(state["message_id"]))
	if not row:
		return error_response("VIEW_ONCE_UNAVAILABLE", "This photo has already been opened or is unavailable", status=410)
	path = Path(row["storage_path"])
	if path.is_absolute() or ".." in path.parts or len(path.parts) != 2:
		return error_response("MEDIA_NOT_FOUND", "Media not found", status=404)
	return send_from_directory(
		Path(current_app.config["UPLOAD_ROOT"]) / path.parts[0],
		path.parts[1],
		mimetype=row["mime_type"],
		as_attachment=False,
		download_name=row["original_name"],
	)


@media_bp.post("/<path:invalid_media_id>/view-once")
def invalid_view_once_media(invalid_media_id: str):
	if invalid_media_id.isdecimal():
		return view_once_media(int(invalid_media_id))
	return error_response("INVALID_MEDIA_ID", "A numeric media ID is required", status=400)


def _conversation_id_for_message(message_id: int) -> int:
	with database_cursor() as cursor:
		cursor.execute("SELECT conversation_id FROM messages WHERE id = %s", (message_id,))
		row = cursor.fetchone()
		if not row:
			return 0
		return int(row["conversation_id"])
