import os
import json
import re
import numpy as np
from bson import ObjectId
from datetime import datetime, timezone
from database import candidates_col, jobs_col, interview_sessions_col

class MultimodalAnalyzer:
    """
    Enterprise-grade AI Interview Analysis Engine.
    Combines web-cam face tracking statistics and audio transcripts with Groq LLM inference.
    """
    def __init__(self, face_stats, transcripts, resume_score, job_title="Software Engineer", job_description="", total_duration_secs=None):
        self.face_stats = face_stats or []
        self.transcripts = transcripts or []
        self.resume_score = float(resume_score or 0.0)
        
        if total_duration_secs is not None and total_duration_secs > 0:
            self.total_seconds = total_duration_secs
        else:
            self.total_seconds = len(face_stats) * 5 if face_stats else 300  # Default to 5 mins if no stats
            
        self.job_title = job_title
        self.job_description = job_description

    def run_heuristics(self):
        # 1. Behavioral
        timeline = []
        eye_contact_vals = []
        no_face_events = 0
        multiple_faces = 0
        tab_switches = 0
        copy_paste = 0
        posture_shifts = 0
        smiling_instances = 0
        talking_instances = 0
        anxious_instances = 0
        total_chunks = max(1, len(self.face_stats))
        
        for i, chunk in enumerate(self.face_stats):
            looking_away = chunk.get("looking_away_count", 0)
            no_face = chunk.get("no_face_count", 0)
            multiple_faces += chunk.get("multiple_faces_count", 0)
            tab_switches += chunk.get("tab_switches", 0)
            copy_paste += chunk.get("copy_paste_count", 0)
            posture_shifts += chunk.get("posture_shift", 0)
            smiling_instances += chunk.get("smiling_count", 0)
            talking_instances += chunk.get("talking_count", 0)
            anxious_instances += chunk.get("anxious_count", 0)
            
            if no_face > 5:
                no_face_events += 1
            
            focus = max(0, 100 - (looking_away * 10) - (no_face * 25))
            event = None
            if focus < 30:
                event = "Distracted" if no_face < 5 else "Left Frame"
            timeline.append({"time": i * 5, "focus": focus, "event": event})
            eye_contact_vals.append(focus)

        avg_eye_contact = np.mean(eye_contact_vals) if eye_contact_vals else 75.0
        stability = max(0, min(100, 100 - (no_face_events * 10)))
        attention_score = avg_eye_contact * 0.8 + stability * 0.2

        # 2. Communication
        full_text = " ".join(self.transcripts)
        words = full_text.split()
        word_count = len(words)
        speaking_secs = word_count / 2.0  # Conservative estimate (2 words/sec)
        silence_secs = max(0, self.total_seconds - speaking_secs)
        
        # Candidate speaking ratio
        speaking_ratio = (speaking_secs / max(1, self.total_seconds)) * 100
        speaking_ratio = min(95.0, max(5.0, speaking_ratio))  # Cap realistic speaking ratio
        
        # Interviewer speaking ratio (heuristically derived or estimated)
        silence_ratio = (silence_secs / max(1, self.total_seconds)) * 100
        interviewer_ratio = max(5.0, 100.0 - speaking_ratio - silence_ratio)
        total_active = speaking_ratio + interviewer_ratio
        if total_active > 100.0:
            speaking_ratio = (speaking_ratio / total_active) * 100.0
            interviewer_ratio = (interviewer_ratio / total_active) * 100.0

        fillers = ["um", "uh", "ah", "like", "basically", "actually", "sort of", "kind of"]
        filler_count = sum(1 for w in words if w.lower() in fillers)
        filler_density = (filler_count / max(1, word_count)) * 100
        
        comm_score = 50.0  # Base
        if word_count > 10:
            if 30 <= speaking_ratio <= 65:
                comm_score += 30
            else:
                comm_score += max(0, 20 - abs(45 - speaking_ratio) * 0.5)
            comm_score += max(0, 20 - filler_density * 3)
        comm_score = min(100.0, max(10.0, comm_score))

        # 3. Proctoring Risk
        risk_score = (multiple_faces * 60) + (tab_switches * 35) + (copy_paste * 20)
        risk_score = min(100.0, risk_score)
        
        cheating_risk = "Low"
        if risk_score > 70: cheating_risk = "Critical"
        elif risk_score > 40: cheating_risk = "High Risk"
        elif risk_score > 15: cheating_risk = "Suspicious"

        # 4. Expressions & Dynamic Multimodal Scoring
        smile_ratio = min(100.0, (smiling_instances / total_chunks) * 100)
        anxious_ratio = min(100.0, (anxious_instances / total_chunks) * 100)
        talking_ratio = min(100.0, (talking_instances / total_chunks) * 100)
        
        # Engagement: Attention, positive smiles, and active verbal speaking ratio
        engagement_score = attention_score * 0.6 + min(100.0, smile_ratio * 3.0) * 0.2 + min(100.0, speaking_ratio * 1.5) * 0.2
        engagement_score = min(100.0, max(20.0, engagement_score))
        
        # Speech Confidence: Eye contact stability, fluent speech pattern, and responsive talking ratio
        confidence_score = avg_eye_contact * 0.5 + max(0, 100 - filler_density * 4) * 0.3 + min(100.0, speaking_ratio * 1.2) * 0.2
        confidence_score = min(100.0, max(20.0, confidence_score))
        
        # Professionalism: Stability in frame, low proctoring events, and low anxiety ratio
        professionalism_score = stability * 0.6 + max(0, 100 - risk_score) * 0.3 + max(0, 100 - anxious_ratio * 4) * 0.1
        professionalism_score = min(100.0, max(20.0, professionalism_score))

        # Event log extraction from actual chunks
        event_log = []
        seen_events = set()
        
        if multiple_faces > 0:
            event_log.append({"category": "Integrity", "severity": "Critical", "message": f"Multiple individuals detected in frame ({multiple_faces} instances).", "time": "Multiple"})
        if tab_switches > 0:
            event_log.append({"category": "Attention", "severity": "Moderate", "message": f"Browser tab switched ({tab_switches} times).", "time": "Variable"})
        if copy_paste > 0:
            event_log.append({"category": "Integrity", "severity": "High", "message": "Suspicious copy/paste clipboard usage detected.", "time": "Instant"})

        for chunk in self.face_stats:
            chunk_events = chunk.get("suspicious_events", [])
            if not isinstance(chunk_events, list):
                continue
            for e in chunk_events:
                if not isinstance(e, dict):
                    continue
                etype = e.get("type")
                etime = e.get("time", "Variable")
                time_display = "Variable"
                if etime and etime != "Variable":
                    try:
                        time_display = datetime.fromisoformat(etime.replace("Z", "+00:00")).strftime("%H:%M:%S")
                    except:
                        time_display = etime
                
                key = f"{etype}_{time_display}"
                if key in seen_events:
                    continue
                seen_events.add(key)
                
                if etype == 'tab_switch':
                    event_log.append({
                        "category": "Attention",
                        "severity": "Moderate",
                        "message": "Candidate switched browser tabs / unfocused the interview panel.",
                        "time": time_display
                    })
                elif etype == 'copy_action':
                    event_log.append({
                        "category": "Integrity",
                        "severity": "High",
                        "message": "Candidate copied text from the screen/clipboard.",
                        "time": time_display
                    })
                elif etype == 'paste_action':
                    event_log.append({
                        "category": "Integrity",
                        "severity": "High",
                        "message": "Candidate pasted external text into the input field.",
                        "time": time_display
                    })
                elif etype == 'multiple_faces':
                    event_log.append({
                        "category": "Integrity",
                        "severity": "Critical",
                        "message": e.get("detail", "Multiple individuals detected in webcam frame."),
                        "time": time_display
                    })
                elif etype == 'looking_away_repeatedly':
                    event_log.append({
                        "category": "Attention",
                        "severity": "Moderate",
                        "message": "Candidate looked away from camera repeatedly.",
                        "time": time_display
                    })
                elif etype == 'long_silence':
                    event_log.append({
                        "category": "Communication",
                        "severity": "Moderate",
                        "message": "Extended silence detected (no verbal response for 10+ seconds).",
                        "time": time_display
                    })

        return {
            "eye_contact": round(avg_eye_contact, 1),
            "stability": round(stability, 1),
            "attention_score": round(attention_score, 1),
            "comm_score": round(comm_score, 1),
            "speaking_ratio": round(speaking_ratio, 1),
            "interviewer_ratio": round(interviewer_ratio, 1),
            "silence_secs": round(silence_secs, 1),
            "word_count": word_count,
            "filler_count": filler_count,
            "risk_score": round(risk_score, 1),
            "cheating_risk": cheating_risk,
            "timeline": timeline,
            "event_log": event_log,
            "interruptions": tab_switches + (1 if no_face_events > 0 else 0),
            
            # Detailed multimodal scores
            "engagement_score": round(engagement_score, 1),
            "confidence_score": round(confidence_score, 1),
            "professionalism_score": round(professionalism_score, 1),
            "smiling_ratio": round(smile_ratio, 1),
            "anxious_ratio": round(anxious_ratio, 1),
            "talking_ratio": round(talking_ratio, 1),
            "posture_shifts": posture_shifts
        }

    async def synthesize_analysis(self, heuristics, candidate_name):
        """Generate LLM synthesis using Groq/LLaMA-3.3. Falls back to heuristics if unavailable."""
        from services.llm_service import is_groq_available, llm_generate_json_async

        full_text = " ".join(self.transcripts)
        if not full_text.strip():
            full_text = "[No verbal transcript recorded during the interview]"

        prompt = f"""
You are an Enterprise AI Interview Intelligence Engine.
Generate a comprehensive, recruiter-ready interview analysis report.

CANDIDATE DETAILS:
- Candidate Name: {candidate_name}
- Target Job: {self.job_title}
- Job Description: {self.job_description[:600]}

INTERVIEW HEURISTICS:
- Gaze Eye Contact: {heuristics['eye_contact']}%
- Visual Attention Score: {heuristics['attention_score']}%
- Verbal Communication Score: {heuristics['comm_score']}%
- Candidate Speaking Ratio: {heuristics['speaking_ratio']}%
- Word Count: {heuristics['word_count']} words
- Filler Words: {heuristics['filler_count']}
- Integrity Risk Score: {heuristics['risk_score']}% ({heuristics['cheating_risk']})

TRANSCRIPT SAMPLE:
"{full_text[:3000]}"

Respond with ONLY a valid JSON object (no markdown). Schema:
{{
  "recommendation": "Strong Hire | Hire | Hold | Reject",
  "verdict": "Brief summary sentence of the hiring decision.",
  "reasoning": "Concise recruiter-ready explanation referencing transcript evidence.",
  "communication_analysis": {{
    "clarity_score": 0,
    "confidence_score": 0,
    "professionalism": 0,
    "engagement": 0,
    "speech_pace": "Normal",
    "hesitation_detection": "Moderate",
    "filler_word_detection": {{"um_uh_count": 0, "like_count": 0, "other_fillers_count": 0}},
    "sentiment_analysis": "Neutral",
    "response_quality": "Medium",
    "evidence_quote": "A direct quote from the transcript."
  }},
  "behavioral_analysis": {{
    "eye_contact": 0,
    "attentiveness": 0,
    "emotional_stability": 0,
    "honesty_indicators": "Medium",
    "stress_indicators": "Medium",
    "distraction_detection": "None",
    "engagement_score": 0,
    "emotion_timeline": [],
    "suspicious_behavior_flags": [],
    "integrity_evidence": "Description of webcam attention and gaze stability."
  }},
  "interview_intelligence": {{
    "interviewer_speaking_ratio": 0,
    "candidate_speaking_ratio": 0,
    "technical_depth_estimation": 0,
    "leadership_indicators": "Average",
    "communication_indicators": "Good",
    "professionalism_indicators": "Medium"
  }},
  "technical_evaluation": {{
    "technical_understanding": 0,
    "depth_of_answers": 0,
    "leadership_indicators": "Average",
    "problem_solving_quality": "Average",
    "evidence_quote": "A direct quote from the transcript."
  }}
}}
"""

        try:
            if not is_groq_available():
                logger.info("[AIAnalysis] Groq unavailable — using heuristic fallback.")
                return self.get_fallback_synthesis(heuristics, candidate_name)

            res = await llm_generate_json_async(prompt, temperature=0.3, max_tokens=1200)

            # Deep-merge with fallback to fill any missing fields
            fallback = self.get_fallback_synthesis(heuristics, candidate_name)
            def deep_merge(d1, d2):
                for k, v in d2.items():
                    if k not in d1 or d1[k] is None:
                        d1[k] = v
                    elif isinstance(v, dict) and isinstance(d1.get(k), dict):
                        deep_merge(d1[k], v)
                return d1
            return deep_merge(res, fallback)

        except Exception as e:
            logger.warning("[AIAnalysis] Groq synthesis failed, using fallback: %s", e)
            return self.get_fallback_synthesis(heuristics, candidate_name)

    def get_fallback_synthesis(self, heuristics, candidate_name):
        score = (heuristics["attention_score"] + heuristics["comm_score"]) / 2
        if heuristics["cheating_risk"] in ["Critical", "High Risk"]:
            rec = "Reject"
            verdict = "Security and proctoring policy violation."
        elif score > 75:
            rec = "Hire"
            verdict = "Candidate metrics meet target benchmarks."
        elif score > 50:
            rec = "Hold"
            verdict = "Candidate metrics within acceptable limits; secondary review recommended."
        else:
            rec = "Reject"
            verdict = "Candidate metrics fall below target benchmarks."

        summary = f"System Heuristics: Communication Clarity: {heuristics['comm_score']}%, Eye Contact: {heuristics['eye_contact']}%, Attention: {heuristics['attention_score']}%."

        return {
            "recommendation": rec,
            "verdict": verdict,
            "reasoning": summary,
            "communication_analysis": {
                "clarity_score": heuristics["comm_score"],
                "confidence_score": heuristics["confidence_score"],
                "professionalism": int(heuristics["professionalism_score"]),
                "engagement": int(heuristics["engagement_score"]),
                "speech_pace": "Normal",
                "hesitation_detection": "Moderate",
                "filler_word_detection": {
                   "um_uh_count": heuristics["filler_count"],
                   "like_count": 0,
                   "other_fillers_count": 0
                },
                "sentiment_analysis": "Neutral",
                "response_quality": "Medium",
                "evidence_quote": "Communication style evaluated based on audio transcription metrics."
            },
            "behavioral_analysis": {
                "eye_contact": heuristics["eye_contact"],
                "attentiveness": heuristics["attention_score"],
                "emotional_stability": int(max(20.0, 100 - heuristics["anxious_ratio"] * 3)),
                "honesty_indicators": "Medium",
                "stress_indicators": "Medium",
                "distraction_detection": "None" if heuristics["attention_score"] > 80 else "Minor distraction" if heuristics["attention_score"] > 50 else "Highly distracted",
                "engagement_score": int(heuristics["engagement_score"]),
                "emotion_timeline": [],
                "suspicious_behavior_flags": [
                    {"timestamp": "Variable", "flag": "Tab Switch", "description": f"Browser tab switched {heuristics.get('interruptions', 0)} times"}
                ] if heuristics.get("interruptions", 0) > 0 else [],
                "integrity_evidence": f"Webcam feed gaze stability at {heuristics['eye_contact']}% and visual attention of {heuristics['attention_score']}%."
            },
            "interview_intelligence": {
                "interviewer_speaking_ratio": heuristics["interviewer_ratio"],
                "candidate_speaking_ratio": heuristics["speaking_ratio"],
                "technical_depth_estimation": int(self.resume_score * 100) if self.resume_score <= 1.0 else int(self.resume_score),
                "leadership_indicators": "Average",
                "communication_indicators": "Average",
                "professionalism_indicators": "Medium"
            },
            "technical_evaluation": {
                "technical_understanding": int(self.resume_score * 100) if self.resume_score <= 1.0 else int(self.resume_score),
                "depth_of_answers": int(self.resume_score * 90) if self.resume_score <= 1.0 else int(self.resume_score * 0.9),
                "leadership_indicators": "Average",
                "problem_solving_quality": "Average",
                "evidence_quote": "Technical understanding evaluated based on matching resume alignment."
            }
        }

