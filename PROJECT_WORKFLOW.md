# HireIQ — Complete Technical Workflow & Architecture Documentation

> **Version:** Production-Ready (Groq Cloud Stack)
> **Last Updated:** July 2026

---

## 1. Project Overview

### What is HireIQ?
HireIQ is an AI-powered Applicant Tracking System (ATS) designed to automate and accelerate the end-to-end recruitment pipeline — from job description creation to post-interview analysis.

### Problem Statement
Traditional recruitment workflows are slow, inconsistent, and overwhelmingly manual. Recruiters spend 60–80% of their time on screening, scheduling, and coordination, leaving little time for strategic hiring decisions.

### Objective
Eliminate manual resume screening bottlenecks using AI-driven parsing, semantic search, weighted scoring, and automated interview proctoring — while keeping the recruiter in complete control of every hiring decision.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                      FRONTEND                           │
│  React + Vite  (src/pages/, src/components/)            │
│  Talks to backend via Axios (src/utils/api.js)          │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP / SSE
┌──────────────────────▼──────────────────────────────────┐
│                      BACKEND                            │
│  FastAPI  (main.py)                                     │
│  ┌──────────┐ ┌────────────┐ ┌──────────────────────┐  │
│  │  Routes  │ │  Services  │ │  AI Layer            │  │
│  │ /jobs    │ │ llm_parser │ │  Groq llama-3.3-70b  │  │
│  │ /cands   │ │ hiring_sum │ │  Groq Whisper        │  │
│  │ /interv  │ │ ai_analysis│ │  SentenceTransformer │  │
│  │ /chat    │ │ vector_str │ │  FAISS               │  │
│  │ /auth    │ │ email_svc  │ │  MediaPipe (proctoring│  │
│  └──────────┘ └────────────┘ └──────────────────────┘  │
└──────────────────────┬──────────────────────────────────┘
                       │
      ┌────────────────┼──────────────────┐
      ▼                ▼                  ▼
  MongoDB Atlas     FAISS Index       File Storage
  (cloud DB)        (in-memory)       (uploads/)
```

---

## 3. Complete Workflow

### 3.1 Recruiter Login

**Flow:**
1. Recruiter submits credentials → `POST /auth/login`
2. `routes/auth.py` queries `users` collection in MongoDB
3. Password verified with `bcrypt`
4. JWT token generated with `python-jose` (24-hour expiry)
5. Token returned to frontend, stored in `localStorage`
6. All subsequent requests include `Authorization: Bearer <token>`

---

### 3.2 Create Job Description

**Flow:**
1. Recruiter fills JD form → `POST /jobs`
2. `routes/jobs.py` stores raw JD text in `jobs` collection
3. `services/llm_parser.py → parse_jd_with_llm()` sends JD to Groq
4. Groq extracts: `role_name`, `required_skills`, `preferred_skills`, `minimum_experience`, `domain_requirements`, `certifications_required`
5. Structured fields stored back to `jobs` collection
6. Local keyword fallback runs if Groq unavailable

**Collections used:** `jobs`

---

### 3.3 Resume Upload & Parsing

**Flow:**
1. Recruiter uploads PDF/DOCX → `POST /candidates/upload`
2. File saved to `uploads/` directory
3. Text extracted: PDF via `PyPDF2`, DOCX via `mammoth`
4. **Stage 1 — Rule-based extraction** (`resume_parser.py`):
   - Name: 6-strategy cascade (header lines → NER → email username)
   - Email: regex with space-collapse fallback
   - Phone: labeled field → +91 → 10-digit → international scan
   - Skills: exact match → synonym normalisation → fuzzy (rapidfuzz)
   - Experience: work section date ranges → summary text → full text
5. **Stage 2 — LLM extraction** (`services/llm_parser.py → parse_resume_with_llm()`):
   - Groq (llama-3.3-70b) extracts structured JSON with zero-hallucination prompt
   - Fields: `candidate_name`, `email`, `phone`, `technical_skills`, `soft_skills`, `employment_timeline`, `companies`, `job_titles`, `education`, `projects`, `certifications`, `leadership_experience`, `confidence_score`
   - LLM result overrides rule-based result where present
6. Candidate document saved to `candidates` collection
7. Resume text embedding generated via `SentenceTransformer` → stored in FAISS

**Collections used:** `candidates`

---

### 3.4 Semantic Matching & Embeddings

**Model:** `sentence-transformers/all-MiniLM-L6-v2`

**Flow:**
1. On upload, `services/vector_store.py` encodes resume text → 384-dim vector
2. FAISS index (`IndexFlatIP` with inner product / cosine similarity) stores vector
3. JD text also encoded at search time
4. `search_resumes(query, top_k)` returns top-k most similar candidates
5. FAISS index persisted to disk (`faiss_index.bin`) and reloaded on startup

**Key principle:** FAISS provides semantic similarity scores used as **one component** of the weighted ranking — it does NOT rank candidates alone.

---

### 3.5 Weighted Ranking Engine

**File:** `matching.py`

**Score formula (total = 100%):**

| Component | Weight | Source |
|-----------|--------|--------|
| Skills Match | 40% | `compute_skill_scores()` — exact + synonym + fuzzy |
| Experience Match | 25% | `calculate_experience_breakdown()` — timeline + explicit |
| Semantic Similarity | 15% | FAISS cosine distance |
| Projects | 10% | Count vs JD project requirements |
| Certifications | 5% | Match against JD cert requirements |
| Resume Quality | 5% | Completeness + confidence score |

**Hard penalties applied after weighting:**
- >70% required skills missing: −20 pts
- >50% missing: −12 pts
- Experience <50% of requirement: −10 pts
- Resume <500 chars: −10 pts
- Low LLM confidence (<50): −8 pts

**Critical note:** Groq/LLM **does NOT compute the score**. The heuristic engine computes all scores. Groq only explains the pre-computed scores in natural language (see AI Feedback below).

---

### 3.6 AI Feedback Generation

**File:** `feedback.py`, `services/hiring_summary.py`, `services/llm_parser.py`

**Flow:**
1. After ranking, `generate_candidate_intelligence()` formats a prompt containing the **pre-computed scores** (never asking Groq to score)
2. Groq generates: `executive_summary`, `strengths[]`, `weaknesses[]`, `risks[]`, `opportunities[]`, `interview_focus_areas[]`, `recommendation` (Hire/Hold/Reject)
3. `generate_hiring_summary()` adds a 2-sentence narrative using `_groq_narrative()`
4. If Groq unavailable → `_fallback_intelligence()` generates deterministic template output based on score thresholds

**AI Recommendation logic:** Based purely on the score — >75% → "Hire", 55–75% → "Hold", <55% → "Reject". Groq is given this recommendation and asked to explain it, never to override it.

---

### 3.7 Recruiter Dashboard

Displays ranked candidates per job with:
- AI match score + score breakdown bars
- Skill match/missing chips
- AI recommendation badge
- Pipeline stage filter
- Semantic search via FAISS

---

### 3.8 Chatbot (Recruiter Copilot)

**File:** `routes/chat.py`

**Flow:**
1. Recruiter sends query → `POST /chat/query` (streaming)
2. Intent classified (greeting, top candidates, job stats, skills analysis, etc.)
3. Relevant data fetched from MongoDB (candidates, jobs, analytics)
4. Context formatted into system + user messages
5. Streamed through `llm_stream()` via Groq's SSE endpoint
6. Template fallback if Groq key absent
7. Conversation history stored in server-side session memory (last 10 turns)

---

### 3.9 Interview Scheduling

**File:** `routes/interviews.py`

**Flow:**
1. Recruiter clicks "Schedule Interview" → `POST /interviews/schedule`
2. Time-slot conflict check against existing bookings
3. LiveKit room created dynamically via backend livekit-api
4. Secure token generated: `uuid.uuid4().hex`
5. **Candidate join URL built from `FRONTEND_URL` env var** (never localhost-hardcoded):
   ```
   {FRONTEND_URL}/candidate-interview/{secure_token}
   ```
6. Interview data saved to `candidates.interview` subdocument
7. HR confirmation notification sent via UI (Manual link sharing)

**Key:** `FRONTEND_URL` in `backend/.env` must be set to a reachable URL for external candidates.

---

### 3.10 Candidate Join Flow

1. Candidate opens link: `{FRONTEND_URL}/candidate-interview/{token}`
2. `CandidateInterview.jsx` validates token → `GET /interviews/validate-token/{token}`
3. Backend returns interview details (job role, time, LiveKit room details)
4. Candidate enters their name → joins the session
5. Camera/mic activated, proctoring starts

---

### 3.11 AI Proctoring

**File:** `services/ai_analysis.py`, `frontend/src/pages/CandidateInterview.jsx`

**Proctoring signals tracked:**
- **Eye contact** — MediaPipe FaceMesh, gaze direction detection
- **Attention score** — face presence ratio during session
- **Tab switching** — `visibilitychange` event counter
- **Copy/paste** — `copy`/`paste` event detection
- **Audio activity** — WebRTC VAD, speaking ratio
- **Filler words** — transcript analysis ("um", "uh", "like", etc.)

**Integrity Risk Score:**
- Tab switches >5: High Risk
- Copy/paste detected: High Risk
- Face absent >30%: Medium Risk
- Low speaking ratio (<20%): flagged

**Proctoring events reported:** `POST /interviews/proctoring-event`

---

### 3.12 Interview Analysis & Report

**File:** `services/ai_analysis.py`

**Flow after interview ends:**
1. `POST /interviews/end` triggers analysis
2. Audio transcribed via Groq Whisper (`transcription_service.py`)
3. Heuristics computed: eye contact %, speaking ratio, word count, filler count, risk score
4. `synthesize_analysis()` sends heuristics + transcript sample to Groq
5. Groq generates structured JSON report: communication rating, confidence score, strengths, concerns, behavioral assessment, integrity verdict
6. Report stored on candidate document under `ai_analysis`

---

## 4. Technology Stack

| Technology | Purpose | Why Chosen |
|------------|---------|------------|
| **React + Vite** | Frontend SPA | Fast HMR, modern JSX, excellent DX |
| **FastAPI** | REST API backend | Async-native, automatic OpenAPI docs, Pydantic validation |
| **MongoDB Atlas** | Primary database | Schema-flexible for evolving candidate profiles; cloud-managed |
| **Groq (llama-3.3-70b)** | LLM completions | Sub-second inference, free tier, OpenAI-compatible API |
| **Groq Whisper** | Speech-to-text | Same API key as LLM, high accuracy, fast transcription |
| **SentenceTransformer** | Text embeddings | Lightweight, runs locally, no API cost |
| **FAISS** | Vector similarity search | In-process, zero latency, production-grade at small scale |
| **MediaPipe** | Face/eye tracking | Runs in browser via JS, no server round-trips |
| **JWT (python-jose)** | Auth tokens | Stateless, standard, integrates cleanly with FastAPI |
| **APScheduler** | Background jobs | Interview reminders, vector sync tasks |
| **SMTP / Gmail** | Email delivery | Simple setup; production can swap to SendGrid |
| **LiveKit** | Video conferencing | Secure, low latency, native WebRTC components |
| **spaCy** | NER for name/location | Accurate entity extraction as fallback |
| **rapidfuzz** | Fuzzy skill matching | Fast Levenshtein for handling typos in skills |
| **bcrypt** | Password hashing | Industry standard, slow by design |

---

## 5. Database Design

### Collections

#### `users`
```
{ _id, email, name, password_hash, role, created_at }
```

#### `jobs`
```
{ _id, title, description, required_skills[], preferred_skills[],
  minimum_experience, domain_requirements[], certifications_required[],
  candidate_count, created_at, created_by }
```

#### `candidates`
```
{ _id, job_id, name, email, phone, location,
  technical_skills[], soft_skills[], certifications[], education[],
  employment_timeline[], companies[], job_titles[], projects[],
  total_experience_years, confidence_score,
  score, skill_score, experience_score, semantic_score,
  exact_matches[], missing_skills[], bonus_skills[],
  ai_verdict, hiring_summary{}, ai_analysis{},
  interview{ date, time, meeting_link, candidate_join_url,
             secure_token, status, scheduled_by },
  status, pipeline_stage, notes[], activity_history[],
  resume_path, raw_text, uploaded_at }
```

#### `email_settings` (optional — currently uses .env)
```
{ smtp_host, smtp_port, smtp_user, smtp_password_encrypted, from_email }
```

---

## 6. Folder Structure

```
Job_resume_ranker-main/
├── backend/
│   ├── main.py                  # FastAPI app, startup, CORS, scheduler
│   ├── config.py                # Paths, constants
│   ├── database.py              # MongoDB Motor client, collection refs
│   ├── matching.py              # Weighted scoring engine (heuristic, no LLM)
│   ├── resume_parser.py         # Rule-based extraction (name, email, skills)
│   ├── feedback.py              # Groq-powered resume feedback
│   ├── .env                     # Environment variables (see below)
│   ├── routes/
│   │   ├── auth.py              # Login, register, JWT
│   │   ├── jobs.py              # Job CRUD
│   │   ├── candidates.py        # Candidate CRUD, re-rank, compare
│   │   ├── interviews.py        # Schedule, validate token, proctoring, end
│   │   ├── chat.py              # Streaming chatbot
│   │   └── audio.py             # Audio upload for transcription
│   └── services/
│       ├── llm_service.py       # Groq client wrapper (ONLY file touching Groq API)
│       ├── llm_parser.py        # Resume + JD LLM parsing prompts
│       ├── hiring_summary.py    # Narrative hiring summary generation
│       ├── ai_analysis.py       # Interview synthesis + proctoring analysis
│       ├── vector_store.py      # FAISS index management
│       ├── transcription_service.py  # Groq Whisper speech-to-text
│       ├── email_service.py     # SMTP email sender + templates
│       └── notification_service.py   # Scheduled reminders
├── frontend/
│   ├── src/
│   │   ├── pages/               # One file per page
│   │   ├── components/          # Reusable UI components
│   │   └── utils/api.js         # Axios instance with auth interceptor
│   └── .env                     # VITE_API_BASE_URL, VITE_FRONTEND_URL
└── PROJECT_WORKFLOW.md          # This file
```

---

## 7. Environment Variables

### `backend/.env`

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGO_URI` | ✅ | MongoDB Atlas connection string |
| `JWT_SECRET` | ✅ | Secret for signing JWT tokens |
| `GROQ_API_KEY` | ✅ | Groq Cloud API key (get at console.groq.com) |
| `GROQ_MODEL` | optional | Default: `llama-3.3-70b-versatile` |
| `WHISPER_MODEL` | optional | Default: `whisper-large-v3-turbo` |
| `FRONTEND_URL` | ✅ | **Reachable** frontend URL for candidate interview links |
| `SMTP_USERNAME` | ✅ | Gmail address for sending notifications |
| `SMTP_PASSWORD` | ✅ | Gmail App Password (not regular password) |
| `ENCRYPTION_KEY` | ✅ | Fernet key for encrypting stored passwords |

### `frontend/.env`

| Variable | Description |
|----------|-------------|
| `VITE_API_BASE_URL` | Backend URL (e.g. `http://127.0.0.1:8000`) |
| `VITE_FRONTEND_URL` | Frontend URL for sharing (tunnel URL during dev) |

---

## 8. Interview Link — Production Configuration

This is the most critical deployment concern.

### Problem
If `FRONTEND_URL=http://localhost:5173`, the candidate invite link will be:
```
http://localhost:5173/candidate-interview/<token>
```
This only works on the recruiter's machine. Candidates on other devices cannot join.

### Solution
Set `FRONTEND_URL` in `backend/.env` to a publicly reachable URL:

**Local dev with sharing (ngrok):**
```
FRONTEND_URL=https://abc123.ngrok.io
```

**Production deployment:**
```
FRONTEND_URL=https://hireiq.yourcompany.com
```

The backend generates the link as:
```python
candidate_join_url = f"{FRONTEND_URL}/candidate-interview/{secure_token}"
```
This is stored on the candidate document and returned in the schedule response.

---

## 9. Production Readiness Checklist

| Item | Status |
|------|--------|
| All LLM calls use Groq only | ✅ Complete |
| Zero Ollama references | ✅ Verified |
| Interview links use `FRONTEND_URL` | ✅ Fixed |
| Rule-based fallbacks for all AI components | ✅ In place |
| JWT authentication on all routes | ✅ |
| CORS configured from env vars | ✅ |
| Sensitive data encrypted in DB | ✅ (Fernet) |
| FAISS loaded once on startup | ✅ |
| SentenceTransformer loaded once | ✅ |
| Email notifications | ✅ SMTP |
| Proctoring events stored | ✅ |
| Scoring engine independent of LLM | ✅ |
| Groq API key needed | ⚠️ Must be set in .env |
| Production `FRONTEND_URL` | ⚠️ Must be set for external candidates |
| HTTPS in production | ⚠️ Needs reverse proxy (nginx/caddy) |

---

## 10. API Endpoints Summary

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/auth/login` | JWT login |
| POST | `/auth/register` | Create account |
| GET | `/jobs` | List all jobs |
| POST | `/jobs` | Create job + LLM parse JD |
| POST | `/candidates/upload` | Upload + parse resume |
| GET | `/candidates/list` | List with filters |
| POST | `/candidates/rerank/{id}` | Re-run full AI pipeline |
| GET | `/candidates/compare-insights` | Streaming comparison |
| POST | `/interviews/schedule` | Schedule + generate invite link |
| GET | `/interviews/validate-token/{token}` | Candidate join validation |
| POST | `/interviews/end` | End session + trigger AI analysis |
| POST | `/interviews/proctoring-event` | Log proctoring violation |
| POST | `/chat/query` | Streaming chatbot |
| GET | `/debug/groq-test` | Verify Groq connectivity |
| GET | `/health` | System health check |
