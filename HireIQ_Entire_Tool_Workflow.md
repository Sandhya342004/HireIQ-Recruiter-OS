# HireIQ Backend & Frontend Workflow (Step by Step)

---

### Step 1: Recruiter Opens the Website
The recruiter opens the HireIQ portal.
Example:
```
https://hireiq.posspole.com
```
The React frontend serves as the user interface (UI). It doesn't perform database queries or AI operations directly. When a recruiter clicks an action, the frontend makes API calls to the FastAPI backend.
```
Recruiter
   ↓
React Frontend
   ↓
FastAPI Backend
```

---

### Step 2: Recruiter Logs In
The recruiter enters their email and password. The frontend sends these credentials to:
```
POST /auth/login
```
**Backend Flow:**
1. Receives email and password.
2. Checks MongoDB (`users` collection).
3. If found, it compares the password against the stored bcrypt hash.
4. Generates a signed JSON Web Token (JWT) with a 24-hour expiration.
5. The JWT is returned to the frontend and saved in `localStorage`.
Every subsequent request automatically includes:
```
Authorization: Bearer JWT_TOKEN
```
This is how the backend knows which recruiter is making calls.

---

### Step 3: Recruiter Creates a Job Description
The recruiter enters the Job Title, Experience, Skills, and raw requirements, then clicks **Create Job**.
The frontend sends the request to:
```
POST /jobs/create
```

---

### Step 4: Backend Processes the JD
The backend receives the raw requirements text and sends it to the **Groq LLaMA-3.3-70b** model.
Groq extracts and formats the text into a clean JSON structure:
```json
{
  "required_skills": ["Python", "FastAPI", "MongoDB", "Docker"],
  "experience": 5,
  "education": "B.E",
  "certifications": []
}
```
If Groq is offline, a local regex-driven fallback parser maps the job requirements to the Master Skill Dictionary.

---

### Step 5: Store JD
Two actions happen simultaneously:
1. **MongoDB:** Stores Job Title, Description, Required Skills, Experience, Recruiter ID, and Created Date.
2. **FAISS:** The JD text is converted into a 384-dimensional vector embedding using the local `SentenceTransformers` model and synced into the local in-memory FAISS database to make the JD searchable semantically.

---

### Step 6: Recruiter Uploads Resume
The recruiter uploads a PDF or Word resume. The frontend sends it to:
```
POST /resume/upload
```

---

### Step 7: Store Original Resume
The backend immediately handles file storage:
1. **Supabase Storage:** If keys are set in `.env`, the original PDF is uploaded directly to the `resumes` bucket in Supabase.
2. **Local Fallback:** If keys are missing, it saves the PDF locally inside the `uploads/resumes/` folder on the laptop.
3. **MongoDB:** Stores only the final URL reference and metadata.
```
Resume.pdf
   ↓
Supabase Storage (or Local Uploads Fallback)
   ↓
Public URL stored in MongoDB
```

---

### Step 8: Extract Resume Text
The backend reads the resume PDF or Word file using `PyMuPDF` or `mammoth` and extracts it into plain text.

---

### Step 9: Extract Candidate Details (Multi-Stage Cascade)
1. **Stage 1 (Rule-Based):** Finds basic fields (Email, Phone, Dates) using regex.
2. **Stage 2 (GLiNER):** Identifies Named Entities (Candidate Name, Location, Colleges, Companies).
3. **Stage 3 (Groq LLM):** Groq reads the entire text and returns a structured JSON containing employment history, achievements, and soft skills.

---

### Step 10: Normalize Skills
To prevent matching mismatches (e.g. `NodeJS` vs `Node.js`), the backend converts and standardizes skills using a dictionary:
* `NodeJS` / `Node JS` → `node.js`
* `ReactJS` / `React.js` → `react`
* `JS` → `javascript`

---

### Step 11: Create Resume Embedding
The candidate's normalized skills and resume text are sent to the local `SentenceTransformers` model (`all-MiniLM-L6-v2`) to produce a 384-dimensional vector, which is then synced to the local in-memory FAISS index.

---

### Step 12: Weighted Ranking Engine
The backend compares the Job Description against the Candidate Resume across six distinct factors:

