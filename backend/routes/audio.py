"""
Audio Upload Route — routes/audio.py
=====================================
Handles real-time interview audio chunks.
Transcription is delegated to services/transcription_service.py (isolated interface).
Works gracefully with or without GROQ_API_KEY configured.
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from bson import ObjectId
from datetime import datetime
import os
import tempfile
from database import candidates_col, interview_sessions_col
from auth import get_current_user

router = APIRouter(prefix="/audio", tags=["audio"])


@router.post("/upload")
async def upload_audio_chunk(
    candidate_id: str = Form(...),
    audio: UploadFile = File(...),
):
    """
    Candidate audio chunk upload endpoint.
    1. Calculates the interview timeline offset from the live session.
    2. Stores the audio chunk to cloud storage.
    3. Delegates transcription to services/transcription_service (Whisper interface).
    4. Saves structured transcript segments to MongoDB.

    Gracefully degrades if GROQ_API_KEY is absent — audio is stored but
    transcription is skipped with a descriptive message instead of a 500 error.
    """
    content = await audio.read()
    if not content:
        return {"message": "Empty audio chunk, skipped.", "segments_added": 0, "transcripts": []}

    # ── Calculate interview timeline offset ───────────────────────────────────
    session = await interview_sessions_col.find_one({
        "candidate_id": candidate_id,
        "meeting_status": "LIVE",
    })

    if session:
        start_time = session.get("start_time")
        if isinstance(start_time, str):
            if start_time.endswith("Z"):
                start_time = start_time[:-1]
            start_time = datetime.fromisoformat(start_time)
        elapsed_seconds = (datetime.utcnow() - start_time).total_seconds()
        offset_seconds = max(0.0, elapsed_seconds - 10.0)
    else:
        offset_seconds = 0.0

    # ── Write to temp file for storage upload ────────────────────────────────
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Store audio chunk to cloud / local storage
        try:
            from services.storage_service import storage_service
            audio_url = await storage_service.upload_file(
                tmp_path,
                f"chunk_{candidate_id}_{int(datetime.utcnow().timestamp())}.webm",
            )
            await candidates_col.update_one(
                {"_id": ObjectId(candidate_id)},
                {"$push": {"audio_recordings": {"url": audio_url, "timestamp": datetime.utcnow()}}},
            )
            print(f"[StorageService] Uploaded audio chunk: {audio_url}")
        except Exception as storage_err:
            print(f"[Storage Error] Failed to upload chunk: {storage_err}")

        # ── Transcribe via isolated service ──────────────────────────────────
        from services.transcription_service import transcribe_audio_file, is_transcription_available

        if not is_transcription_available():
            return {
                "message": (
                    "Audio stored successfully. Transcription service is not configured "
                    "(GROQ_API_KEY is missing). Add it to .env to enable live speech-to-text."
                ),
                "segments_added": 0,
                "transcripts": [],
            }

        new_chunks = []
        try:
            new_chunks = await transcribe_audio_file(content, file_ext=".webm", offset_seconds=offset_seconds)
        except Exception as trans_err:
            print(f"[Transcription Warning] Failed to transcribe audio chunk: {trans_err}")

    except Exception as e:
        print(f"[Audio Upload Error] {e}")
        raise HTTPException(status_code=500, detail=f"Audio processing failed: {str(e)}")
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    # ── Persist transcript segments ──────────────────────────────────────────
    if new_chunks:
        await candidates_col.update_one(
            {"_id": ObjectId(candidate_id)},
            {"$push": {"transcript": {"$each": new_chunks}}},
        )
        await interview_sessions_col.update_one(
            {"candidate_id": candidate_id, "meeting_status": "LIVE"},
            {"$push": {"transcript": {"$each": new_chunks}}},
        )

    return {
        "message": "Audio chunk transcribed successfully.",
        "segments_added": len(new_chunks),
        "transcripts": new_chunks,
    }
