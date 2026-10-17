"""Profile, password, and user blocking endpoints."""

import re
from pathlib import Path

import pymysql

from flask import Blueprint, current_app, request, send_from_directory
from flask_jwt_extended import jwt_required

from backend.extensions import limiter
from backend.models import user
from backend.utils.database import database_cursor
from backend.utils.helpers import error_response, serialize_value, success_response
from backend.utils.security import authenticated_user_id, hash_password, verify_password
from backend.utils.validators import password_error, valid_username

users_bp = Blueprint("users", __name__, url_prefix="/api")
AVATAR_PATTERN = re.compile(r"/api/media/(\d+)")


@users_bp.get("/users/<int:target_user_id>/avatar")
@jwt_required()
def get_user_avatar(target_user_id: int):
	viewer_id = authenticated_user_id()
	with database_cursor() as cursor:
		cursor.execute(
			"SELECT target.avatar FROM users target WHERE target.id = %s AND target.avatar IS NOT NULL "
			"AND (target.id = %s OR EXISTS (SELECT 1 FROM conversation_members mine "
			"JOIN conversation_members theirs ON theirs.conversation_id = mine.conversation_id "
			"WHERE mine.user_id = %s AND theirs.user_id = target.id))",
			(target_user_id, viewer_id, viewer_id),
		)
		row = cursor.fetchone()
	if not row:
		return error_response("AVATAR_NOT_FOUND", "Avatar not found", status=404)
	avatar = row["avatar"]
	try:
		media_id = int(str(avatar).rsplit("/", 1)[-1])
	except (TypeError, ValueError):
		return error_response("AVATAR_NOT_FOUND", "Avatar not found", status=404)
	from backend.models.media import find_media
	media_record = find_media(media_id)
	# The avatar must be an image uploaded by that very user; otherwise anyone could expose another user's media.
	if not media_record or media_record["file_type"] != "image" or int(media_record["user_id"]) != target_user_id:
		return error_response("AVATAR_NOT_FOUND", "Avatar not found", status=404)
	path = Path(media_record["storage_path"])
	if path.is_absolute() or ".." in path.parts or len(path.parts) != 2:
		return error_response("AVATAR_NOT_FOUND", "Avatar not found", status=404)
	return send_from_directory(Path(current_app.config["UPLOAD_ROOT"]) / path.parts[0], path.parts[1], mimetype=media_record["mime_type"])


@users_bp.get("/profile")
@jwt_required()
def get_profile():
	profile = user.find_user_by_id(authenticated_user_id())
	return success_response({"user": serialize_value(profile)}) if profile else error_response("USER_NOT_FOUND", "User not found", status=404)


@users_bp.patch("/profile")
@jwt_required()
def patch_profile():
	data = request.get_json(silent=True) or {}
	allowed = {"full_name", "username", "bio", "avatar"}
	if set(data) - allowed:
		return error_response("INVALID_FIELDS", "Only full_name, username, bio, and avatar can be updated")
	if "username" in data and not valid_username(data["username"]):
		return error_response("VALIDATION_ERROR", "username must be 3-30 letters, numbers, or underscores")
	for field, maximum in (("full_name", 120), ("bio", 500), ("avatar", 512)):
		if field in data and data[field] is not None and (not isinstance(data[field], str) or len(data[field]) > maximum):
			return error_response("VALIDATION_ERROR", f"{field} must be at most {maximum} characters")
	if "full_name" in data and (not isinstance(data["full_name"], str) or not data["full_name"].strip()):
		return error_response("VALIDATION_ERROR", "full_name cannot be empty")
	if isinstance(data.get("full_name"), str):
		data["full_name"] = data["full_name"].strip()
	if "avatar" in data:
		avatar = data["avatar"] or None
		if avatar is not None:
			match = AVATAR_PATTERN.fullmatch(avatar) if isinstance(avatar, str) else None
			record = None
			if match:
				from backend.models.media import find_media
				record = find_media(int(match.group(1)))
			if not record or record["file_type"] != "image" or int(record["user_id"]) != authenticated_user_id():
				return error_response("VALIDATION_ERROR", "avatar must be an image you uploaded")
		data["avatar"] = avatar
	try:
		user.update_profile(authenticated_user_id(), data)
	except pymysql.err.IntegrityError:
		return error_response("USERNAME_EXISTS", "That username is already in use", status=409)
	return success_response({"user": serialize_value(user.find_user_by_id(authenticated_user_id()))})


@users_bp.post("/profile/password")
@jwt_required()
@limiter.limit("5 per hour")
def change_password():
	data = request.get_json(silent=True) or {}
	old_password, new_password = data.get("current_password"), data.get("new_password")
	if not isinstance(old_password, str) or not isinstance(new_password, str):
		return error_response("VALIDATION_ERROR", "current_password and new_password are required")
	problem = password_error(new_password)
	if problem:
		return error_response("VALIDATION_ERROR", problem)
	account = user.find_user_by_id(authenticated_user_id(), include_password=True)
	if not account or not verify_password(account["password_hash"], old_password):
		return error_response("INVALID_CREDENTIALS", "Current password is incorrect", status=401)
	user.set_password(authenticated_user_id(), hash_password(new_password))
	with database_cursor(write=True) as cursor:
		cursor.execute("DELETE FROM user_sessions WHERE user_id = %s", (authenticated_user_id(),))
	return success_response({"message": "Password updated; please sign in again"})


@users_bp.put("/users/<int:target_user_id>/block")
@jwt_required()
def block_user(target_user_id: int):
	current_user_id = authenticated_user_id()
	if current_user_id == target_user_id or not user.find_user_by_id(target_user_id):
		return error_response("USER_NOT_FOUND", "Target user was not found", status=404)
	with database_cursor(write=True) as cursor:
		cursor.execute("INSERT IGNORE INTO blocked_users (blocker_id, blocked_id) VALUES (%s, %s)", (current_user_id, target_user_id))
	return success_response({"blocked": True})


@users_bp.delete("/users/<int:target_user_id>/block")
@jwt_required()
def unblock_user(target_user_id: int):
	with database_cursor(write=True) as cursor:
		cursor.execute("DELETE FROM blocked_users WHERE blocker_id = %s AND blocked_id = %s", (authenticated_user_id(), target_user_id))
	return success_response({"blocked": False})


@users_bp.get("/users/<int:target_user_id>/blocked")
@jwt_required()
def check_blocked(target_user_id: int):
	with database_cursor() as cursor:
		cursor.execute("SELECT 1 FROM blocked_users WHERE blocker_id = %s AND blocked_id = %s", (authenticated_user_id(), target_user_id))
		blocked = cursor.fetchone() is not None
	return success_response({"blocked": blocked})

