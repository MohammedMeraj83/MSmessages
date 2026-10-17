"""URL-reference reel endpoints; this service does not fetch reel content."""

from flask import Blueprint, request
from flask_jwt_extended import jwt_required

from backend.models import reel
from backend.services.reel_service import add_reel
from backend.utils.helpers import error_response, pagination_args, serialize_value, success_response
from backend.utils.security import authenticated_user_id

reels_bp = Blueprint("reels", __name__, url_prefix="/api/reels")


@reels_bp.get("")
@jwt_required()
def list_reels():
	limit, before_id = pagination_args(default_limit=30)
	return success_response({"reels": serialize_value(reel.list_reels(limit=limit, before_id=before_id)), "limit": limit})


@reels_bp.post("")
@jwt_required()
def post_reel():
	data = request.get_json(silent=True) or {}
	required = ("title", "source_url", "platform")
	if any(not isinstance(data.get(key), str) or not data[key].strip() for key in required):
		return error_response("VALIDATION_ERROR", "title, source_url, and platform are required")
	try:
		reel_id = add_reel(
			title=data["title"], source_url=data["source_url"], embed_url=data.get("embed_url"),
			thumbnail_url=data.get("thumbnail_url"), platform=data["platform"], user_id=authenticated_user_id(),
		)
	except ValueError as exc:
		return error_response("VALIDATION_ERROR", str(exc))
	return success_response({"reel_id": reel_id}, status=201)

