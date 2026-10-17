"""User persistence operations."""

from typing import Any

from backend.utils.database import database_cursor


PUBLIC_FIELDS = "id, username, email, full_name, avatar, bio, is_online, last_seen, created_at, updated_at"


def create_user(*, username: str, email: str, password_hash: str, full_name: str) -> int:
	with database_cursor(write=True) as cursor:
		cursor.execute(
			"INSERT INTO users (username, email, password_hash, full_name) VALUES (%s, %s, %s, %s)",
			(username, email.lower(), password_hash, full_name),
		)
		return int(cursor.lastrowid)


def find_user_by_id(user_id: int, *, include_password: bool = False) -> dict[str, Any] | None:
	fields = f"{PUBLIC_FIELDS}, password_hash" if include_password else PUBLIC_FIELDS
	with database_cursor() as cursor:
		cursor.execute(f"SELECT {fields} FROM users WHERE id = %s", (user_id,))
		return cursor.fetchone()


def find_user_by_email(email: str, *, include_password: bool = False) -> dict[str, Any] | None:
	fields = f"{PUBLIC_FIELDS}, password_hash" if include_password else PUBLIC_FIELDS
	with database_cursor() as cursor:
		cursor.execute(f"SELECT {fields} FROM users WHERE email = %s", (email.lower(),))
		return cursor.fetchone()


def find_user_by_login_identifier(identifier: str) -> dict[str, Any] | None:
	with database_cursor() as cursor:
		cursor.execute(
			f"SELECT {PUBLIC_FIELDS}, password_hash FROM users WHERE email = %s OR username = %s LIMIT 1",
			(identifier.lower(), identifier),
		)
		return cursor.fetchone()


def find_user_by_username(username: str, *, include_password: bool = False) -> dict[str, Any] | None:
	fields = f"{PUBLIC_FIELDS}, password_hash" if include_password else PUBLIC_FIELDS
	with database_cursor() as cursor:
		cursor.execute(f"SELECT {fields} FROM users WHERE username = %s", (username,))
		return cursor.fetchone()


def update_profile(user_id: int, fields: dict[str, Any]) -> bool:
	allowed = {"full_name", "username", "bio", "avatar"}
	values = {key: value for key, value in fields.items() if key in allowed}
	if not values:
		return False
	assignments = ", ".join(f"{key} = %s" for key in values)
	with database_cursor(write=True) as cursor:
		cursor.execute(f"UPDATE users SET {assignments} WHERE id = %s", (*values.values(), user_id))
		return cursor.rowcount > 0


def update_online_status(user_id: int, is_online: bool) -> None:
	with database_cursor(write=True) as cursor:
		cursor.execute(
			"UPDATE users SET is_online = %s, last_seen = CASE WHEN %s = 0 THEN CURRENT_TIMESTAMP(6) ELSE last_seen END WHERE id = %s",
			(is_online, is_online, user_id),
		)


def update_last_seen(user_id: int) -> None:
	with database_cursor(write=True) as cursor:
		cursor.execute("UPDATE users SET last_seen = CURRENT_TIMESTAMP(6) WHERE id = %s", (user_id,))


def set_password(user_id: int, password_hash: str) -> None:
	with database_cursor(write=True) as cursor:
		cursor.execute("UPDATE users SET password_hash = %s WHERE id = %s", (password_hash, user_id))


def email_or_username_exists(email: str, username: str) -> tuple[bool, bool]:
	with database_cursor() as cursor:
		cursor.execute("SELECT email, username FROM users WHERE email = %s OR username = %s", (email.lower(), username))
		rows = cursor.fetchall()
	return any(row["email"].lower() == email.lower() for row in rows), any(row["username"] == username for row in rows)

