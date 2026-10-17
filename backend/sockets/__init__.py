"""Socket.IO event registration."""

from backend.extensions import socketio
from backend.sockets import chat_events, presence_events


def register_socket_events() -> None:
	socketio.on_event("connect", presence_events.connect)
	socketio.on_event("disconnect", presence_events.disconnect)
	socketio.on_event("join_conversation", chat_events.join_conversation)
	socketio.on_event("leave_conversation", chat_events.leave_conversation)
	socketio.on_event("send_message", chat_events.send_message)
	socketio.on_event("typing_start", chat_events.typing_start)
	socketio.on_event("typing_stop", chat_events.typing_stop)
	socketio.on_event("message_read", chat_events.message_read)
	socketio.on_event("message_delivered", chat_events.message_delivered)
	socketio.on_event("conversation_read", chat_events.conversation_read)
	socketio.on_event("call_start", chat_events.start_call)
	socketio.on_event("call_signal", chat_events.call_signal)


__all__ = ["register_socket_events"]
