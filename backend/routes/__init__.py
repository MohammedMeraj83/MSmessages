"""HTTP blueprint exports."""

from backend.routes.auth import auth_bp
from backend.routes.calls import calls_bp
from backend.routes.conversations import conversations_bp
from backend.routes.media import media_bp
from backend.routes.messages import messages_bp
from backend.routes.notifications import notifications_bp
from backend.routes.reels import reels_bp
from backend.routes.users import users_bp

__all__ = ["auth_bp", "calls_bp", "conversations_bp", "media_bp", "messages_bp", "notifications_bp", "reels_bp", "users_bp"]
