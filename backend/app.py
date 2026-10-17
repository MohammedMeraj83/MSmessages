"""AETHERIS Flask and Socket.IO application entry point."""

import os
import sys
from pathlib import Path

# Allow both `python app.py` from backend/ and package imports from the project root.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
	sys.path.insert(0, str(PROJECT_ROOT))

from flask import Flask, jsonify, request, send_from_directory
FRONTEND_DIR = PROJECT_ROOT / "frontend"
from werkzeug.exceptions import HTTPException

from backend.config import DevelopmentConfig, ProductionConfig
from backend.extensions import cors, jwt, limiter, socketio
from backend.routes import (
	auth_bp, calls_bp, conversations_bp, media_bp, messages_bp,
	notifications_bp, reels_bp, users_bp,
)
from backend.services.auth_service import session_is_active
from backend.sockets import register_socket_events
from backend.utils.helpers import error_response


def create_app(config_object=DevelopmentConfig) -> Flask:
	if config_object is ProductionConfig and (not os.getenv("SECRET_KEY") or not os.getenv("JWT_SECRET_KEY")):
		raise RuntimeError("SECRET_KEY and JWT_SECRET_KEY must be configured for production")
	app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path="")
	app.config.from_object(config_object)
	app.config["MAX_CONTENT_LENGTH"] = int(app.config["MAX_CONTENT_LENGTH"])
	app.config["UPLOAD_ROOT"].mkdir(parents=True, exist_ok=True)
	for category in app.config["ALLOWED_EXTENSIONS"]:
		(app.config["UPLOAD_ROOT"] / category).mkdir(parents=True, exist_ok=True)

	cors.init_app(
		app,
		resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}},
		supports_credentials=True,
		allow_headers=["Authorization", "Content-Type"],
		methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
	)
	jwt.init_app(app)
	limiter.init_app(app)
	socketio.init_app(
		app,
		cors_allowed_origins=None,
		async_mode=os.getenv("SOCKETIO_ASYNC_MODE", "threading"),
		message_queue=os.getenv("SOCKETIO_MESSAGE_QUEUE") or None,
	)
	register_socket_events()

	for blueprint in (auth_bp, calls_bp, conversations_bp, messages_bp, media_bp, reels_bp, users_bp, notifications_bp):
		app.register_blueprint(blueprint)

	@app.get("/")
	def frontend_index():
		return send_from_directory(FRONTEND_DIR, "index.html")

	@app.after_request
	def security_headers(response):
		response.headers.setdefault("X-Content-Type-Options", "nosniff")
		response.headers.setdefault("Referrer-Policy", "same-origin")
		if request.path.startswith("/api/"):
			response.headers.setdefault("Cache-Control", "no-store")
		return response

	@app.get("/favicon.ico")
	def favicon():
		return "", 204

	@jwt.token_in_blocklist_loader
	def token_is_revoked(header, payload):
		del header
		try:
			return not session_is_active(payload["jti"])
		except Exception:
			return True

	@jwt.unauthorized_loader
	def missing_token(reason):
		del reason
		return error_response("AUTHENTICATION_REQUIRED", "Authentication is required", status=401)

	@jwt.invalid_token_loader
	def invalid_token(reason):
		del reason
		return error_response("INVALID_TOKEN", "Authentication token is invalid", status=401)

	@jwt.expired_token_loader
	def expired_token(header, payload):
		del header, payload
		return error_response("TOKEN_EXPIRED", "Authentication token has expired", status=401)

	@app.get("/api/health")
	def health():
		return jsonify({"success": True, "message": "AETHERIS backend is running"})

	@app.errorhandler(HTTPException)
	def http_error(error: HTTPException):
		return error_response(f"HTTP_{error.code}", error.name, status=error.code or 500)

	@app.errorhandler(413)
	def too_large(error):
		del error
		return error_response("UPLOAD_TOO_LARGE", "Request exceeds the configured size limit", status=413)

	@app.errorhandler(429)
	def rate_limited(error):
		del error
		return error_response("RATE_LIMITED", "Too many requests; try again shortly", status=429)

	@app.errorhandler(Exception)
	def unexpected_error(error: Exception):
		if isinstance(error, HTTPException):
			return error
		app.logger.exception("Unhandled backend error")
		return error_response("INTERNAL_ERROR", "An internal server error occurred", status=500)

	return app


app = create_app()


if __name__ == "__main__":
	socketio.run(
		app,
		host=os.getenv("HOST", "127.0.0.1"),
		port=int(os.getenv("PORT", "5000")),
		debug=app.config["DEBUG"],
		use_reloader=False,
		allow_unsafe_werkzeug=True,
	)
