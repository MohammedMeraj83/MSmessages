"""Password, token, and filename security helpers."""

import hashlib
import secrets

from flask_jwt_extended import get_jwt_identity
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename


def hash_password(password: str) -> str:
	return generate_password_hash(password, method="scrypt")


def verify_password(password_hash: str, password: str) -> bool:
	return check_password_hash(password_hash, password)


def generate_secure_token(length: int = 32) -> str:
	return secrets.token_urlsafe(length)


def hash_token(token: str) -> str:
	return hashlib.sha256(token.encode("utf-8")).hexdigest()


def safe_server_filename(original_name: str) -> str:
	safe_name = secure_filename(original_name)
	suffix = safe_name.rsplit(".", 1)[-1].lower() if "." in safe_name else ""
	random_name = secrets.token_hex(24)
	return f"{random_name}.{suffix}" if suffix else random_name


def authenticated_user_id() -> int:
	identity = get_jwt_identity()
	try:
		return int(identity)
	except (TypeError, ValueError) as exc:
		raise ValueError("Invalid authenticated user") from exc

