# HireIQ Recruiter OS — Full Platform Workflow

This document explains exactly how the HireIQ Recruiter OS works step-by-step, from the moment a recruiter opens the platform to the final candidate hire decision. It is designed to be easily read by stakeholders and leads to understand how the frontend, backend, databases, and AI systems communicate.

---

## 1. High-Level Architecture Map

```
                     +---------------------------------------+
                     |           React 18 Frontend           |
                     |  - Dashboard UI                       |
                     |  - Proctoring Feeds (MediaPipe)       |
                     |  - LiveKit Audio/Video Room           |
                     +-------------------+-------------------+
                                         |
                                         | REST APIs / WebRTC / SSE
                                         v
                     +---------------------------------------+
                     |            FastAPI Backend            |
                     |  - Route Handlers                     |
                     |  - Heuristic Scoring & Ranking Math   |
                     |  - SMTP Notification Dispatcher       |
                     +---+---------------+---------------+---+
                         |               |               |
             MongoDB Atlas |               | local / API   | Supabase URL
                         v               v               v
             +-----------+---+   +-------+-------+   +---+-----------+
             |  NoSQL DB     |   | AI Engine &   |   | Cloud Storage |
             |  - Users      |   | Vector Store  |   | - Resume PDFs |
             |  - Jobs       |   | - Groq LLM    |   | - Audio Files |
             |  - Candidates |   | - Whisper STT |   |               |
             |  - Interviews |   | - Local FAISS |   |               |
             +---------------+   +---------------+   +---------------+
```

---

## 2. Phase 1: Authentication & Onboarding

### Step 1: User Registers
1. Recruiter inputs Name, Email, and Password.
2. Frontend sends payload to `POST /auth/register`.
3. Backend checks if the Email already exists in MongoDB (`users` collection).
4. If unique, the backend salts and hashes the password using `bcrypt` and inserts the user record.

### Step 2: User Logs In
1. Recruiter submits Email and Password.
2. Frontend sends payload to `POST /auth/login`.
3. Backend looks up the email. If found, it compares the submitted password against the stored bcrypt hash.
4. Upon match, backend generates a JSON Web Token (JWT) signed with `your_jwt_secret` and sets a 24-hour expiration.
5. The JWT is returned to the browser and saved in `localStorage`.
6. Every subsequent HTTP request automatically appends this token inside the headers:
   `Authorization: Bearer <JWT_TOKEN>`

---

## 3. Phase 2: Job Description Creation

### Step 3: Posting a New Job
1. Recruiter fills out the job description (Title, Company, Location, Experience, and raw requirements text) and clicks **Create Job**.
2. Frontend triggers `POST /jobs/create`.

### Step 4: Structuring the Job Requirements
1. Backend receives the raw text and forwards it to the **Groq LLaMA-3.3-70b** model.
2. Groq extracts and formats the text into a clean JSON structure:
   * **Required Skills:** Crucial languages, databases, or frameworks.
   * **Preferred Skills:** Nice-to-have capabilities.
   * **Experience Years:** Minimum target years of history.
   * **Certifications:** Crucial certifications needed (e.g. AWS, CISSP).
3. If Groq is offline, a local regex-driven fallback parser scans the text using pre-built keyword maps to complete the job profiles.
4. The structured job is saved into the MongoDB `jobs` collection.

---

## 4. Phase 3: Resume Upload, Extraction, & Normalization

### Step 5: Uploading Candidate Resumes
1. Recruiter uploads candidate resumes (PDF or Word formats).
2. Frontend triggers `POST /resume/upload`.
3. The backend receives the file and computes a unique file name.

### Step 6: Storage Routing
1. The backend checks if Supabase is configured.
2. If keys are present in the `.env` file, the original PDF is uploaded to **Supabase Storage** under the `resumes` bucket.
3. If keys are missing, the backend saves the PDF locally to the `uploads/resumes/` folder on the laptop.
4. MongoDB updates with the public file URL.

### Step 7: Multi-Stage Text Parsing
The backend reads the document text using `PyMuPDF` (PDF) or `mammoth` (DOCX) and runs a multi-stage parser:
1. **Rule-Based Extractors:** Uses standard regular expressions to parse contact data (Email, Phone).
2. **AI Named Entity Recognition (GLiNER):** Locates entities such as candidate names, colleges, and company names.
3. **LLM Timeline Parser:** Sends the remaining text to Groq. Groq parses candidate experience timelines, degrees, projects, and certifications into structured JSON.

### Step 8: Skill Normalization
To prevent scoring misses, candidate skills are normalized through a Master Skill Dictionary:
* `NodeJS`, `Node.js`, and `Node JS` are all mapped to `node.js`.
* `ReactJS` and `React.js` are mapped to `react`.
* `JS` is mapped to `javascript`.

### Step 9: Vector Generation
1. The backend combines the candidate's normalized skills and experience text.
2. The local `SentenceTransformers` model (`all-MiniLM-L6-v2`) encodes this text into a 384-dimensional dense vector.
3. The vector is appended to the local in-memory **FAISS** database to support fast semantic candidate searches.

---

