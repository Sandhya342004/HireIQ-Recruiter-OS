# HireIQ Deployment Manual

This document provides step-by-step instructions to deploy the HireIQ platform to production. We will deploy the **FastAPI Backend to Render** and the **React Frontend to Vercel**.

---

## 📋 Required Configurations & Third-Party Accounts

Before initiating the deployments, set up and copy credentials from the following platforms:

### 1. MongoDB Atlas (Database)
1. Log in to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas).
2. Create a free-tier cluster (or use an existing one).
3. Under **Database Access**, create a user with read/write privileges (e.g., username: `admin`).
4. Under **Network Access**, add `0.0.0.0/0` to allow connections from Render's dynamic hosting IPs.
5. Retrieve your connection string under **Connect** ➔ **Drivers** (looks like `mongodb+srv://admin:<password>@cluster0.xxxx.mongodb.net/?retryWrites=true&w=majority`).

### 2. Groq Cloud (AI Services)
1. Log in to [Groq Console](https://console.groq.com).
2. Go to **API Keys** and generate a new key (starts with `gsk_`).

### 3. Brevo (SMTP Email Dispatcher)
1. Register for a free account at [Brevo](https://www.brevo.com).
2. Go to your **SMTP & API** dashboard.
3. Retrieve your SMTP details:
   - **SMTP Server:** `smtp-relay.brevo.com`
   - **Port:** `587`
   - **SMTP Username:** Your Brevo login email
   - **SMTP Password:** Your generated SMTP Master Password (not your account login password)

---

## 1. Deploy Backend to Render

1. Log in to [Render Console](https://dashboard.render.com).
2. Click **New +** ➔ **Web Service**.
3. Link your GitHub repository.
4. Set the following parameters:
   - **Name:** `hireiq-backend`
   - **Environment:** `Python`
   - **Branch:** `sandhya` (or your primary branch)
   - **Region:** Choose the region closest to your target audience.
   - **Build Command:** `pip install -r backend/requirements.txt`
   - **Start Command:** `cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Click **Advanced** and add the following **Environment Variables**:
   - `MONGO_URI`: *Your MongoDB Atlas connection string*
   - `DB_NAME`: `ats_platform`
   - `JWT_SECRET`: *Generate a strong secret (e.g., run `openssl rand -hex 32`)*
   - `ENCRYPTION_KEY`: `g7EuM8O_-qJTOyVDZZTutI-JHTmgWfezf8kHNnH5eOQ=`
   - `GROQ_API_KEY`: *Your Groq API key (`gsk_...`)*
   - `GROQ_MODEL`: `llama-3.3-70b-versatile`
   - `WHISPER_MODEL`: `whisper-large-v3-turbo`
   - `FRONTEND_URL`: *The public URL of your Vercel frontend (you will update this after deploying the frontend)*
   - `SMTP_SERVER`: `smtp-relay.brevo.com`
   - `SMTP_PORT`: `587`
   - `SMTP_USERNAME`: *Your Brevo SMTP email*
   - `SMTP_PASSWORD`: *Your Brevo SMTP Master Password*
   - `EMAIL_FROM`: *Your sender email configured in Brevo*
   - `APP_NAME`: `HireIQ Recruitment Platform`
   - `UPLOAD_DIR`: `uploads`
   - `LIVEKIT_URL`: *Your LiveKit Server URL (e.g., wss://my-livekit.livekit.cloud)*
   - `LIVEKIT_API_KEY`: *Your LiveKit API Key*
   - `LIVEKIT_API_SECRET`: *Your LiveKit API Secret*
6. Click **Deploy Web Service**.
7. Once deployed successfully, copy your backend's public URL (e.g., `https://hireiq-backend.onrender.com`).

---

## 2. Deploy Frontend to Vercel

1. Log in to [Vercel](https://vercel.com).
2. Click **Add New** ➔ **Project**.
3. Import your GitHub repository.
4. In the configuration settings:
   - **Framework Preset:** `Vite` (Vercel detects this automatically)
   - **Root Directory:** Edit and set to `frontend`
5. Open the **Environment Variables** section and define:
   - `VITE_API_BASE_URL`: *Your Render backend URL (e.g., `https://hireiq-backend.onrender.com`)*
   - `VITE_BACKEND_URL`: *Your Render backend URL (e.g., `https://hireiq-backend.onrender.com`)*
   - `VITE_FRONTEND_URL`: *Leave blank (will resolve dynamically at runtime via window.location.origin)*
6. Click **Deploy**.
7. Once the build finishes, copy your frontend's deployment URL (e.g., `https://hireiq-frontend.vercel.app`).

---

## 3. Post-Deployment Link Sync

Now that the frontend is live:
1. Go back to your Render Web Service dashboard ➔ **Environment**.
2. Update the `FRONTEND_URL` variable with your live Vercel URL:
   - `FRONTEND_URL`: `https://hireiq-frontend.vercel.app`
3. Save the changes. Render will automatically redeploy the service with the updated environment setting.

---

## 🧪 Post-Deployment Verification Checklist

Once both services are running, perform the following validation steps:

1. **Backend Health Check:** Open `https://your-backend.onrender.com/health` in your browser. Verify it returns `{"status":"ok", "database":"connected"}`.
2. **Dashboard Sourcing:** Log in to your recruiter portal, upload a JD, and verify that the system successfully parses keywords.
3. **Resume Screening:** Upload a batch of resumes and ensure the scoring engine processes them without errors.
4. **Manual Sharing:** Schedule a mock interview. Verify that the recruiter portal displays a confirmation panel with the dynamic candidate invite link, and check that the link points to your vercel app domain instead of localhost.
