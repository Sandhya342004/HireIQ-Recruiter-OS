from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from bson import ObjectId
from datetime import datetime, timezone
import uuid

from database import candidates_col, interview_sessions_col
from auth import get_current_user
from pydantic import BaseModel

class InterviewSchedule(BaseModel):
    candidate_id: str
    job_id: str
    date: str          # ISO date string
    time: str          # e.g. "10:30"
    mode: str          # "online" | "offline"
    location: Optional[str] = ""
    notes: Optional[str] = ""
    duration: Optional[int] = 30

class InterviewFeedbackCreate(BaseModel):
    candidate_id: str
    hr_notes: str

class InterviewStartRequest(BaseModel):
    candidate_id: str
    duration: Optional[int] = 30

class AnalyzeRequest(BaseModel):
    candidate_id: str

router = APIRouter(prefix="/interviews", tags=["interviews"])

@router.post("/schedule")
async def schedule_interview(
    interview: InterviewSchedule,
    current_user=Depends(get_current_user),
):
    candidate_id = interview.candidate_id
    
    # Check if there is already another candidate scheduled at the same date and time
    existing_booking = await candidates_col.find_one({
        "_id": {"$ne": ObjectId(candidate_id)},
        "interview.date": interview.date,
        "interview.time": interview.time,
        "interview.status": "scheduled"
    })
    if existing_booking:
        raise HTTPException(
            status_code=400,
            detail="This time slot is already booked. Please select a different time."
        )
        
    import os
    import random
    random_id = random.randint(10000000, 99999999)
    room_name = f"interview-{candidate_id}-{random_id}"
    
    # Create LiveKit room
    from services.livekit_service import create_room, is_livekit_configured
    livekit_url = os.getenv("LIVEKIT_URL", "")
    if is_livekit_configured():
        try:
            await create_room(room_name, empty_timeout=3600, max_participants=2)
        except Exception as lk_e:
            print(f"[Interview] LiveKit room pre-create warning: {lk_e} — will auto-create on join.")
    
    from services.email_service import send_email, get_interview_scheduled_template
    from database import jobs_col
    import os
    
    candidate = await candidates_col.find_one({"_id": ObjectId(candidate_id), "created_by": current_user["email"]})
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    job = await jobs_col.find_one({"_id": ObjectId(interview.job_id), "created_by": current_user["email"]})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    from services.notification_service import notification_service
    
    interview_data = interview.model_dump()
    secure_token = uuid.uuid4().hex
    # Build the candidate join URL from the configured FRONTEND_URL.
    # This ensures external candidates always get a reachable link,
    # never a localhost URL.
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")
    candidate_join_url = f"{frontend_url}/candidate-interview/{secure_token}"

    interview_data["secure_token"] = secure_token
    interview_data["livekit_room"] = room_name
    interview_data["livekit_url"] = livekit_url
    interview_data["candidate_join_url"] = candidate_join_url
    interview_data["meeting_link"] = candidate_join_url
    interview_data["status"] = "scheduled"
    interview_data["scheduled_at"] = datetime.now(timezone.utc)
    interview_data["scheduled_by"] = current_user.get("email")
    interview_data["recruiter_email"] = current_user.get("email")  # Stored for scheduler reminders

    result = await candidates_col.update_one(
        {"_id": ObjectId(candidate_id)},
        {"$set": {
            "status": "interview_scheduled",
            "pipeline_stage": "interview_scheduled",
            "interview": interview_data,
            "scheduled_by_email": current_user.get("email"),  # top-level for easy querying
            "updated_at": datetime.now(timezone.utc),
        }},
    )

    if result.matched_count > 0:
        # 1. Schedule Background Reminder for Recruiter
        # Extract ISO date/time for scheduling
        # interview.date is usually 'YYYY-MM-DD' and interview.time is 'HH:MM'
        try:
            scheduled_iso = f"{interview.date}T{interview.time}:00"
            await notification_service.schedule_interview_reminders(
                candidate_id=candidate_id,
                scheduled_time_str=scheduled_iso,
                recruiter_email=current_user.get("email")
            )
        except Exception as e:
            print(f"[Interview] Failed to schedule reminder: {e}")

        # 2. Send HR-ONLY Email Notification
        print(f"\n{'#'*55}")
        print(f"[SCHEDULE_INTERVIEW] ENTERED email sending block")
        print(f"[SCHEDULE_INTERVIEW] HR email: {current_user.get('email')}")
        print(f"[SCHEDULE_INTERVIEW] Candidate: {candidate.get('name')}")
        print(f"{'#'*55}")

        from services.email_service import send_email, get_db_email_settings, get_fallback_settings
        settings = await get_db_email_settings() or get_fallback_settings()
        
        score_val = candidate.get('score')
        c_score = round(score_val) if isinstance(score_val, (int, float)) else 0
        c_email = candidate.get('email', 'N/A')
        job_role = job.get('title', 'Job Role') if job else 'Job Role'
        
        hs = candidate.get("hiring_summary") or {}
        ai = candidate.get("ai_analysis") or {}
        c_summary = hs.get("narrative") or hs.get("summary") or ai.get("executive_summary") or "Candidate demonstrates strong technical and operational alignment with the role requirements."
        if not c_summary or c_summary == "N/A" or "No summary available" in c_summary:
            c_summary = "Candidate demonstrates strong technical and operational alignment with the role requirements."
            
        matched_skills = candidate.get("matched_skills") or []
        if not matched_skills:
            matched_skills = candidate.get("skills") or []
        c_skills = ", ".join(matched_skills[:5]) if matched_skills else "General competency"
        
        hr_html = f"""
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <h2 style="color: #4f46e5;">Interview Scheduled Successfully</h2>
            <p>You have scheduled an interview with <b>{candidate['name']}</b>.</p>
            
            <div style="background: #f8fafc; padding: 15px; border-radius: 6px; margin: 15px 0;">
                <p style="margin:5px 0;"><b>Candidate:</b> {candidate['name']}</p>
                <p style="margin:5px 0;"><b>Candidate Email:</b> {c_email}</p>
                <p style="margin:5px 0;"><b>Role:</b> {job_role}</p>
                <p style="margin:5px 0;"><b>Interview Date:</b> {interview.date}</p>
                <p style="margin:5px 0;"><b>Interview Time:</b> {interview.time}</p>
                <p style="margin:5px 0;"><b>Candidate Interview Link:</b> <a href="{candidate_join_url}">{candidate_join_url}</a></p>
                <p style="margin:5px 0;"><b>AI Match Score:</b> {c_score}%</p>
                <p style="margin:5px 0;"><b>Top Skills:</b> {c_skills}</p>
            </div>
            
            <p><b>AI Summary:</b><br/>{c_summary}</p>
            
            <hr style="margin-top:20px; border:none; border-top: 1px solid #e2e8f0;">
            <p style="font-size: 12px; color: #64748b;">Please copy the candidate interview link from your HireIQ dashboard and share it directly with the candidate via email, WhatsApp, or your preferred channel.</p>
            <p style="font-size: 12px; color: #64748b;">A reminder will be sent to you 15 minutes before the start time.</p>
        </div>
        """
        
        # Send confirmation to HR ONLY (no email to candidate)
        hr_email = current_user.get("email")
        subject = f"Interview Scheduled — {candidate['name']} | {job_role}"
        
        print(f"[SCHEDULE_INTERVIEW] Calling send_email() -> {hr_email}")
        try:
            success = await send_email(hr_email, subject, hr_html)
            print(f"[SCHEDULE_INTERVIEW] send_email() result: {success}")
        except Exception as e:
            import traceback
            print(f"[SCHEDULE_INTERVIEW] send_email() RAISED EXCEPTION: {e}")
            traceback.print_exc()

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Candidate not found")

    return {
        "message": "Interview scheduled successfully",
        "candidate_join_url": candidate_join_url,
        "secure_token": secure_token,
        "livekit_room": room_name,
    }

