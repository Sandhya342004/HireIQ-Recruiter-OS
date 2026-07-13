# HireIQ — Production-Grade AI Recruiter OS (v2)

HireIQ is a cloud-agnostic, high-performance Applicant Tracking System (ATS) and recruitment platform. It streamlines recruiter workflows — from initial Job Description (JD) parsing to automated resume ranking, chatbot-assisted sourcing, video interviews with AI proctoring, and post-interview analysis reports — all while maintaining complete data isolation, deterministic mathematical ranking, and zero changes to the UI/workflow.

---

## 🚀 Key Features

*   **Job Description (JD) Intelligence:** Automated parsing of JDs using **Groq Cloud API (LLaMA-3.3-70B)** to extract mandatory/preferred skills, education requirements, and minimum target experience.
*   **Production Hybrid Parsing Pipeline:** A high-precision, 6-stage resume analysis pipeline:
    *   *Stage 1 (Extraction):* Preserves multi-column resume layout and reading order using **PyMuPDF (fitz)**, with **PyPDF2** and **mammoth** (DOCX) fallbacks.
    *   *Stage 2 (NER):* Zero-shot Named Entity Recognition using **GLiNER** (`urchade/gliner_medium-v2.1`) for context-aware extraction of candidate names, locations, schools, and companies, backed by a confidence-based Groq validation cascade.
    *   *Stage 3 (Normalization):* 5-Stage Skill Normalizer utilizing Exact Matching, Alias Resolution, Fuzzy Matching (via `rapidfuzz`), and **BAAI/bge-large-en-v1.5** semantic similarity mapping against a 350+ master skill dictionary.
    *   *Stage 4 & 5 (Experience & Education):* Heuristic and LLM reasoning modules to extract chronological employment timelines, handle overlapping roles, classify internships, and normalize academic degrees.
*   **Vector Search & Semantic Match:** Upgraded vector engine using **BAAI/bge-large-en-v1.5** (1024-dim embeddings) and **FAISS** for fast, high-dimension similarity search. Includes self-healing startup index rebuilds for easy dimension migrations.
*   **Decoupled Storage Layer:** Cloud-agnostic storage abstraction router supporting **Supabase Storage** as the primary binary files provider, with automated local disk fallback. MongoDB stores ONLY structured metadata (never binary bytes).
*   **Deterministic Weighted Scoring Engine:** A transparent, non-LLM-based ranking engine combining:
    *   Skills Match (40%)
    *   Experience Alignment (25%)
    *   Semantic Similarity (15%)
    *   Project Relevance (10%)
    *   Certifications (5%)
    *   Resume/Profile Completeness (5%)
*   **Recruiter Copilot Chatbot:** An interactive RAG chatbot allowing natural-language database query, candidate comparison, and automated hiring query responses.
*   **Live Video Room with LiveKit:** Embeds native audio-video WebRTC channels directly inside candidate and recruiter screens.
*   **In-Browser AI Proctoring:** Client-side **MediaPipe FaceMesh** eye/gaze tracking, face presence detection, tab-switching triggers, and copy-paste monitors.
*   **Post-Interview Analysis:** Speech-to-text audio transcription via **Groq Whisper** combined with LLaMA narrative synthesis to deliver behavioral assessments, integrity checks, and summary reports.

---

## 🛠 Tech Stack

| Tier | Technology | Purpose |
|------|------------|---------|
| **Frontend** | React (v18), Vite, Recharts, Lucide | Single-Page Application (SPA) dashboard |
| **Backend** | FastAPI, Uvicorn, Pydantic | High-performance, asynchronous REST API |
| **Database** | MongoDB Atlas, Motor | Document database for candidate metadata & status |
| **Storage Layer**| Supabase Storage / Local fallback | Decoupled binary storage (PDFs, recordings) |
| **Vector Index**| FAISS | Local, disk-persisted vector similarity engine |
| **AI Layer** | Groq (LLaMA-3.3-70B), Groq Whisper | Language synthesis, parsing, speech-to-text |
| **Local AI** | GLiNER, BGE-large-en-v1.5 | Zero-shot NER & 1024-dim text embedding generation |
| **Proctoring** | MediaPipe FaceMesh | Browser-side gaze and face presence analysis |
| **Automation** | APScheduler | Email reminders and notification dispatcher |

