@echo off
title HireIQ Recruiter OS Starter
echo =======================================================
echo           Starting HireIQ Recruiter OS...
echo =======================================================
echo.

echo [1/3] Starting FastAPI Backend on Port 8000...
start "HireIQ Backend" cmd /k "cd backend && venv\Scripts\python main.py"

echo.
echo [2/3] Starting React Frontend...
start "HireIQ Frontend" cmd /k "cd frontend && npm run dev"

echo.
echo =======================================================
echo   All systems started in separate windows!
echo   - Backend:  http://127.0.0.1:8000
echo   - Frontend: http://localhost:5173
echo.
echo   SHARING WITH CANDIDATES (same WiFi/LAN):
echo   Find your LAN IP: ipconfig (look for IPv4 Address)
echo   Then share: http://YOUR-LAN-IP:5173
echo   Example:   http://192.168.1.10:5173
echo.
echo   SHARING EXTERNALLY (ngrok):
echo   Run: ngrok http 5173
echo   Then share the https://xxxx.ngrok-free.app link
echo   Update backend/.env FRONTEND_URL with ngrok URL
echo   when active for emails to include correct links.
echo.
echo   To shut down the platform, close the terminal windows.
echo =======================================================
pause