@router.post("/feedback")
async def create_interview_feedback(
    feedback: InterviewFeedbackCreate,
    current_user=Depends(get_current_user),
):
    candidate = await candidates_col.find_one({"_id": ObjectId(feedback.candidate_id)})
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    resume_score = candidate.get("score", 0.0)

    structured_feedback = {
        "communication": "Average",
        "confidence": "Average",
        "recommendation": "Pending review",
        "raw_response": ""
    }

    # Try Groq first
    try:
        from services.llm_service import is_groq_available, llm_generate
        if is_groq_available():
            prompt = (
                f"You are an HR Interview Evaluator.\n"
                f"The candidate's AI Resume Match Score is {int(resume_score * 100)}%.\n"
                f"HR interviewer notes: {feedback.hr_notes}\n\n"
                "Based on this, evaluate in exactly 3 lines:\n"
                "Communication: [Excellent/Good/Average/Poor]\n"
                "Confidence: [Excellent/Good/Average/Poor]\n"
                "Recommendation: [Hire / Strong Hire / Reject / Hold]"
            )
            text = llm_generate(prompt, temperature=0.3, max_tokens=80)
            structured_feedback["raw_response"] = text
            for line in text.split('\n'):
                line = line.strip()
                if line.lower().startswith("communication:"):
                    structured_feedback["communication"] = line.split(":", 1)[1].strip()
                elif line.lower().startswith("confidence:"):
                    structured_feedback["confidence"] = line.split(":", 1)[1].strip()
                elif line.lower().startswith("recommendation:"):
                    structured_feedback["recommendation"] = line.split(":", 1)[1].strip()
    except Exception:
        pass

    # Rule-based fallback if Groq not available or call failed
    if not structured_feedback.get("raw_response"):
        notes_lower = feedback.hr_notes.lower()
        if "good" in notes_lower or "great" in notes_lower or "excellent" in notes_lower:
            structured_feedback["communication"] = "Good"
            structured_feedback["confidence"] = "Good"
            structured_feedback["recommendation"] = "Hire" if resume_score > 0.6 else "Hold"
        elif "poor" in notes_lower or "bad" in notes_lower or "weak" in notes_lower:
            structured_feedback["communication"] = "Poor"
            structured_feedback["confidence"] = "Poor"
            structured_feedback["recommendation"] = "Reject"
        else:
            structured_feedback["communication"] = "Average"
            structured_feedback["confidence"] = "Average"
            structured_feedback["recommendation"] = "Hold"

    await candidates_col.update_one(
        {"_id": ObjectId(feedback.candidate_id)},
        {"$set": {"interview_feedback": structured_feedback}}
    )
    return {"message": "Feedback generated and saved", "feedback": structured_feedback}

