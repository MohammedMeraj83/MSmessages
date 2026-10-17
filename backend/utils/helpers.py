"""Consistent JSON responses, pagination, timestamps, and serialization."""

from datetime import datetime, timezone
from typing import Any

from flask import jsonify


def success_response(data: Any = None, *, status: int = 200):
	return jsonify({"success": True, "data": data if data is not None else {}}), status


def error_response(code: str, message: str, *, status: int = 400):
	return jsonify({"success": False, "error": {"code": code, "message": message}}), status


def pagination_args(default_limit: int = 50, max_limit: int = 100) -> tuple[int, int]:
	from flask import request

	try:
		limit = min(max(int(request.args.get("limit", default_limit)), 1), max_limit)
		before_id = max(int(request.args.get("before_id", "0")), 0)
	except ValueError:
		limit, before_id = default_limit, 0
	return limit, before_id


def serialize_value(value: Any) -> Any:
	if isinstance(value, datetime):
		return value.astimezone(timezone.utc).isoformat() if value.tzinfo else value.isoformat()
	if isinstance(value, dict):
		return {key: serialize_value(item) for key, item in value.items()}
	if isinstance(value, (list, tuple)):
		return [serialize_value(item) for item in value]
	return value

