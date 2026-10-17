"""Owner-scoped notification API."""

from flask import Blueprint
from flask_jwt_extended import jwt_required

from backend.utils.database import database_cursor
from backend.utils.helpers import error_response, pagination_args, serialize_value, success_response
from backend.utils.security import authenticated_user_id

notifications_bp = Blueprint("notifications", __name__, url_prefix="/api/notifications")


@notifications_bp.get("")
@jwt_required()
def list_notifications():
	limit, before_id = pagination_args(default_limit=30)
	user_id = authenticated_user_id()
	with database_cursor() as cursor:
		cursor.execute(
			"SELECT id, type, title, body, related_message_id, is_read, created_at FROM notifications "
			"WHERE user_id = %s AND (%s = 0 OR id < %s) ORDER BY id DESC LIMIT %s",
			(user_id, before_id, before_id, limit),
		)
		rows = cursor.fetchall()
		cursor.execute("SELECT COUNT(*) AS total FROM notifications WHERE user_id = %s AND is_read = FALSE", (user_id,))
		unread = int(cursor.fetchone()["total"])
	return success_response({"notifications": serialize_value(rows), "limit": limit, "unread_count": unread})


@notifications_bp.patch("/<int:notification_id>/read")
@jwt_required()
def mark_notification_read(notification_id: int):
	with database_cursor(write=True) as cursor:
		cursor.execute(
			"UPDATE notifications SET is_read = TRUE WHERE id = %s AND user_id = %s",
			(notification_id, authenticated_user_id()),
		)
		if cursor.rowcount == 0:
			cursor.execute("SELECT id FROM notifications WHERE id = %s AND user_id = %s", (notification_id, authenticated_user_id()))
			if cursor.fetchone() is None:
				return error_response("NOTIFICATION_NOT_FOUND", "Notification not found", status=404)
	return success_response({"notification_id": notification_id, "is_read": True})


@notifications_bp.post("/read-all")
@jwt_required()
def mark_all_read():
	with database_cursor(write=True) as cursor:
		cursor.execute("UPDATE notifications SET is_read = TRUE WHERE user_id = %s AND is_read = FALSE", (authenticated_user_id(),))
		changed = cursor.rowcount
	return success_response({"updated": changed})
