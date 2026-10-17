"""Media validation, disk storage, and database metadata operations."""

from pathlib import Path
from typing import Any

from flask import current_app
from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename

from backend.models import media
from backend.utils.security import safe_server_filename
from backend.utils.validators import valid_upload

MIME_TYPES = {
	"jpg": {"image/jpeg"}, "jpeg": {"image/jpeg"}, "png": {"image/png"}, "webp": {"image/webp"},
	"mp4": {"video/mp4"}, "webm": {"video/webm", "audio/webm"}, "mov": {"video/quicktime"},
	"mp3": {"audio/mpeg"}, "wav": {"audio/wav", "audio/x-wav"}, "ogg": {"audio/ogg"},
	"pdf": {"application/pdf"}, "doc": {"application/msword"},
	"docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
}
MIN_UPLOAD_BYTES = 64


def signature_matches(extension: str, head: bytes) -> bool:
	"""Check real file bytes, not just the client-declared extension / content type."""
	if extension in {"jpg", "jpeg"}:
		return head.startswith(b"\xff\xd8\xff")
	if extension == "png":
		return head.startswith(b"\x89PNG\r\n\x1a\n")
	if extension == "webp":
		return head[:4] == b"RIFF" and head[8:12] == b"WEBP"
	if extension == "pdf":
		return head.startswith(b"%PDF")
	if extension == "mp4":
		return head[4:8] == b"ftyp"
	if extension == "mov":
		return head[4:8] in {b"ftyp", b"moov", b"mdat", b"wide", b"free", b"skip"}
	if extension == "webm":
		return head.startswith(b"\x1a\x45\xdf\xa3")
	if extension == "ogg":
		return head.startswith(b"OggS")
	if extension == "mp3":
		return head.startswith(b"ID3") or (len(head) > 1 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0)
	if extension == "wav":
		return head[:4] == b"RIFF" and head[8:12] == b"WAVE"
	if extension == "doc":
		return head.startswith(b"\xd0\xcf\x11\xe0")
	if extension == "docx":
		return head.startswith(b"PK")
	return False


def pick_category(original_name: str, extension: str, mime_type: str, allowed: dict[str, set[str]]) -> str | None:
	for name, extensions in allowed.items():
		if not valid_upload(original_name, extensions) or mime_type not in MIME_TYPES.get(extension, set()):
			continue
		# .webm is both a video and an audio container: voice notes (audio/webm) must not land in "videos".
		if name == "videos" and mime_type.startswith("audio/"):
			continue
		if name == "audio" and mime_type.startswith("video/"):
			continue
		return name
	return None


MEDIA_TYPES = {"images": "image", "videos": "video", "audio": "audio", "files": "file"}


def store_upload(upload: FileStorage, user_id: int) -> dict[str, Any]:
	if not upload or not upload.filename:
		raise ValueError("A file is required")
	original_name = secure_filename(upload.filename)[:255]
	if not original_name:
		raise ValueError("Invalid file name")
	extension = original_name.rsplit(".", 1)[-1].lower() if "." in original_name else ""
	mime_type = (upload.mimetype or "").split(";", 1)[0].strip().lower()
	settings = current_app.config
	category = pick_category(original_name, extension, mime_type, settings["ALLOWED_EXTENSIONS"])
	if category is None:
		raise ValueError("File extension and content type are not allowed")
	maximum = settings["MAX_CONTENT_LENGTH"]
	upload.stream.seek(0, 2)
	file_size = upload.stream.tell()
	upload.stream.seek(0)
	if file_size < MIN_UPLOAD_BYTES or file_size > maximum:
		raise ValueError("File is empty, too small or too large")
	head = upload.stream.read(16)
	upload.stream.seek(0)
	if not signature_matches(extension, head):
		raise ValueError("File content does not match its type")
	file_name = safe_server_filename(original_name)
	category_folder = Path(settings["UPLOAD_ROOT"]) / category
	category_folder.mkdir(parents=True, exist_ok=True)
	destination = category_folder / file_name
	upload.save(destination)
	relative_path = f"{category}/{file_name}"
	try:
		media_id = media.create_media(
			user_id=user_id,
			file_name=file_name,
			original_name=original_name,
			file_type=MEDIA_TYPES[category],
			file_size=file_size,
			storage_path=relative_path,
			mime_type=mime_type,
		)
	except Exception:
		destination.unlink(missing_ok=True)
		raise
	return {
		"media_id": media_id, "file_name": file_name, "file_type": MEDIA_TYPES[category],
		"file_size": file_size, "mime_type": mime_type, "media_url": f"/api/media/{media_id}",
	}

