"""Authenticated WebRTC ICE server configuration."""

from flask import Blueprint, current_app
from flask_jwt_extended import jwt_required

from backend.utils.helpers import success_response

calls_bp = Blueprint("calls", __name__, url_prefix="/api/calls")


@calls_bp.get("/ice-servers")
@jwt_required()
def ice_servers():
	servers = [{"urls": "stun:stun.l.google.com:19302"}, {"urls": "stun:stun1.l.google.com:19302"}]
	config = current_app.config
	if config["TURN_URLS"] and config["TURN_USERNAME"] and config["TURN_CREDENTIAL"]:
		servers.append({
			"urls": config["TURN_URLS"],
			"username": config["TURN_USERNAME"],
			"credential": config["TURN_CREDENTIAL"],
		})
	return success_response({"ice_servers": servers, "turn_configured": len(servers) > 2})