class FaceStatsCreate(BaseModel):
    candidate_id: str
    looking_away_count: int
    no_face_count: int
    multiple_faces_count: int
    tab_switches: Optional[int] = 0
    copy_paste_count: Optional[int] = 0
    posture_shift: Optional[int] = 0
    presence: Optional[bool] = True
    suspicious_events: Optional[list] = []
    smiling_count: Optional[int] = 0
    talking_count: Optional[int] = 0
    anxious_count: Optional[int] = 0

class ProctoringViolation(BaseModel):
    candidate_id: str
    violation_type: str   # "tab_switch" | "fullscreen_exit" | "copy_paste" | "face_absent" | "multiple_faces" | "inactivity" | "window_blur"
    severity: str = "medium"  # "low" | "medium" | "high"
    details: Optional[str] = ""
    count: Optional[int] = 1

@router.post("/proctoring-event")
async def record_proctoring_event(violation: ProctoringViolation):
    """Record a real-time anti-cheating violation event from the candidate's browser."""
    event = {
        "violation_type": violation.violation_type,
        "severity": violation.severity,
        "details": violation.details,
        "count": violation.count,
        "timestamp": datetime.now(timezone.utc),
    }

    await candidates_col.update_one(
        {"_id": ObjectId(violation.candidate_id)},
        {
            "$push": {"proctoring_violations": event},
            "$inc": {f"proctoring_counts.{violation.violation_type}": violation.count},
        }
    )
    await interview_sessions_col.update_one(
        {"candidate_id": violation.candidate_id, "meeting_status": "LIVE"},
        {"$push": {"proctoring_violations": event}}
    )
    return {"recorded": True}