* **Skills (40%):** Evaluates skills using exact matches, normalized alias matches, and fuzzy Levenshtein distance.
* **Experience (25%):** Compares candidate years of experience against the job requirements.
* **Semantic Matching (15%):** Compares the candidate vector against the job vector using **Cosine Similarity** in FAISS. This matches conceptual meanings (e.g., matching "AI Specialist" with "Machine learning engineer") instead of just looking for identical words.
* **Projects (10%):** Scans the project descriptions for job-relevant technologies.
* **Certifications (5%):** Verifies matching credentials (e.g. AWS, Azure, Google Cloud).
* **Resume Quality (5%):** Checks for complete sections and profile details.

---

### Step 13: Final Score Calculation
The backend calculates the sum of all parts:
```
40% (Skills) + 25% (Experience) + 15% (Semantic) + 10% (Projects) + 5% (Certifications) + 5% (Quality) = 100%
```
Deductions are applied if critical items are missing (e.g. **-20 points** if the candidate lacks >70% of required skills).

---

### Step 14: AI Explanation Generation
The backend sends the computed score details to Groq. Groq compiles a natural language feedback report:
* **Strengths:** Why the candidate is a match.
* **Weaknesses/Concerns:** Key skill gaps.
* **Verdict:** Hire, Hold, or Reject recommendation.

---

### Step 15: Store Candidate
All compiled candidate metadata, computed scores, AI explanations, and Supabase/local file URLs are saved under the candidate's record in MongoDB.

---

### Step 16: Recruiter Reviews Candidate
When the recruiter opens a candidate profile in the browser:
1. Frontend fetches candidate data from MongoDB.
2. Frontend loads the resume PDF directly from Supabase (or local storage).

---

### Step 17: Recruiter Schedules Interview
The recruiter selects a date and time. The backend checks MongoDB to verify no scheduling conflicts exist. If free, it creates the interview session.

---

### Step 18: LiveKit Room Setup
1. The backend makes an API call to the **LiveKit server** to create a secure conference room.
2. It generates JWT access tokens for the recruiter (moderator status) and candidate (guest status).
3. It constructs the secure invite link:
   `{FRONTEND_URL}/candidate-interview/{token}`
4. An invite email is sent automatically using SMTP. A background scheduler (APScheduler) triggers a reminder email 15 minutes before the call.

---

### Step 19: Candidate Joins Interview
The candidate opens the invitation link. The backend verifies the token and allows them to connect natively to the LiveKit server using WebRTC and `<LiveKitRoom>` React components.

---

### Step 20: Real-Time Browser Proctoring
During the interview call, the candidate's browser tracks compliance:
* **MediaPipe FaceMesh:** Measures eye coordinates (checks if the candidate is looking away) and logs face counts (detects if multiple people are present or if the candidate leaves).
* **Visibility Listeners:** Logs if the candidate switches tabs, leaves fullscreen mode, or tries to copy/paste.
* **Voice Activity Detection:** Tracks speaking vs listening ratio.
All events are sent immediately to the backend database.

---

### Step 21: Interview Completion & Transcription
Once the call ends, the audio file is stored in Supabase. The backend sends the audio to **Groq Whisper** (`whisper-large-v3-turbo`) to generate a timestamped text transcript.

---

### Step 22: AI Evaluation
The backend sends the transcript, metrics, and proctoring violations to Groq. Groq evaluates candidate response accuracy, communication confidence, and cheating indicators to generate a final interview scorecard. The backend compiles this into a downloadable PDF report.

---

### Step 23: Final Database Storage
* **MongoDB:** Stores users, jobs, candidate profiles, proctoring events, and final scorecards.
* **Supabase:** Stores original resume PDFs and audio interview recordings.
* **FAISS:** Stores resume and job description vectors for semantic matching.

---

### One-Line Summary You Can Tell Your Lead:
> "The backend acts as the brain of HireIQ: it handles secure authentication, parses job descriptions and resumes using Groq AI, saves structured records to MongoDB, uploads media assets to Supabase, generates semantic vectors in FAISS for intelligent matching, computes deterministic candidate scores, sets up secure LiveKit WebRTC interview rooms, captures real-time proctoring metrics, transcribes audio using Groq Whisper, and compiles final PDF candidate evaluation reports."
