import { useEffect, useRef, useState } from 'react';
import API from '../api/client';
import { useLocalParticipant } from '@livekit/components-react';

export default function InterviewMonitor({ candidateId, onStop }) {
  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  
  const { cameraTrack, microphoneTrack } = useLocalParticipant();

  const statsRef = useRef({
    looking_away_count: 0,
    no_face_count: 0,
    multiple_faces_count: 0,
    smiling_count: 0,
    talking_count: 0,
    anxious_count: 0
  });

  const [status, setStatus] = useState('Initializing monitoring...');
  const [currentFocus, setCurrentFocus] = useState('Stable');
  const [riskAlert, setRiskAlert] = useState(null);

  useEffect(() => {
    const videoTrack = cameraTrack?.track;
    const audioTrack = microphoneTrack?.track;

    if (!videoTrack || !audioTrack) {
      setStatus('Waiting for video/audio streams...');
      return;
    }

    let stream = null;
    let statInterval = null;
    let audioInterval = null;
    let audioContext = null;
    let analyser = null;
    let faceMesh = null;
    let lastInference = 0;
    const INFERENCE_THROTTLE_MS = 200; // ~5 FPS for CPU efficiency
    let active = true;
    let animationFrameId = null;

    const startMonitoring = async () => {
      try {
        // Video-only stream for face mesh rendering
        const videoOnlyStream = new MediaStream();
        if (videoTrack.mediaStreamTrack) {
          videoOnlyStream.addTrack(videoTrack.mediaStreamTrack);
        }

        if (videoRef.current) {
          videoRef.current.srcObject = videoOnlyStream;
        }

        // --- Audio Recording (Chunks every 10s with valid WebM/fallback headers) ---
        try {
          let options = {};
          if (typeof MediaRecorder.isTypeSupported === 'function') {
            if (MediaRecorder.isTypeSupported('audio/webm')) {
              options = { mimeType: 'audio/webm' };
            } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
              options = { mimeType: 'audio/ogg' };
            } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
              options = { mimeType: 'audio/mp4' };
            }
          }
          
          // Audio-only stream for recording to prevent container compatibility exceptions
          const audioOnlyStream = new MediaStream();
          if (audioTrack.mediaStreamTrack) {
            audioOnlyStream.addTrack(audioTrack.mediaStreamTrack);
          }
          
          mediaRecorderRef.current = new MediaRecorder(audioOnlyStream, options);
          mediaRecorderRef.current.ondataavailable = async (e) => {
            if (e.data && e.data.size > 0) {
              const formData = new FormData();
              formData.append('audio', e.data, 'chunk.webm');
              formData.append('candidate_id', candidateId);
              try {
                await API.post('/audio/upload', formData, {
                  headers: { 'Content-Type': 'multipart/form-data' }
                });
              } catch (err) {
                console.error('Audio chunk upload failed', err);
              }
            }
          };
          mediaRecorderRef.current.start();
          audioInterval = setInterval(() => {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
              mediaRecorderRef.current.stop();
              mediaRecorderRef.current.start();
            }
          }, 10000);
        } catch (mediaRecError) {
          console.error('Failed to initialize or start MediaRecorder:', mediaRecError);
        }

        // --- Audio Analysis (Silence Detection) ---
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        analyser.fftSize = 256;
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        
        let silenceStart = null;
        const checkSilence = () => {
          if (!active || !analyser) return;
          analyser.getByteFrequencyData(dataArray);
          const volume = dataArray.reduce((a, b) => a + b) / dataArray.length;
          
          if (volume < 5) { // Threshold for silence
             if (!silenceStart) silenceStart = Date.now();
             else if (Date.now() - silenceStart > 10000) { // 10s of silence
                statsRef.current.suspicious_events = statsRef.current.suspicious_events || [];
                if (!statsRef.current.suspicious_events.some(e => e.type === 'long_silence')) {
                    statsRef.current.suspicious_events.push({ type: 'long_silence', time: new Date().toISOString(), detail: 'Extended silence detected' });
                }
             }
          } else {
             silenceStart = null;
          }
          if (audioContext && audioContext.state !== 'closed') requestAnimationFrame(checkSilence);
        };
        checkSilence();

        // --- Face Monitoring (MediaPipe) ---
        faceMesh = new window.FaceMesh({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });

        faceMesh.setOptions({
          maxNumFaces: 2, // detect if someone else is there
          refineLandmarks: true,
          minDetectionConfidence: 0.6,
          minTrackingConfidence: 0.6
        });

        faceMesh.onResults((results) => {
          if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
            statsRef.current.no_face_count += 1;
            statsRef.current.presence = false;
            setCurrentFocus('Not Detected');
            
            // Report to proctoring violations
            const now = Date.now();
            if (!statsRef.current.lastNoFaceReported || (now - statsRef.current.lastNoFaceReported > 15000)) {
              statsRef.current.lastNoFaceReported = now;
              API.post('/interviews/proctoring-event', {
                candidate_id: candidateId,
                violation_type: 'face_absent',
                severity: 'high',
                details: 'No face detected in camera feed',
                count: 1
              }).catch(() => {});
            }
            return;
          }

          statsRef.current.presence = true;
          const faces = results.multiFaceLandmarks.length;
          if (faces > 1) {
            statsRef.current.multiple_faces_count += 1;
            setRiskAlert('Security Alert: Multiple People Detected');
            statsRef.current.suspicious_events = statsRef.current.suspicious_events || [];
            const now = Date.now();
            if (!statsRef.current.suspicious_events.some(e => e.type === 'multiple_faces' && (now - new Date(e.time).getTime() < 10000))) {
                statsRef.current.suspicious_events.push({ type: 'multiple_faces', time: new Date().toISOString(), detail: `${faces} people detected` });
            }
            
            if (!statsRef.current.lastMultipleFacesReported || (now - statsRef.current.lastMultipleFacesReported > 10000)) {
              statsRef.current.lastMultipleFacesReported = now;
              API.post('/interviews/proctoring-event', {
                candidate_id: candidateId,
                violation_type: 'multiple_faces',
                severity: 'high',
                details: `${faces} people detected in camera feed`,
                count: 1
              }).catch(() => {});
            }
          } else {
            setRiskAlert(null);
          }

          const landmarks = results.multiFaceLandmarks[0];
          
          // 1. Precise Gaze & Iris Tracking
          const leftIris = landmarks[468];
          const rightIris = landmarks[473];
          const leftEyeOuter = landmarks[33];
          const leftEyeInner = landmarks[133];

          if (leftIris && rightIris) {
            const gazeX = (leftIris.x - leftEyeOuter.x) / (leftEyeInner.x - leftEyeOuter.x);
            if (gazeX < 0.2 || gazeX > 0.8) {
               statsRef.current.looking_away_count += 1;
               setCurrentFocus('Looking Away');
               
               const now = Date.now();
               if (!statsRef.current.lastLookingAwayReported || (now - statsRef.current.lastLookingAwayReported > 15000)) {
                 statsRef.current.lastLookingAwayReported = now;
                 API.post('/interviews/proctoring-event', {
                   candidate_id: candidateId,
                   violation_type: 'looking_away',
                   severity: 'medium',
                   details: 'Candidate looking away from screen',
                   count: 1
                 }).catch(() => {});
               }
            } else {
               setCurrentFocus('Stable');
            }
          }

          // 2. Head Pose
          const nose = landmarks[1];
          const leftEar = landmarks[234];
          const rightEar = landmarks[454];
          const forehead = landmarks[10];
          const chin = landmarks[152];

          const yaw = (nose.x - (leftEar.x + rightEar.x) / 2) / (rightEar.x - leftEar.x);
          const pitch = (nose.y - (forehead.y + chin.y) / 2) / (chin.y - forehead.y);

          if (Math.abs(yaw) > 0.25 || Math.abs(pitch) > 0.25) {
             statsRef.current.looking_away_count += 0.5;
             setCurrentFocus('Distracted');
             if (Math.abs(yaw) > 0.4 || Math.abs(pitch) > 0.4) {
                 statsRef.current.suspicious_events = statsRef.current.suspicious_events || [];
                 if (!statsRef.current.suspicious_events.some(e => e.type === 'looking_away_repeatedly')) {
                    statsRef.current.suspicious_events.push({ type: 'looking_away_repeatedly', time: new Date().toISOString() });
                 }
                 
                 const now = Date.now();
                 if (!statsRef.current.lastGazeReported || (now - statsRef.current.lastGazeReported > 15000)) {
                   statsRef.current.lastGazeReported = now;
                   API.post('/interviews/proctoring-event', {
                     candidate_id: candidateId,
                     violation_type: 'looking_away',
                     severity: 'medium',
                     details: 'Candidate looking away from screen repeatedly',
                     count: 1
                   }).catch(() => {});
                 }
             }
          }
          
          // 3. Posture Stability
          const currentY = landmarks[1].y;
          if (statsRef.current.lastY && Math.abs(currentY - statsRef.current.lastY) > 0.1) {
              statsRef.current.posture_shift = (statsRef.current.posture_shift || 0) + 1;
          }
          statsRef.current.lastY = currentY;

          // 4. Expression & Emotion detection (smiling, talking, eyebrows)
          const leftEyeInnerPt = landmarks[133];
          const rightEyeInnerPt = landmarks[362];
          if (leftEyeInnerPt && rightEyeInnerPt) {
            const eyeDist = Math.hypot(leftEyeInnerPt.x - rightEyeInnerPt.x, leftEyeInnerPt.y - rightEyeInnerPt.y);
            
            // Smile Detection
            const mouthLeft = landmarks[61];
            const mouthRight = landmarks[291];
            if (mouthLeft && mouthRight && eyeDist > 0) {
              const mouthWidth = Math.hypot(mouthLeft.x - mouthRight.x, mouthLeft.y - mouthRight.y);
              const smileRatio = mouthWidth / eyeDist;
              if (smileRatio > 0.82) {
                statsRef.current.smiling_count = (statsRef.current.smiling_count || 0) + 1;
              }
            }

            // Talk Detection
            const lipTop = landmarks[13];
            const lipBottom = landmarks[14];
            if (lipTop && lipBottom && eyeDist > 0) {
              const lipDist = Math.hypot(lipTop.x - lipBottom.x, lipTop.y - lipBottom.y);
              const mouthOpenRatio = lipDist / eyeDist;
              if (mouthOpenRatio > 0.12) {
                statsRef.current.talking_count = (statsRef.current.talking_count || 0) + 1;
              }
            }

            // Eyebrow Raised
            const eyebrowLeft = landmarks[70];
            const eyeLeftUpper = landmarks[159];
            if (eyebrowLeft && eyeLeftUpper && eyeDist > 0) {
              const eyebrowDist = Math.hypot(eyebrowLeft.x - eyeLeftUpper.x, eyebrowLeft.y - eyeLeftUpper.y);
              const eyebrowRatio = eyebrowDist / eyeDist;
              if (eyebrowRatio > 0.28) {
                statsRef.current.anxious_count = (statsRef.current.anxious_count || 0) + 1;
              }
            }
          }
        });

        // Loop to send frames to faceMesh
        const processFrame = async () => {
          if (!active) return;
          if (videoRef.current && videoRef.current.readyState >= 2 && !videoRef.current.paused) {
            const now = Date.now();
            if (now - lastInference >= INFERENCE_THROTTLE_MS) {
              lastInference = now;
              try {
                await faceMesh.send({ image: videoRef.current });
              } catch (err) {
                console.error("FaceMesh send error:", err);
              }
            }
          }
          animationFrameId = requestAnimationFrame(processFrame);
        };
        
        processFrame();
        setStatus('Monitoring Active');

        // --- Stat reporting every 5s ---
        statInterval = setInterval(() => {
          API.post('/interviews/face-stats', {
            candidate_id: candidateId,
            looking_away_count: Math.floor(statsRef.current.looking_away_count),
            no_face_count: statsRef.current.no_face_count,
            multiple_faces_count: statsRef.current.multiple_faces_count,
            tab_switches: statsRef.current.tab_switches || 0,
            copy_paste_count: statsRef.current.copy_paste_count || 0,
            posture_shift: statsRef.current.posture_shift || 0,
            presence: statsRef.current.presence ?? true,
            suspicious_events: statsRef.current.suspicious_events || [],
            smiling_count: statsRef.current.smiling_count || 0,
            talking_count: statsRef.current.talking_count || 0,
            anxious_count: statsRef.current.anxious_count || 0
          }).catch(console.error);

          // Reset stats for next 5s window
          statsRef.current = { 
            ...statsRef.current,
            looking_away_count: 0, no_face_count: 0, multiple_faces_count: 0,
            tab_switches: 0, copy_paste_count: 0, posture_shift: 0, suspicious_events: [],
            smiling_count: 0, talking_count: 0, anxious_count: 0
          };
        }, 5000);

      } catch (err) {
        setStatus('Failed to start monitoring (No camera/mic?)');
        console.error(err);
      }
    };

    startMonitoring();

    return () => {
      active = false;
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      clearInterval(statInterval);
      clearInterval(audioInterval);
      if (faceMesh) faceMesh.close();
      if (audioContext) audioContext.close();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, [candidateId, cameraTrack, microphoneTrack]);

  return (
    <div style={{ padding: 12, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, display: 'flex', gap: 16, alignItems: 'center', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
      <div style={{ position: 'relative', width: 140, height: 105, borderRadius: 10, overflow: 'hidden', background: '#000' }}>
        <video 
          ref={videoRef} 
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} 
          autoPlay playsInline muted 
        />
        <div style={{ position: 'absolute', bottom: 6, left: 6, right: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ background: 'rgba(15, 23, 42, 0.7)', color: '#fff', fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4, backdropFilter: 'blur(4px)', textAlign: 'center' }}>
            {currentFocus.toUpperCase()}
          </div>
          {riskAlert && (
             <div style={{ background: 'rgba(239, 68, 68, 0.9)', color: '#fff', fontSize: 8, fontWeight: 600, padding: '2px 4px', borderRadius: 4, textAlign: 'center' }}>
               RISK ALERT
             </div>
          )}
        </div>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: status.includes('Active') ? '#10b981' : '#ef4444', animation: status.includes('Active') ? 'pulse 2s infinite' : 'none' }} />
          <div style={{ fontWeight: 600, fontSize: 13, color: '#1e293b', letterSpacing: '0.3px' }}>
            {status}
          </div>
        </div>
        <p style={{ fontSize: 11, color: '#64748b', fontWeight: 500, lineHeight: 1.4 }}>
          AI Behavioral Tracking Active. <br/>Analyzing attention & integrity.
        </p>
      </div>
      <style>{`
        @keyframes pulse {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.2); opacity: 0.6; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