@router.get("/proctoring-live/{candidate_id}")
async def get_live_proctoring(candidate_id: str, current_user=Depends(get_current_user)):
    """Recruiter polls this for live proctoring status."""
    candidate = await candidates_col.find_one({"_id": ObjectId(candidate_id), "created_by": current_user["email"]})
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    violations = candidate.get("proctoring_violations", [])
    counts = candidate.get("proctoring_counts", {})

    # Fetch live transcript from the active interview session
    session = await interview_sessions_col.find_one({
        "candidate_id": candidate_id,
        "meeting_status": "LIVE"
    })
    transcript = session.get("transcript", []) if session else []

    # Filter out system sync events when calculating integrity violations
    non_violation_types = [
        "candidate_joined",
        "candidate_left",
        "video_muted",
        "video_active",
        "mic_muted",
        "mic_active"
    ]
    
    violation_counts = {
        k: v for k, v in counts.items() 
        if k not in non_violation_types
    } if counts else {}
    
    total_violations = sum(violation_counts.values())
    
    actual_violations = [v for v in violations if v.get("violation_type") not in non_violation_types]
    high_sev = sum(1 for v in actual_violations if v.get("severity") == "high")
    integrity_score = max(0, 100 - (total_violations * 5) - (high_sev * 10))

    # Speaking Ratio live calculation
    total_candidate_words = 0
    total_interviewer_words = 0
    for chunk in transcript:
        if isinstance(chunk, dict):
            text = chunk.get("text", "")
            speaker = chunk.get("speaker", "Candidate")
        else:
            text = str(chunk)
            speaker = "Candidate"
        words = len(text.split())
        if speaker == "Interviewer":
            total_interviewer_words += words
        else:
            total_candidate_words += words
            
    total_words = total_candidate_words + total_interviewer_words
    speaking_ratio = {
        "candidate": round((total_candidate_words / total_words) * 100, 1) if total_words > 0 else 50.0,
        "interviewer": round((total_interviewer_words / total_words) * 100, 1) if total_words > 0 else 50.0
    }

    # Webcam Activity Status (sync with LiveKit events)
    video_events = [v for v in violations if v.get("violation_type") in ["video_muted", "video_active"]]
    if video_events:
        webcam_status = "Muted" if video_events[-1].get("violation_type") == "video_muted" else "Active"
    else:
        face_stats = candidate.get("face_stats", [])
        if face_stats:
            last_stat = face_stats[-1]
            webcam_status = "Active" if last_stat.get("presence", True) else "No Face Detected"
        else:
            webcam_status = "No Feed"

    # Silence Detection (sync with LiveKit events)
    mic_events = [v for v in violations if v.get("violation_type") in ["mic_muted", "mic_active", "long_silence"]]
    if mic_events:
        has_recent_silence = mic_events[-1].get("violation_type") in ["mic_muted", "long_silence"]
    else:
        has_recent_silence = any(v.get("violation_type") == "long_silence" for v in violations[-3:])

    return {
        "violations": violations[-20:],  # last 20
        "counts": counts,
        "total_violations": total_violations,
        "integrity_score": integrity_score,
        "risk_level": "high" if integrity_score < 50 else "medium" if integrity_score < 75 else "low",
        "transcript": transcript,
        "speaking_ratio": speaking_ratio,
        "webcam_status": webcam_status,
        "silence_detected": has_recent_silence,
    }

