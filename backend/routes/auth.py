"""Registration, login, logout, and current-user API."""

from datetime import datetime, timedelta, timezone

import pymysql
from flask import Blueprint, current_app, request
from flask_jwt_extended import create_access_token, get_jwt, jwt_required

from backend.extensions import limiter
from backend.models import user
from backend.services import auth_service
from backend.sockets.chat_events import disconnect_session_sockets
from backend.utils.helpers import error_response, serialize_value, success_response
from backend.utils.security import authenticated_user_id, hash_password, verify_password
from backend.utils.validators import password_error, valid_email, valid_username

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@auth_bp.post("/register")
@limiter.limit("5 per minute")
def register():
	data = request.get_json(silent=True) or {}
	full_name = data.get("full_name")
	username = data.get("username")
	email = data.get("email")
	password = data.get("password")
	if not all(isinstance(value, str) and value.strip() for value in (full_name, username, email, password)):
		return error_response("VALIDATION_ERROR", "full_name, username, email, and password are required")
	if len(full_name.strip()) > 120:
		return error_response("VALIDATION_ERROR", "full_name must be at most 120 characters")
	if not valid_username(username):
		return error_response("VALIDATION_ERROR", "username must be 3-30 letters, numbers, or underscores")
	if not valid_email(email):
		return error_response("VALIDATION_ERROR", "A valid email address is required")
	problem = password_error(password)
	if problem:
		return error_response("VALIDATION_ERROR", problem)
	email_exists, username_exists = user.email_or_username_exists(email, username)
	if email_exists or username_exists:
		return error_response("ACCOUNT_EXISTS", "Email or username is already registered", status=409)
	try:
		user_id = user.create_user(
			username=username, email=email, password_hash=hash_password(password), full_name=full_name.strip()
		)
	except pymysql.err.IntegrityError:
		return error_response("ACCOUNT_EXISTS", "Email or username is already registered", status=409)
	return success_response({"user": serialize_value(user.find_user_by_id(user_id))}, status=201)


@auth_bp.post("/login")
@limiter.limit("10 per minute")
def login():
	data = request.get_json(silent=True) or {}
	identifier = data.get("email") or data.get("username") or data.get("identifier")
	password = data.get("password")
	if not isinstance(identifier, str) or not isinstance(password, str):
		return error_response("VALIDATION_ERROR", "email or username and password are required")
	account = user.find_user_by_login_identifier(identifier.strip())
	if not account or not verify_password(account["password_hash"], password):
		return error_response("INVALID_CREDENTIALS", "Email or password is incorrect", status=401)
	expires = current_app.config["JWT_ACCESS_TOKEN_EXPIRES"]
	token = create_access_token(identity=str(account["id"]), expires_delta=timedelta(seconds=expires))
	from flask_jwt_extended import decode_token

	claims = decode_token(token)
	auth_service.create_session(
		int(account["id"]), claims["jti"], datetime.fromtimestamp(claims["exp"], timezone.utc),
		request.headers.get("User-Agent"), request.remote_addr,
	)
	safe_user = {key: value for key, value in account.items() if key != "password_hash"}
	return success_response({"access_token": token, "token_type": "Bearer", "user": serialize_value(safe_user)})


@auth_bp.post("/logout")
@jwt_required()
def logout():
	jti = get_jwt()["jti"]
	auth_service.revoke_session(jti)
	disconnect_session_sockets(jti)
	return success_response({"message": "Logged out"})


@auth_bp.get("/me")
@jwt_required()
def me():
	account = user.find_user_by_id(authenticated_user_id())
	if not account:
		return error_response("USER_NOT_FOUND", "User account was not found", status=404)
	return success_response({"user": serialize_value(account)})

