"""Authentication session operations."""

from datetime import datetime

from backend.utils.database import database_cursor
from backend.utils.security import hash_token


def create_session(user_id: int, jti: str, expires_at: datetime, device_info: str | None, ip_address: str | None) -> None:
	with database_cursor(write=True) as cursor:
		cursor.execute(
			"INSERT INTO user_sessions (user_id, session_token_hash, device_info, ip_address, expires_at) "
			"VALUES (%s, %s, %s, %s, %s)",
			(user_id, hash_token(jti), (device_info or "")[:512], ip_address, expires_at),
		)


def session_is_active(jti: str) -> bool:
	with database_cursor() as cursor:
		cursor.execute(
			"SELECT 1 FROM user_sessions WHERE session_token_hash = %s AND expires_at > UTC_TIMESTAMP(6) LIMIT 1",
			(hash_token(jti),),
		)
		return cursor.fetchone() is not None


def revoke_session(jti: str) -> None:
	with database_cursor(write=True) as cursor:
		cursor.execute(
			"UPDATE user_sessions SET expires_at = UTC_TIMESTAMP(6) WHERE session_token_hash = %s",
			(hash_token(jti),),
		)