@router.post("/start")
async def start_interview(
    req: InterviewStartRequest,
    current_user=Depends(get_current_user),
):
    candidate = await candidates_col.find_one({"_id": ObjectId(req.candidate_id)})
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
        
    interview_info = candidate.get("interview") or {}
    current_status = interview_info.get("status") or "scheduled"
    
    # State check: Recruiter can only start if scheduled, candidate_joined or already live (for resume/rejoin)
    if current_status not in ["scheduled", "candidate_joined", "live"]:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot start interview. Invalid current status: '{current_status}'. Only scheduled or candidate joined interviews can be started."
        )

    # Enforce start window (limit: up to 15 minutes past scheduled start time)
    if interview_info.get("date") and interview_info.get("time"):
        try:
            sched_date = interview_info["date"]
            sched_time = interview_info["time"]
            scheduled_dt = datetime.fromisoformat(f"{sched_date}T{sched_time}:00")
            
            from datetime import timedelta
            now_local = datetime.now()
            
            if now_local > scheduled_dt + timedelta(minutes=15):
                raise HTTPException(
                    status_code=400,
                    detail="This interview session has expired. The start window was within 15 minutes of the scheduled time."
                )
        except HTTPException:
            raise
        except Exception as e:
            print(f"[Start Interview] Error checking start window: {e}")

    # Prevent duplicate live session creation on page refresh/rejoin
    if interview_info.get("status") == "live" or candidate.get("status") == "interview_live":
        active_session = await interview_sessions_col.find_one({
            "candidate_id": req.candidate_id,
            "meeting_status": "LIVE"
        })
        if active_session:
            return {
                "message": "Resuming live interview session",
                "session_id": active_session["session_id"]
            }

    session_id = str(uuid.uuid4())
    start_time = datetime.now(timezone.utc)
    
    # Store session state in interview_sessions collection
    session_doc = {
        "session_id": session_id,
        "candidate_id": req.candidate_id,
        "job_id": candidate.get("job_id"),
        "recruiter_email": current_user.get("email"),
        "start_time": start_time,
        "end_time": None,
        "recruiter_joined": True,
        "candidate_joined": True,
        "meeting_status": "LIVE",
        "scheduled_duration": req.duration,
        "meeting_link": interview_info.get("meeting_link"),
        "transcript": [],
        "face_stats": [],
    }
    await interview_sessions_col.insert_one(session_doc)
    
    # Update candidate state to LIVE
    await candidates_col.update_one(
        {"_id": ObjectId(req.candidate_id)},
        {"$set": {
            "status": "interview_live",
            "interview.status": "live",
            "interview.session_id": session_id,
            "interview.start_time": start_time,
            "interview.recruiter_joined": True,
            "interview.candidate_joined": True,
            "updated_at": datetime.now(timezone.utc)
        }}
    )
    
    return {"message": "Interview started", "session_id": session_id}

@router.post("/end")
async def end_interview(
    req: AnalyzeRequest,
    current_user=Depends(get_current_user),
):
    candidate = await candidates_col.find_one({"_id": ObjectId(req.candidate_id)})
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
        
    session = await interview_sessions_col.find_one({
        "candidate_id": req.candidate_id,
        "meeting_status": "LIVE"
    })
    
    end_time = datetime.utcnow()
    duration_secs = 0.0
    if session:
        start_time = session["start_time"]
        if start_time.tzinfo is not None:
            start_time = start_time.astimezone(timezone.utc).replace(tzinfo=None)
        duration_secs = (end_time - start_time).total_seconds()
        await interview_sessions_col.update_one(
            {"_id": session["_id"]},
            {"$set": {
                "meeting_status": "COMPLETED",
                "end_time": end_time,
                "duration": duration_secs
            }}
        )
    else:
        start_time = candidate.get("interview", {}).get("start_time")
        if start_time:
            if isinstance(start_time, str):
                s_raw = start_time
                if s_raw.endswith("Z"):
                    s_raw = s_raw[:-1]
                start_time = datetime.fromisoformat(s_raw)
            if start_time.tzinfo is not None:
                start_time = start_time.astimezone(timezone.utc).replace(tzinfo=None)
            duration_secs = (end_time - start_time).total_seconds()
            
    # Update candidate state to COMPLETED
    await candidates_col.update_one(
        {"_id": ObjectId(req.candidate_id)},
        {"$set": {
            "status": "interview_completed",
            "pipeline_stage": "interview_completed",
            "interview.status": "completed",
            "interview.end_time": end_time,
            "interview.duration_seconds": duration_secs,
            "updated_at": datetime.utcnow()
        }}
    )
    
    # Clean up LiveKit room
    livekit_room = candidate.get("interview", {}).get("livekit_room")
    if livekit_room:
        try:
            from services.livekit_service import delete_room
            await delete_room(livekit_room)
        except Exception as lk_err:
            print(f"[Interview End] LiveKit room delete warning: {lk_err}")

    # Trigger AI analysis pipeline
    import sys
    import os
    sys.path.append(os.path.abspath(os.path.dirname(__file__)))
    from services.ai_analysis import generate_interview_feedback
    
    try:
        feedback = await generate_interview_feedback(req.candidate_id)
        if session:
            await interview_sessions_col.update_one(
                {"_id": session["_id"]},
                {"$set": {"ai_analysis": feedback}}
            )
        return {"message": "Interview completed and analyzed", "feedback": feedback}
    except Exception as e:
        print(f"[Interview End Error] Analysis failed: {e}")
        return {"message": "Interview completed, analysis failed", "error": str(e)}