---

## 📂 Project Structure

```
Job_resume_ranker-main/
├── backend/
│   ├── main.py                  # FastAPI server entry point, startup validation & diagnostic routes
│   ├── database.py              # MongoDB Motor connections & models
│   ├── auth.py                  # JWT authentication middleware
│   ├── matching.py              # Weighted scoring engine & heuristics
│   ├── resume_parser.py         # NLP text extraction & 6-stage pipeline orchestrator
│   ├── routes/                  # API routes (candidates, jobs, auth, chat, workspace, etc.)
│   └── services/                # Backend services
│       ├── pdf_extractor.py     # Stage 1: PyMuPDF reader
│       ├── ner_engine.py        # Stage 2: GLiNER zero-shot NER extractor
│       ├── skill_normalizer.py  # Stage 3: Master dictionary & semantic normalizer
│       ├── vector_store.py      # FAISS 1024-dim index manager (BGE-large)
│       ├── storage_abstraction.py # Cloud-agnostic StorageRouter
│       ├── supabase_storage.py  # Supabase Storage client provider
│       └── email_service.py     # SMTP notification helper
├── frontend/
│   ├── src/
│   │   ├── pages/               # Views (Dashboard, InterviewRoom, Workspace, etc.)
│   │   ├── components/          # Reusable dashboard panels and cards
│   │   └── context/             # React authentication contexts
│   └── vite.config.js           # Vite development and proxy configuration
├── start_platform.bat          # One-click platform startup batch script
├── PROJECT_WORKFLOW.md          # Technical pipeline manual
└── requirements.txt             # Clean backend python dependencies
```

---

## ⚙️ Setup & Execution

### Prerequisites
*   Python 3.10+ (Recommended: 3.11 / 3.12)
*   Node.js 18+
*   MongoDB Atlas cluster connection string
*   Groq API Key (get yours free at [console.groq.com](https://console.groq.com))
*   Supabase Account & Project Credentials (URL + service_role key)

### 1. Configuration
Create a `.env` file inside the `backend/` directory using your credentials:
```env
MONGO_URI=mongodb+srv://<user>:<password>@cluster0.mongodb.net/ats_platform
DB_NAME=ats_platform
JWT_SECRET=your_jwt_signing_secret
ENCRYPTION_KEY=g7EuM8O_-qJTOyVDZZTutI-JHTmgWfezf8kHNnH5eOQ=
GROQ_API_KEY=gsk_your_groq_api_key

# Supabase Storage configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-supabase-service-role-key
STORAGE_PROVIDER=supabase

# FAISS Vector Index control (Windows OpenMP warning fallback)
DISABLE_FAISS=true

FRONTEND_URL=http://localhost:5173
SMTP_SERVER=smtp.gmail.com
SMTP_USERNAME=your_gmail_address
SMTP_PASSWORD=your_gmail_app_password
EMAIL_FROM=your_gmail_address
```

Create a `.env` file in the `frontend/` directory:
```env
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_BACKEND_URL=http://127.0.0.1:8000
```

### 2. Run the platform
Double-click `start_platform.bat` or run:
```bash
# Start FastAPI backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload

# Start React frontend
cd ../frontend
npm install
npm run dev
```

Open `http://localhost:5173` to access the Recruiter Dashboard.

### 3. Diagnostics
After logging in, administrators can run system checks at:
*   `GET /debug/storage-health` — Confirms Supabase storage container uploads are functional.
*   `GET /debug/embedding-model` — Returns FAISS dimensional configuration (1024-dim) and total candidate vectors loaded.
