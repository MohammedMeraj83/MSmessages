"""Reel URL validation and persistence workflows."""

from backend.models import reel
from backend.utils.validators import valid_url


def add_reel(*, title: str, source_url: str, embed_url: str | None, thumbnail_url: str | None, platform: str, user_id: int) -> int:
	if not title or len(title) > 255:
		raise ValueError("A title of at most 255 characters is required")
	if not valid_url(source_url):
		raise ValueError("A valid source_url is required")
	if embed_url and not valid_url(embed_url):
		raise ValueError("embed_url must be an HTTP or HTTPS URL")
	if thumbnail_url and not valid_url(thumbnail_url):
		raise ValueError("thumbnail_url must be an HTTP or HTTPS URL")
	if not platform or len(platform) > 50:
		raise ValueError("A platform of at most 50 characters is required")
	return reel.create_reel(
		title=title.strip(), source_url=source_url, embed_url=embed_url,
		thumbnail_url=thumbnail_url, platform=platform.strip(), created_by=user_id,
	)