@router.post("/face-stats")
async def add_face_stats(stats: FaceStatsCreate):
    stat_entry = {
        "looking_away_count": stats.looking_away_count,
        "no_face_count": stats.no_face_count,
        "multiple_faces_count": stats.multiple_faces_count,
        "tab_switches": stats.tab_switches,
        "copy_paste_count": stats.copy_paste_count,
        "posture_shift": stats.posture_shift,
        "presence": stats.presence,
        "suspicious_events": stats.suspicious_events,
        "smiling_count": stats.smiling_count or 0,
        "talking_count": stats.talking_count or 0,
        "anxious_count": stats.anxious_count or 0,
        "timestamp": datetime.now(timezone.utc)
    }
    
    # Appends new face stats reading to the candidate doc
    await candidates_col.update_one(
        {"_id": ObjectId(stats.candidate_id)},
        {"$push": {"face_stats": stat_entry}}
    )
    
    # Appends to the active session
    await interview_sessions_col.update_one(
        {"candidate_id": stats.candidate_id, "meeting_status": "LIVE"},
        {"$push": {"face_stats": stat_entry}}
    )
    
    return {"message": "Stats recorded"}

@router.post("/analyze")
async def analyze_interview(req: AnalyzeRequest):
    import sys
    import os
    sys.path.append(os.path.abspath(os.path.dirname(__file__)))
    from services.ai_analysis import generate_interview_feedback
    
    try:
        feedback = await generate_interview_feedback(req.candidate_id)
        return {"message": "Analysis generated", "feedback": feedback}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Interview Question Generator ─────────────────────────────────────────────

class QuestionGenRequest(BaseModel):
    job_id: str
    candidate_id: Optional[str] = None   # If provided, personalise questions

BEHAVIORAL_TEMPLATES = [
    "Tell me about a time you faced a significant technical challenge and how you resolved it.",
    "Describe a situation where you had to learn a new technology quickly to meet a deadline.",
    "Give an example of when you disagreed with a team member or manager and how you handled it.",
    "Tell me about a project where you had to collaborate cross-functionally. What was your role?",
    "Describe a time when you identified a critical bug or issue before it reached production.",
]

def _skills_based_questions(job_title: str, skills: list, exp_years: float = 0) -> list:
    """Generate template-based interview questions from job skills."""
    questions = []

    # Technical questions per skill
    for skill in skills[:5]:
        questions.append({
            "type": "Technical",
            "question": f"Can you walk me through your experience with {skill}? What's the most complex thing you've built using it?",
        })

    # Behavioral questions (role-specific)
    level = "senior" if exp_years >= 5 else "mid-level" if exp_years >= 2 else "junior"
    questions.append({
        "type": "Behavioral",
        "question": f"For a {level} {job_title} role, what do you consider your strongest technical contribution in the past year?",
    })
    for bt in BEHAVIORAL_TEMPLATES[:3]:
        questions.append({"type": "Behavioral", "question": bt})

    # Architecture / system design (if senior)
    if exp_years >= 4:
        questions.append({
            "type": "System Design",
            "question": f"Design a scalable {job_title.lower()} system that needs to handle 1M requests per day. Walk me through your approach.",
        })

    # Closing
    questions.append({
        "type": "Culture Fit",
        "question": "What does your ideal engineering team and working culture look like?",
    })
    questions.append({
        "type": "Motivation",
        "question": f"Why are you interested in this {job_title} position specifically, and what do you hope to achieve in your first 90 days?",
    })

    return questions[:10]


