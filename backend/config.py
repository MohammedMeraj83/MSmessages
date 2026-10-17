"""Application configuration loaded from the backend environment file."""

import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env")


def _allowed_origins() -> list[str]:
	port = os.getenv("PORT", "5000")
	default_origins = (
		"http://localhost:5000,http://127.0.0.1:5000,"
		"http://localhost:5500,http://127.0.0.1:5500,"
		"http://localhost:5173,http://127.0.0.1:5173,"
		f"http://localhost:{port},http://127.0.0.1:{port}"
	)
	configured = os.getenv("CORS_ORIGINS", default_origins)
	return [origin.strip() for origin in configured.split(",") if origin.strip()]


class Config:
	SECRET_KEY = os.getenv("SECRET_KEY") or secrets.token_hex(32)
	JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY") or secrets.token_hex(32)
	JWT_ACCESS_TOKEN_EXPIRES = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRES", "3600"))
	JWT_TOKEN_LOCATION = ["headers"]
	JWT_HEADER_TYPE = "Bearer"
	DB_HOST = os.getenv("DB_HOST", "")
	DB_PORT = int(os.getenv("DB_PORT", "3306"))
	DB_NAME = os.getenv("DB_NAME", "aetheris_db")
	DB_USER = os.getenv("DB_USER", "")
	DB_PASSWORD = os.getenv("DB_PASSWORD", "")
	DATABASE = {
		"host": DB_HOST,
		"port": DB_PORT,
		"database": DB_NAME,
		"user": DB_USER,
		"password": DB_PASSWORD,
	}
	UPLOAD_FOLDER = os.getenv("UPLOAD_FOLDER", "uploads")
	UPLOAD_ROOT = (BACKEND_DIR / UPLOAD_FOLDER).resolve()
	MAX_CONTENT_LENGTH = int(os.getenv("MAX_CONTENT_LENGTH", str(50 * 1024 * 1024)))
	ALLOWED_EXTENSIONS = {
		"images": {"jpg", "jpeg", "png", "webp"},
		"videos": {"mp4", "webm", "mov"},
		"audio": {"mp3", "wav", "ogg", "webm"},
		"files": {"pdf", "doc", "docx"},
	}
	CORS_ORIGINS = _allowed_origins()
	TURN_URLS = [url.strip() for url in os.getenv("TURN_URLS", "").split(",") if url.strip()]
	TURN_USERNAME = os.getenv("TURN_USERNAME", "")
	TURN_CREDENTIAL = os.getenv("TURN_CREDENTIAL", "")
	RATELIMIT_STORAGE_URI = os.getenv("RATELIMIT_STORAGE_URI", "memory://")
	RATELIMIT_HEADERS_ENABLED = True
	JSON_SORT_KEYS = False


class DevelopmentConfig(Config):
	DEBUG = os.getenv("FLASK_DEBUG", "1").lower() in {"1", "true", "yes"}


class ProductionConfig(Config):
	DEBUG = False
	TESTING = False