## 5. Phase 4: Deterministic Scoring & Matching Engine

### Step 10: Multi-Factor Scoring
The engine compares the Job Description against the Candidate Resume across six distinct factors. The AI is **never** allowed to calculate the score numbers (preventing hallucinations).

```
         Skills (40%) ----+
      Experience (25%) ---+
        Semantic (15%) ---+
        Projects (10%) ---+---> Deterministic Math ---> Final Candidate Score
  Certifications (5%) ----+
     Completeness (5%) ---+
```

1. **Skills Matching (40%):** Evaluates skills in the resume against the job description using exact matching, alias matching, and RapidFuzz Levenshtein similarity.
2. **Experience Evaluation (25%):** Compares total years of candidate experience against the job requirement.
3. **Semantic Similarity (15%):** Compares the candidate embedding vector with the job embedding vector inside FAISS (calculating cosine similarity). This matches concepts, e.g., identifying that a candidate with "Deep Learning and Transformers" matches a job for "AI Specialist" even if the exact words differ.
4. **Projects Relevance (10%):** Scans the project highlights for required technology keywords.
5. **Certifications Match (5%):** Matches certificates to required ones.
6. **Profile Completeness (5%):** Checks for missing profile sections.

### Step 11: Applying Hard Penalties
Deductions are applied for severe discrepancies:
* **-20 points** if the candidate lacks more than 70% of the required skills.
* **-10 points** if candidate experience is less than half of what is requested.

### Step 12: Generating AI Feedback Notes
1. The mathematical score sheet is sent to Groq.
2. Groq formats a natural language summary explaining:
   * **Key Strengths**
   * **Key Concerns/Weaknesses**
   * **Missing Skills**
   * **Recommendation Verdict** (Hire, Hold, or Reject)

---

## 6. Phase 5: Recruiter Copilot (Chatbot)

### Step 13: Asking the Chatbot
1. Recruiter types a question (e.g. "Find candidates with Python experience and high scores").
2. The chatbot panel streams the query to the backend.

### Step 14: Intent Classification & Context Injection
1. The backend analyzes the query to determine intent (e.g., candidate lookup, job statistics, general questions).
2. It queries MongoDB Atlas to retrieve matching records.
3. The data is loaded into the prompt context and sent to Groq.
4. Groq generates the response, which is streamed back to the frontend in real-time using **Server-Sent Events (SSE)**.

---

## 7. Phase 6: Interview Setup & Scheduling

### Step 15: Booking an Interview Slot
1. Recruiter schedules a slot for a candidate in the portal.
2. The backend validates MongoDB records to prevent timing conflicts.
3. The interview details are saved to MongoDB.

### Step 16: LiveKit Room Setup
1. The backend calls the **LiveKit API** to dynamically create a secure video room.
2. The system generates two distinct tokens:
   * **Recruiter Token:** Moderator privileges (mute others, end call).
   * **Candidate Token:** Guest privileges.
3. The backend generates a secure interview invite link containing the room token.
4. An email containing the link is sent to the candidate and recruiter via SMTP.
5. The background scheduler (APScheduler) queues a reminder email to be sent 15 minutes before the start time.

---

## 8. Phase 7: Video Interview & Proctoring

### Step 17: Candidate Joins
1. Candidate opens the link and grants camera and microphone permissions.
2. The frontend establishes a direct WebRTC connection to the **LiveKit server** using native `<LiveKitRoom>` React components.

```
       Candidate Browser  <==== WebRTC ====>  LiveKit Cloud Server
             |
      MediaPipe Proctoring
      (Eye Gaze & Focus check)
             |
             v
      FastAPI Backend
```

### Step 18: Client-Side AI Proctoring
During the interview, the candidate's browser runs real-time proctoring metrics:
* **MediaPipe FaceMesh:** Analyzes eye coordinates to count looks away from the screen and logs face presence (flagging multiple faces or if the candidate leaves).
* **Visibility Listeners:** Tracks if the candidate switches browser tabs, leaves fullscreen mode, or performs copy/paste actions.
* **Voice Activity Detection:** Tracks speaking ratios to evaluate conversational balance.
* **Logging:** Any violation is logged to the backend database instantly.

---

## 9. Phase 8: Recording, Transcription, & Evaluation

### Step 19: Audio Processing
1. When the call ends, the audio file is stored in **Supabase Storage** (or local uploads folder).
2. The backend sends the audio file to **Groq Whisper** (`whisper-large-v3-turbo`).
3. Whisper returns a timestamped textual transcription.

### Step 20: AI Scorecard Compilation
1. The backend compiles the transcript, proctoring violations list, speaking ratio, and score sheet.
2. The data is sent to Groq.
3. Groq generates an evaluation report covering:
   * **Technical Proficiency:** Correctness of candidate answers.
   * **Communication & Confidence:** Tone and speaking pace.
   * **Integrity Rating:** Likelihood of cheating based on proctoring records.
   * **Final Recommendation.**
4. The backend generates a print-ready PDF using `ReportLab` and saves it to storage.
5. The candidate status is updated in MongoDB, ready for the recruiter to review.