async def _groq_questions(job_title: str, skills: list, description: str) -> Optional[list]:
    """Generate interview questions via Groq/LLaMA-3.3. Returns None on failure."""
    try:
        from services.llm_service import is_groq_available, llm_generate
        if not is_groq_available():
            return None
        skills_str = ", ".join(skills[:8]) if skills else "general software skills"
        prompt = (
            f"You are a senior technical recruiter preparing a {job_title} interview.\n"
            f"Required skills: {skills_str}\n"
            f"Job context: {description[:500]}\n\n"
            "Generate exactly 8 interview questions. Mix:\n"
            "- 3 technical questions testing the required skills\n"
            "- 3 behavioral STAR-format questions\n"
            "- 1 system design question\n"
            "- 1 motivation question\n\n"
            "Format each question as:\n"
            "TYPE: [Technical/Behavioral/System Design/Motivation]\n"
            "Q: [The question]\n\n"
            "Be specific. Reference the actual skills and role context."
        )
        text = llm_generate(prompt, temperature=0.5, max_tokens=800)
        questions = []
        for block in [b.strip() for b in text.split("\n\n") if b.strip()]:
            lines = block.split("\n")
            q_type, q_text = "Technical", ""
            for line in lines:
                if line.upper().startswith("TYPE:"):
                    q_type = line.split(":", 1)[1].strip()
                elif line.upper().startswith("Q:"):
                    q_text = line.split(":", 1)[1].strip()
            if q_text:
                questions.append({"type": q_type, "question": q_text})
        return questions if len(questions) >= 4 else None
    except Exception:
        return None


@router.post("/generate-questions")
async def generate_interview_questions(
    req: QuestionGenRequest,
    current_user=Depends(get_current_user),
):
    """
    Generate 8-10 role-specific interview questions for a job.
    Uses Cohere if available; falls back to skills-based templates.
    """
    from database import jobs_col, candidates_col

    job = await jobs_col.find_one({"_id": ObjectId(req.job_id), "created_by": current_user["email"]})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    job_title = job.get("title", "Software Engineer")
    skills = job.get("required_skills", [])
    description = job.get("description", "")
    exp_years = 0.0

    # If candidate given, personalise
    candidate = None
    if req.candidate_id:
        try:
            candidate = await candidates_col.find_one({"_id": ObjectId(req.candidate_id), "created_by": current_user["email"]})
        except Exception:
            pass
    if candidate:
        exp_years = float(candidate.get("experience_years", 0))
        # Merge candidate skills with missing skills for targeted questions
        missing = candidate.get("missing_skills", [])
        if missing:
            skills = missing[:3] + [s for s in skills if s not in missing][:5]

    # Try Groq first
    questions = await _groq_questions(job_title, skills, description)

    # Template fallback
    if not questions:
        questions = _skills_based_questions(job_title, skills, exp_years)

    return {
        "job_title": job_title,
        "total": len(questions),
        "questions": questions,
        "generated_by": "groq" if questions and len(questions) >= 8 else "template",
    }