async def generate_interview_feedback(candidate_id: str) -> dict:
    # Set status to analyzing first
    await candidates_col.update_one(
        {"_id": ObjectId(candidate_id)},
        {"$set": {
            "status": "interview_analyzing",
            "interview.status": "analyzing",
            "updated_at": datetime.utcnow()
        }}
    )
    candidate = await candidates_col.find_one({"_id": ObjectId(candidate_id)})
    if not candidate:
        raise ValueError("Candidate not found")

    job = await jobs_col.find_one({"_id": ObjectId(candidate["job_id"])})
    job_title = job.get("title", "Software Engineer") if job else "Software Engineer"
    job_description = job.get("description", "") if job else ""

    face_stats = candidate.get("face_stats", [])
    transcripts = candidate.get("transcript", [])
    resume_score = float(candidate.get("score", 0.0))

    # Fetch LiveKit session doc to compute the actual duration and timestamps
    session = await interview_sessions_col.find_one(
        {"candidate_id": candidate_id},
        sort=[("start_time", -1)]
    )
    
    start_time_raw = None
    end_time_raw = None
    
    if session:
        start_time_raw = session.get("start_time")
        end_time_raw = session.get("end_time") or session.get("duration")
        
    if not start_time_raw:
        start_time_raw = candidate.get("interview", {}).get("start_time")
        end_time_raw = candidate.get("interview", {}).get("end_time")

    duration_secs = 0.0
    start_time = None
    end_time = None
    
    if start_time_raw:
        if isinstance(start_time_raw, str):
            s_raw = start_time_raw
            if s_raw.endswith("Z"):
                s_raw = s_raw[:-1]
            start_time = datetime.fromisoformat(s_raw)
        else:
            start_time = start_time_raw
            
        if end_time_raw is not None:
            if isinstance(end_time_raw, (int, float)):
                duration_secs = float(end_time_raw)
                from datetime import timedelta
                end_time = start_time + timedelta(seconds=duration_secs)
            else:
                if isinstance(end_time_raw, str):
                    e_raw = end_time_raw
                    if e_raw.endswith("Z"):
                        e_raw = e_raw[:-1]
                    end_time = datetime.fromisoformat(e_raw)
                else:
                    end_time = end_time_raw
        else:
            end_time = datetime.utcnow()
            
        if start_time.tzinfo is not None:
            start_time = start_time.astimezone(timezone.utc).replace(tzinfo=None)
        if end_time.tzinfo is not None:
            end_time = end_time.astimezone(timezone.utc).replace(tzinfo=None)
            
        duration_secs = (end_time - start_time).total_seconds()
    else:
        end_time = datetime.utcnow()

    # Format join_time and completion_time with 'Z' suffix to denote UTC timezone
    if start_time:
        join_time = start_time.strftime("%Y-%m-%dT%H:%M:%SZ")
    else:
        join_time = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    if end_time:
        completion_time = end_time.strftime("%Y-%m-%dT%H:%M:%SZ")
    else:
        completion_time = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    # Duration in minutes
    duration_mins = max(0, int(duration_secs / 60))

    # Fetch recruiter join status
    recruiter_joined = bool(
        candidate.get("interview", {}).get("recruiter_joined", False) or
        (session and session.get("recruiter_joined", False))
    )

    # ── VALIDATION RULES ──
    # 1. Candidate actually joined meeting
    candidate_joined = bool(
        candidate.get("interview", {}).get("candidate_joined_session", False) or
        candidate.get("interview", {}).get("candidate_joined", False) or
        len(face_stats) > 0 or
        len(transcripts) > 0
    )

    # 2. Transcript exists and has content
    transcript_exists = len(transcripts) > 0

    # Calculate transcript word count
    transcript_word_count = 0
    for t in transcripts:
        if isinstance(t, dict):
            text_content = t.get("text", "")
        else:
            text_content = str(t)
        transcript_word_count += len(text_content.split())

    # 3. Transcript length > minimum threshold (20 words)
    transcript_length_valid = transcript_word_count >= 20

    # 4. Audio duration > minimum threshold (60 seconds)
    duration_valid = duration_secs >= 60.0

    # 5. Webcam activity detected
    webcam_detected = len(face_stats) > 0

    validation_passed = (
        recruiter_joined and
        candidate_joined and
        transcript_exists and
        transcript_length_valid and
        duration_valid and
        webcam_detected
    )

    if not validation_passed:
        missing = []
        if not recruiter_joined: missing.append("Recruiter did not join meeting")
        if not candidate_joined: missing.append("Candidate did not join meeting")
        if not transcript_exists: missing.append("Transcript does not exist")
        if not transcript_length_valid: missing.append(f"Transcript too short ({transcript_word_count}/20 words)")
        if not duration_valid: missing.append(f"Audio duration too short ({int(duration_secs)}/60 seconds)")
        if not webcam_detected: missing.append("No webcam activity detected")

        reasoning_msg = "Insufficient Interview Evidence - No AI evaluation generated"

        result = {
            "incomplete": True,
            "recommendation": "Reject",
            "verdict": "Interview Incomplete",
            "reasoning": reasoning_msg,
            "metadata": {
                "total_duration": f"{duration_mins} minutes",
                "join_time": join_time,
                "completion_time": completion_time,
                "attendance": "Present" if candidate_joined else "Absent",
                "error_details": "Insufficient interview evidence (webcam, microphone, audio/transcript missing, or duration under 5 minutes)."
            },
            "metrics": {
                "comm_score": 0,
                "conf_score": 0,
                "risk_score": 0,
                "attention_score": 0,
                "speaking_ratio": 0,
                "eye_contact": 0,
                "word_count": 0
            },
            "communication_analysis": {
                "clarity_score": 0,
                "confidence_score": 0,
                "professionalism": 0,
                "engagement": 0,
                "speech_pace": "Normal",
                "hesitation_detection": "High",
                "filler_word_detection": {"um_uh_count": 0, "like_count": 0, "other_fillers_count": 0},
                "sentiment_analysis": "Neutral",
                "response_quality": "Low"
            },
            "behavioral_analysis": {
                "eye_contact": 0,
                "attentiveness": 0,
                "emotional_stability": 0,
                "honesty_indicators": "Low",
                "stress_indicators": "High",
                "distraction_detection": "Highly distracted",
                "engagement_score": 0,
                "emotion_timeline": [],
                "suspicious_behavior_flags": []
            },
            "interview_intelligence": {
                "interviewer_speaking_ratio": 0,
                "candidate_speaking_ratio": 0,
                "technical_depth_estimation": 0,
                "leadership_indicators": "Weak",
                "communication_indicators": "Poor",
                "professionalism_indicators": "Low"
            },
            "technical_evaluation": {
                "technical_understanding": 0,
                "depth_of_answers": 0,
                "leadership_indicators": "Weak",
                "problem_solving_quality": "Basic"
            },
            "timeline": [],
            "event_log": [{"category": "Validation", "severity": "Critical", "message": m, "time": "N/A"} for m in missing],
            "cheating_risk": "Low",
            "communication": "Normal",
            "confidence": "Low",
            "attention": "Variable",
            "analysis_confidence": "Low",
            "explanation_details": {
                "communication": "No audio captured.",
                "confidence": "No webcam video stream.",
                "security": "Insufficient interview evidence."
            }
        }

        await candidates_col.update_one(
            {"_id": ObjectId(candidate_id)},
            {"$set": {
                "ai_analysis": result,
                "status": "interview_incomplete",
                "interview.status": "completed",
                "updated_at": datetime.utcnow()
            }}
        )
        return result

    # Standard analyzer runs if validation passes
    analyzer = MultimodalAnalyzer(
        face_stats=face_stats,
        transcripts=transcripts,
        resume_score=resume_score,
        job_title=job_title,
        job_description=job_description,
        total_duration_secs=duration_secs
    )

    heuristics = analyzer.run_heuristics()
    synth = await analyzer.synthesize_analysis(heuristics, candidate.get("name", "Candidate"))

    result = {
        "recommendation": synth.get("recommendation", "Hold"),
        "verdict": synth.get("verdict", "Review pending"),
        "reasoning": synth.get("reasoning", "Interview completed."),
        
        "metadata": {
            "total_duration": f"{duration_mins} minutes",
            "join_time": join_time,
            "completion_time": completion_time,
            "interruptions": heuristics["interruptions"],
            "attendance": "Present"
        },
        
        "communication_analysis": synth.get("communication_analysis", {}),
        "behavioral_analysis": synth.get("behavioral_analysis", {}),
        "interview_intelligence": synth.get("interview_intelligence", {}),
        "technical_evaluation": synth.get("technical_evaluation", {}),
        
        "metrics": {
            "comm_score": heuristics["comm_score"],
            "conf_score": synth.get("communication_analysis", {}).get("confidence_score", heuristics["eye_contact"]),
            "risk_score": heuristics["risk_score"],
            "attention_score": heuristics["attention_score"],
            "speaking_ratio": heuristics["speaking_ratio"],
            "interviewer_speaking_ratio": synth.get("interview_intelligence", {}).get("interviewer_speaking_ratio", heuristics["interviewer_ratio"]),
            "candidate_speaking_ratio": synth.get("interview_intelligence", {}).get("candidate_speaking_ratio", heuristics["speaking_ratio"]),
            "eye_contact": heuristics["eye_contact"],
            "word_count": heuristics["word_count"]
        },
        
        "timeline": heuristics["timeline"],
        "event_log": heuristics["event_log"],
        
        # Compatibility fields
        "cheating_risk": heuristics["cheating_risk"],
        "communication": synth.get("communication_analysis", {}).get("speech_pace", "Normal"),
        "confidence": "High" if heuristics["eye_contact"] > 80 else "Medium" if heuristics["eye_contact"] > 50 else "Low",
        "attention": "High" if heuristics["attention_score"] > 80 else "Focused" if heuristics["attention_score"] > 60 else "Variable",
        "analysis_confidence": "High" if heuristics["word_count"] > 10 else "Low",
        "explanation_details": {
            "communication": f"Clear articulation. Pace: {synth.get('communication_analysis', {}).get('speech_pace', 'Normal')}.",
            "confidence": f"Eye contact and gaze stability at {heuristics['eye_contact']}%",
            "security": f"Proctoring risk evaluated as {heuristics['cheating_risk']}."
        }
    }

    await candidates_col.update_one(
        {"_id": ObjectId(candidate_id)},
        {"$set": {
            "ai_analysis": result,
            "status": "interview_analyzed",
            "interview.status": "analyzed",
            "updated_at": datetime.utcnow()
        }}
    )

    return result
