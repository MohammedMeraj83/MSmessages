"""Input validation shared by HTTP routes and Socket.IO handlers."""

import re
from urllib.parse import urlparse

EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_]{3,30}$")
MESSAGE_TYPES = {"text", "image", "video", "audio", "file", "reel"}


def valid_email(value: object) -> bool:
	return isinstance(value, str) and len(value) <= 254 and bool(EMAIL_PATTERN.fullmatch(value.strip()))


def valid_username(value: object) -> bool:
	return isinstance(value, str) and bool(USERNAME_PATTERN.fullmatch(value))


def password_error(value: object) -> str | None:
	if not isinstance(value, str) or len(value) < 10 or len(value) > 128:
		return "Password must be between 10 and 128 characters"
	if not any(char.isalpha() for char in value) or not any(char.isdigit() for char in value):
		return "Password must include letters and numbers"
	return None


def validate_message(message_type: object, text: object, media_id: object = None, reel_id: object = None) -> str | None:
	if message_type not in MESSAGE_TYPES:
		return "Unsupported message type"
	if text is not None and (not isinstance(text, str) or len(text) > 10000):
		return "Message text must be at most 10000 characters"
	if message_type == "text" and (not isinstance(text, str) or not text.strip()):
		return "Text messages cannot be empty"
	if message_type in {"image", "video", "audio", "file"} and not isinstance(media_id, int):
		return "A valid media_id is required"
	if message_type == "reel" and not isinstance(reel_id, int):
		return "A valid reel_id is required"
	return None


def valid_upload(filename: str, allowed_extensions: set[str]) -> bool:
	return "." in filename and filename.rsplit(".", 1)[1].lower() in allowed_extensions


def valid_url(value: object) -> bool:
	if not isinstance(value, str) or len(value) > 2048:
		return False
	parsed = urlparse(value)
	return parsed.scheme in {"http", "https"} and bool(parsed.netloc)