@router.get("/token/{secure_token}")
async def get_interview_by_secure_token(secure_token: str):
    """
    Public endpoint to resolve a secure interview token (candidate side).
    Validates the token, generates a LiveKit candidate JWT, and returns
    everything the candidate page needs to join the call.
    """
    from database import jobs_col
    import os
    candidate = await candidates_col.find_one({"interview.secure_token": secure_token})
    if not candidate:
        raise HTTPException(status_code=404, detail="Invalid interview token or session has expired")

    interview = candidate.get("interview", {})
    interview_status = interview.get("status", "scheduled")

    # Reject if interview already completed or missed
    if interview_status in ["completed", "missed", "cancelled"]:
        raise HTTPException(status_code=410, detail=f"This interview has already {interview_status}. Please contact your recruiter.")

    job = await jobs_col.find_one({"_id": ObjectId(candidate["job_id"])})
    candidate_id = str(candidate["_id"])
    room_name = interview.get("livekit_room")
    livekit_url = interview.get("livekit_url") or os.getenv("LIVEKIT_URL", "")

    # Generate a fresh candidate LiveKit token
    livekit_token = None
    if room_name:
        try:
            from services.livekit_service import generate_candidate_token
            candidate_identity = f"candidate-{candidate_id}"
            candidate_name = candidate.get("name", "Candidate")
            livekit_token = generate_candidate_token(room_name, candidate_identity, candidate_name)
        except Exception as e:
            print(f"[Token] LiveKit candidate token generation failed: {e}")

    return {
        "candidate_id": candidate_id,
        "candidate_name": candidate.get("name"),
        "candidate_email": candidate.get("email"),
        "job_title": job.get("title", "Software Engineer") if job else "Software Engineer",
        "date": interview.get("date"),
        "time": interview.get("time"),
        "status": interview_status,
        "duration": interview.get("duration", 30),
        "livekit_token": livekit_token,
        "livekit_room": room_name,
        "livekit_url": livekit_url,
    }

class TokenRequest(BaseModel):
    candidate_id: str

@router.post("/tokens/recruiter")
async def get_recruiter_token(
    req: TokenRequest,
    current_user=Depends(get_current_user),
):
    """
    Generate a LiveKit recruiter token (host/admin) for the interview room.
    Called by the InterviewRoom page when the recruiter clicks 'Launch Session'.
    """
    import os
    candidate = await candidates_col.find_one({"_id": ObjectId(req.candidate_id), "created_by": current_user["email"]})
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    
    interview = candidate.get("interview") or {}
    room_name = interview.get("livekit_room")
    if not room_name:
        raise HTTPException(status_code=400, detail="No interview room found. Please reschedule the interview.")

    livekit_url = interview.get("livekit_url") or os.getenv("LIVEKIT_URL", "")
    display_name = current_user.get("name") or current_user.get("email") or "Recruiter"
    recruiter_identity = f"recruiter-{current_user.get('email', 'unknown').split('@')[0]}"

    try:
        from services.livekit_service import generate_recruiter_token
        livekit_token = generate_recruiter_token(room_name, recruiter_identity, display_name)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Failed to generate interview token: {str(e)}")

    return {
        "livekit_token": livekit_token,
        "livekit_room": room_name,
        "livekit_url": livekit_url,
        "display_name": display_name,
    }

@router.post("/tokens/candidate")
async def get_candidate_token(req: TokenRequest):
    """
    Generate a LiveKit candidate token (restricted participant).
    Called by the candidate page on 'Join Interview' click.
    """
    import os
    candidate = await candidates_col.find_one({"_id": ObjectId(req.candidate_id)})
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    interview = candidate.get("interview") or {}
    room_name = interview.get("livekit_room")
    if not room_name:
        raise HTTPException(status_code=400, detail="No interview room found. Please contact your recruiter.")

    livekit_url = interview.get("livekit_url") or os.getenv("LIVEKIT_URL", "")
    candidate_id = str(candidate["_id"])
    candidate_name = candidate.get("name", "Candidate")
    candidate_identity = f"candidate-{candidate_id}"

    try:
        from services.livekit_service import generate_candidate_token
        livekit_token = generate_candidate_token(room_name, candidate_identity, candidate_name)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Failed to generate session token: {str(e)}")

    return {
        "livekit_token": livekit_token,
        "livekit_room": room_name,
        "livekit_url": livekit_url,
    }

