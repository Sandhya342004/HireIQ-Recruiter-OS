"""
LiveKit Service — services/livekit_service.py
=============================================
Manages LiveKit room creation and secure JWT token generation
for HireIQ interview sessions.

Roles
-----
- Recruiter  : roomAdmin + canPublish + canSubscribe
- Candidate  : canPublish + canSubscribe only (NO admin, NO data publish)

Environment Variables Required
------------------------------
LIVEKIT_URL        = wss://your-project.livekit.cloud
LIVEKIT_API_KEY    = APIxxxxxxxxxxxx
LIVEKIT_API_SECRET = xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
"""

import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

LIVEKIT_URL = os.getenv("LIVEKIT_URL", "")
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "")


def is_livekit_configured() -> bool:
    """Return True if all LiveKit environment variables are set."""
    return bool(LIVEKIT_URL and LIVEKIT_API_KEY and LIVEKIT_API_SECRET)


def generate_recruiter_token(
    room_name: str,
    recruiter_identity: str,
    recruiter_name: str,
    ttl_seconds: int = 14400,  # 4 hours
) -> str:
    """
    Generate a LiveKit JWT for the recruiter (host/moderator).

    Grants:
    - roomAdmin (can mute/kick participants)
    - canPublish (camera + mic)
    - canSubscribe (receive candidate A/V)
    - canPublishData (send data messages)
    - roomJoin (explicit join permission)
    """
    if not is_livekit_configured():
        raise RuntimeError(
            "LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, "
            "and LIVEKIT_API_SECRET in backend/.env"
        )

    from livekit.api import AccessToken, VideoGrants
    import datetime

    grants = VideoGrants(
        room_join=True,
        room=room_name,
        can_publish=True,
        can_subscribe=True,
        can_publish_data=True,
        room_admin=True,
    )

    token = (
        AccessToken(api_key=LIVEKIT_API_KEY, api_secret=LIVEKIT_API_SECRET)
        .with_identity(recruiter_identity)
        .with_name(recruiter_name)
        .with_ttl(datetime.timedelta(seconds=ttl_seconds))
        .with_grants(grants)
    )

    jwt = token.to_jwt()
    logger.info(f"[LiveKit] Recruiter token generated for room={room_name}, identity={recruiter_identity}")
    return jwt



def generate_candidate_token(
    room_name: str,
    candidate_identity: str,
    candidate_name: str,
    ttl_seconds: int = 7200,  # 2 hours
) -> str:
    """
    Generate a LiveKit JWT for the candidate (restricted participant).

    Grants:
    - canPublish (camera + mic only)
    - canSubscribe (receive recruiter A/V)
    - NO roomAdmin
    - NO canPublishData (cannot send arbitrary data messages)
    """
    if not is_livekit_configured():
        raise RuntimeError(
            "LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, "
            "and LIVEKIT_API_SECRET in backend/.env"
        )

    from livekit.api import AccessToken, VideoGrants
    import datetime

    grants = VideoGrants(
        room_join=True,
        room=room_name,
        can_publish=True,
        can_subscribe=True,
        can_publish_data=False,
        room_admin=False,
    )

    token = (
        AccessToken(api_key=LIVEKIT_API_KEY, api_secret=LIVEKIT_API_SECRET)
        .with_identity(candidate_identity)
        .with_name(candidate_name)
        .with_ttl(datetime.timedelta(seconds=ttl_seconds))
        .with_grants(grants)
    )

    jwt = token.to_jwt()
    logger.info(f"[LiveKit] Candidate token generated for room={room_name}, identity={candidate_identity}")
    return jwt



async def create_room(
    room_name: str,
    empty_timeout: int = 600,
    max_participants: int = 2,
) -> dict:
    """
    Create a LiveKit room via the server-side REST API.
    Returns the room info dict on success, or raises on failure.

    Parameters
    ----------
    room_name       : Unique room name (e.g. 'interview-<id>-<random>')
    empty_timeout   : Seconds after last participant leaves before room is deleted.
    max_participants: Enforce 2-person limit (recruiter + candidate).
    """
    if not is_livekit_configured():
        raise RuntimeError(
            "LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, "
            "and LIVEKIT_API_SECRET in backend/.env"
        )

    try:
        from livekit.api import LiveKitAPI
        from livekit.api.room_service import proto_room
        CreateRoomRequest = proto_room.CreateRoomRequest

        http_url = LIVEKIT_URL.replace("wss://", "https://").replace("ws://", "http://")
        lk = LiveKitAPI(
            url=http_url,
            api_key=LIVEKIT_API_KEY,
            api_secret=LIVEKIT_API_SECRET,
        )
        try:
            request = CreateRoomRequest(
                name=room_name,
                empty_timeout=empty_timeout,
                max_participants=max_participants,
            )
            room = await lk.room.create_room(request)
            logger.info(f"[LiveKit] Room created: {room_name}")
            return {
                "name": room.name,
                "sid": room.sid,
                "max_participants": room.max_participants,
                "empty_timeout": room.empty_timeout,
            }
        finally:
            await lk.aclose()
    except Exception as e:
        logger.error(f"[LiveKit] Failed to create room {room_name}: {e}")
        # Graceful degradation: return a stub so scheduling still works
        # The room will be created lazily when the first participant joins.
        logger.warning("[LiveKit] Proceeding without pre-created room (room will auto-create on join).")
        return {"name": room_name, "sid": None, "error": str(e)}


async def delete_room(room_name: str) -> bool:
    """
    Delete a LiveKit room after the interview ends.
    Returns True on success, False on failure.
    """
    if not is_livekit_configured():
        return False

    try:
        from livekit.api import LiveKitAPI
        from livekit.api.room_service import proto_room
        DeleteRoomRequest = proto_room.DeleteRoomRequest

        http_url = LIVEKIT_URL.replace("wss://", "https://").replace("ws://", "http://")
        lk = LiveKitAPI(
            url=http_url,
            api_key=LIVEKIT_API_KEY,
            api_secret=LIVEKIT_API_SECRET,
        )
        try:
            request = DeleteRoomRequest(room=room_name)
            await lk.room.delete_room(request)
            logger.info(f"[LiveKit] Room deleted: {room_name}")
            return True
        finally:
            await lk.aclose()
    except Exception as e:
        logger.error(f"[LiveKit] Failed to delete room {room_name}: {e}")
        return False
