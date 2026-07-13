import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import API from '../api/client';
import toast from 'react-hot-toast';
import { Camera, Mic, ShieldAlert, CheckCircle, Video, Play, AlertTriangle } from 'lucide-react';
import InterviewMonitor from '../components/InterviewMonitor';
import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react';
import '@livekit/components-styles';
import CustomInterviewCall from '../components/CustomInterviewCall';

export default function CandidateInterview() {
  const { secureToken } = useParams();
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [candidateData, setCandidateData] = useState(null);

  // Device settings states
  const [videoDevices, setVideoDevices] = useState([]);
  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState('');
  const [selectedAudio, setSelectedAudio] = useState('');
  const [localStream, setLocalStream] = useState(null);
  const [micLevel, setMicLevel] = useState(0);
  const [hasPermissions, setHasPermissions] = useState(false);

  // Validation state
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [joinStatus, setJoinStatus] = useState('loading'); // 'loading' | 'early' | 'grace_expired' | 'ready'
  const [timeUntilStart, setTimeUntilStart] = useState('');

  // Interview state
  const [inCall, setInCall] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [livekitToken, setLivekitToken] = useState(null);
  const [livekitRoom, setLivekitRoom] = useState(null);
  const [livekitUrl, setLivekitUrl] = useState(null);

  const videoPreviewRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);

  // Fetch interview metadata
  useEffect(() => {
    async function fetchMetadata() {
      try {
        const res = await API.get(`/interviews/token/${secureToken}`);
        setCandidateData(res.data);
        setLoading(false);
      } catch (err) {
        // Distinguish network errors from invalid token errors
        if (!err.response) {
          // Network error — backend unreachable
          setErrorMsg(
            'Unable to connect to the interview server. Please make sure you have a stable internet connection and try again. If the problem persists, contact your recruiter for a new interview link.'
          );
        } else {
          setErrorMsg(err.response?.data?.detail || 'This interview link is invalid or has expired. Please contact your recruiter for a new link.');
        }
        setLoading(false);
      }
    }
    fetchMetadata();
  }, [secureToken]);



  const reportViolation = async (type, severity, details) => {
    if (!candidateData?.candidate_id) return;
    try {
      await API.post('/interviews/proctoring-event', {
        candidate_id: candidateData.candidate_id,
        violation_type: type,
        severity,
        details,
        count: 1,
      });
    } catch (err) {
      console.error('Failed to report proctoring event:', err);
    }
  };

  const requestFullscreen = () => {
    const element = document.documentElement;
    if (element.requestFullscreen) {
      element.requestFullscreen();
    } else if (element.webkitRequestFullscreen) {
      element.webkitRequestFullscreen();
    } else if (element.mozRequestFullScreen) {
      element.mozRequestFullScreen();
    } else if (element.msRequestFullscreen) {
      element.msRequestFullscreen();
    }
  };

  // Fullscreen monitor hook
  useEffect(() => {
    if (!inCall) return;

    const onFullscreenChange = () => {
      const isCurrentlyFullscreen = !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
      );
      setIsFullscreen(isCurrentlyFullscreen);

      if (!isCurrentlyFullscreen && candidateData) {
        reportViolation('fullscreen_exit', 'high', 'Exited fullscreen mode');
        API.post('/interviews/face-stats', {
          candidate_id: candidateData.candidate_id,
          looking_away_count: 0,
          no_face_count: 0,
          multiple_faces_count: 0,
          tab_switches: 0,
          copy_paste_count: 0,
          posture_shift: 0,
          presence: true,
          suspicious_events: [{ type: 'fullscreen_exit', time: new Date().toISOString(), detail: 'Exited fullscreen mode' }],
          smiling_count: 0,
          talking_count: 0,
          anxious_count: 0
        }).catch(console.error);
        toast.error('Fullscreen exited! Please re-enter fullscreen to continue.');
      }
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    document.addEventListener('mozfullscreenchange', onFullscreenChange);
    document.addEventListener('MSFullscreenChange', onFullscreenChange);

    // Initial fullscreen request
    requestFullscreen();

    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
      document.removeEventListener('mozfullscreenchange', onFullscreenChange);
      document.removeEventListener('MSFullscreenChange', onFullscreenChange);
    };
  }, [inCall, candidateData]);

  // Keyboard shortcut block hook
  useEffect(() => {
    if (!inCall) return;

    const handleKeyDown = (e) => {
      const isCtrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (
        (isCtrl && (key === 'c' || key === 'v' || key === 'x' || key === 'p' || key === 'u' || key === 's')) ||
        key === 'f12' ||
        e.key === 'Meta' ||
        (e.altKey && key === 'tab') ||
        (e.altKey && key === 'f4')
      ) {
        e.preventDefault();
        toast.error('Security violation: Key shortcut blocked.');

        if (candidateData) {
          reportViolation('copy_paste', 'low', `Attempted keyboard shortcut: ${e.key}`);
          API.post('/interviews/face-stats', {
            candidate_id: candidateData.candidate_id,
            looking_away_count: 0,
            no_face_count: 0,
            multiple_faces_count: 0,
            tab_switches: 0,
            copy_paste_count: 1,
            posture_shift: 0,
            presence: true,
            suspicious_events: [{ type: 'blocked_shortcut', time: new Date().toISOString(), detail: `Attempted keyboard shortcut: ${e.key}` }],
            smiling_count: 0,
            talking_count: 0,
            anxious_count: 0
          }).catch(console.error);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [inCall, candidateData]);

  // Security Locks & Proctoring Events (Copy, Paste, Right Click, Blur)
  useEffect(() => {
    if (!inCall) return;

    const handleCopy = (e) => {
      e.preventDefault();
      reportViolation('copy_paste', 'low', 'Copy attempt blocked');
      toast.error('Copy function disabled.');
    };

    const handlePaste = (e) => {
      e.preventDefault();
      reportViolation('copy_paste', 'low', 'Paste attempt blocked');
      toast.error('Paste function disabled.');
    };

    const handleContextMenu = (e) => {
      e.preventDefault();
      toast.error('Right-click menu disabled.');
    };

    const handleBlur = () => {
      // Small timeout to allow document.activeElement to update
      setTimeout(() => {
        const activeEl = document.activeElement;
        
        // If focus shifted to any embedded iframe, it's not a tab switch
        if (activeEl && activeEl.tagName === 'IFRAME') {
          return;
        }

        if (candidateData) {
          reportViolation('tab_switch', 'high', 'Candidate switched tabs or lost focus');
          API.post('/interviews/face-stats', {
            candidate_id: candidateData.candidate_id,
            looking_away_count: 0,
            no_face_count: 0,
            multiple_faces_count: 0,
            tab_switches: 1,
            copy_paste_count: 0,
            posture_shift: 0,
            presence: true,
            suspicious_events: [{ type: 'tab_switch', time: new Date().toISOString(), detail: 'Candidate switched tabs or lost focus' }],
            smiling_count: 0,
            talking_count: 0,
            anxious_count: 0
          }).catch(console.error);
          toast.error('Security alert: Tab switched or window lost focus!');
        }
      }, 100);
    };

    const handleVisibilityChange = () => {
      if (document.hidden && candidateData) {
        reportViolation('tab_switch', 'high', 'Candidate switched tabs (page hidden)');
        API.post('/interviews/face-stats', {
          candidate_id: candidateData.candidate_id,
          looking_away_count: 0,
          no_face_count: 0,
          multiple_faces_count: 0,
          tab_switches: 1,
          copy_paste_count: 0,
          posture_shift: 0,
          presence: true,
          suspicious_events: [{ type: 'tab_switch', time: new Date().toISOString(), detail: 'Candidate switched tabs (page hidden)' }],
          smiling_count: 0,
          talking_count: 0,
          anxious_count: 0
        }).catch(console.error);
        toast.error('Security alert: Tab switched!');
      }
    };

    document.addEventListener('copy', handleCopy);
    document.addEventListener('paste', handlePaste);
    document.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('copy', handleCopy);
      document.removeEventListener('paste', handlePaste);
      document.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [inCall, candidateData]);

  // Time & Grace Period Checks
  useEffect(() => {
    if (!candidateData) return;
    const timer = setInterval(() => {
      const now = new Date();
      // Date in ISO format (YYYY-MM-DD) and Time (HH:MM)
      const scheduledTimeStr = `${candidateData.date}T${candidateData.time}:00`;
      const scheduledDate = new Date(scheduledTimeStr);

      const diffMs = scheduledDate.getTime() - now.getTime();
      const fifteenMinsMs = 15 * 60 * 1000;

      if (diffMs > 0) {
        // Early
        setJoinStatus('early');
        const mins = Math.floor(diffMs / 60000);
        const secs = Math.floor((diffMs % 60000) / 1000);
        setTimeUntilStart(`Starts in ${mins}m ${secs}s`);
      } else if (Math.abs(diffMs) > fifteenMinsMs) {
        // Expired (Past 15 min grace period)
        setJoinStatus('grace_expired');
      } else {
        // Within 15-minute window
        setJoinStatus('ready');
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [candidateData]);

  // Start hardware stream for setup preview
  useEffect(() => {
    if (loading || errorMsg || inCall) return;

    async function initDevices() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setLocalStream(stream);
        setHasPermissions(true);
        if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = stream;
        }

        const devices = await navigator.mediaDevices.enumerateDevices();
        const vDevs = devices.filter(d => d.kind === 'videoinput');
        const aDevs = devices.filter(d => d.kind === 'audioinput');

        setVideoDevices(vDevs);
        setAudioDevices(aDevs);

        if (vDevs.length > 0) setSelectedVideo(vDevs[0].deviceId);
        if (aDevs.length > 0) setSelectedAudio(aDevs[0].deviceId);

        // Set up audio analyzer for level indicator
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        audioContextRef.current = audioCtx;
        const analyser = audioCtx.createAnalyser();
        analyserRef.current = analyser;
        analyser.fftSize = 256;
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const drawLevel = () => {
          if (!analyserRef.current) return;
          analyser.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((sum, val) => sum + val, 0) / dataArray.length;
          // Scale level to a percentage
          setMicLevel(Math.min(100, Math.floor(average * 1.8)));
          rafRef.current = requestAnimationFrame(drawLevel);
        };
        drawLevel();
      } catch (err) {
        setHasPermissions(false);
        console.error('Camera/Mic permission failed:', err);
        toast.error('Could not access camera/microphone. Please check permissions.');
      }
    }

    initDevices();

    return () => {
      cancelAnimationFrame(rafRef.current);
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [loading, errorMsg, inCall]);

  // Handle source device change
  const handleDeviceChange = async (type, deviceId) => {
    if (type === 'video') {
      setSelectedVideo(deviceId);
      try {
        if (localStream) {
          localStream.getVideoTracks().forEach(t => t.stop());
        }
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId } },
          audio: { deviceId: selectedAudio ? { exact: selectedAudio } : undefined }
        });
        setLocalStream(newStream);
        if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = newStream;
        }
      } catch (err) {
        toast.error('Failed to change video device');
      }
    } else {
      setSelectedAudio(deviceId);
      try {
        if (localStream) {
          localStream.getAudioTracks().forEach(t => t.stop());
        }
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: selectedVideo ? { deviceId: { exact: selectedVideo } } : undefined,
          audio: { deviceId: { exact: deviceId } }
        });
        setLocalStream(newStream);

        // Reconnect audio context analyser
        if (audioContextRef.current) {
          const source = audioContextRef.current.createMediaStreamSource(newStream);
          source.connect(analyserRef.current);
        }
      } catch (err) {
        toast.error('Failed to change audio device');
      }
    }
  };

  // Launch restricted LiveKit call
  const joinSecureInterview = async () => {
    if (!identityConfirmed) {
      toast.error('Please confirm your identity and proctoring consent.');
      return;
    }
    if (joinStatus === 'early') {
      toast.error('Meeting has not started yet.');
      return;
    }
    if (joinStatus === 'grace_expired') {
      toast.error('Meeting slot has expired.');
      return;
    }

    // Request fullscreen immediately synchronously to satisfy user gesture rule
    requestFullscreen();

    setLoading(true);
    try {
      // Release camera preview stream to allow LiveKit to grab the hardware
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }

      // Fetch restricted candidate JWT token
      const res = await API.post('/interviews/tokens/candidate', { candidate_id: candidateData.candidate_id });
      setLivekitToken(res.data.livekit_token);
      setLivekitRoom(res.data.livekit_room);
      setLivekitUrl(res.data.livekit_url);
      setInCall(true);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to authenticate secure session');
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flex: 1, height: '100vh', background: '#090d16', alignItems: 'center', justifyContent: 'center', fontFamily: 'Poppins, sans-serif' }}>
        <div style={{ textAlign: 'center', color: '#94a3b8' }}>
          <div style={{ border: '3px solid rgba(99, 102, 241, 0.1)', borderTop: '3px solid #6366f1', borderRadius: '50%', width: 40, height: 40, animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
          <div style={{ fontSize: 14, fontWeight: 500 }}>Connecting to Secure Gateway...</div>
        </div>
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (errorMsg) {
    const isNetworkError = errorMsg.includes('connect') || errorMsg.includes('internet') || errorMsg.includes('server');
    return (
      <div style={{ display: 'flex', flex: 1, height: '100vh', background: '#090d16', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'Poppins, sans-serif' }}>
        <div style={{ maxWidth: 480, width: '100%', background: '#0f172a', border: `1px solid ${isNetworkError ? '#fde68a' : '#fee2e2'}`, borderRadius: 16, padding: 32, textAlign: 'center', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>{isNetworkError ? '🌐' : '🔒'}</div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: isNetworkError ? '#fcd34d' : '#fca5a5', marginBottom: 12 }}>
            {isNetworkError ? 'Connection Problem' : 'Session Invalid'}
          </h2>
          <p style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.7, marginBottom: 24 }}>{errorMsg}</p>
          {isNetworkError ? (
            <button
              onClick={() => window.location.reload()}
              style={{ width: '100%', padding: '12px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600, marginBottom: 12 }}
            >
              🔄 Try Again
            </button>
          ) : null}
          <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.6 }}>
            {isNetworkError
              ? 'Make sure your internet is working. The interview session must be active for you to connect.'
              : 'Please contact your recruiting coordinator or request a new invitation link.'}
          </div>
        </div>
      </div>
    );
  }


  if (inCall) {
    return (
      <div style={{ display: 'flex', height: '100vh', width: '100vw', background: '#020617', position: 'relative', overflow: 'hidden', fontFamily: 'Poppins, sans-serif' }}>
        {/* Active LiveKit Video Area */}
        {(!livekitToken || !livekitUrl) ? (
          <div style={{ display: 'flex', flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center', background: '#020617' }}>
            <div style={{ textAlign: 'center', color: '#94a3b8' }}>
              <div style={{ border: '3px solid rgba(99, 102, 241, 0.1)', borderTop: '3px solid #6366f1', borderRadius: '50%', width: 40, height: 40, animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
              <div style={{ fontSize: 13, fontWeight: 500 }}>Connecting to secure video stream...</div>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, height: '100%', width: '100%', position: 'relative' }}>
            <LiveKitRoom
              video={true}
              audio={true}
              token={livekitToken}
              serverUrl={livekitUrl}
              connectOptions={{ autoSubscribe: true }}
              onDisconnected={() => {
                toast.success('You have left the secure session.');
                setInCall(false);
              }}
              style={{ height: '100%', width: '100%' }}
            >
              <CustomInterviewCall
                onLeave={() => setInCall(false)}
                candidateName={candidateData.candidate_name}
                recruiterName="Interviewer"
              />
              <RoomAudioRenderer />
              
              {/* Hidden / Floating Proctoring Engine */}
              <div style={{ position: 'fixed', bottom: 84, right: 16, zIndex: 9999, width: 280 }}>
                <InterviewMonitor candidateId={candidateData.candidate_id} />
              </div>
            </LiveKitRoom>
          </div>
        )}

        {/* Fullscreen Warning Overlay */}
        {!isFullscreen && (
          <div style={{
            position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
            background: 'rgba(9, 13, 22, 0.98)', color: '#fff', zIndex: 100000,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: 24, fontFamily: 'Poppins, sans-serif', textAlign: 'center'
          }}>
            <AlertTriangle size={48} className="text-amber-500" style={{ marginBottom: 16 }} />
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>Fullscreen Mode Required</h2>
            <p style={{ fontSize: 14, color: '#94a3b8', maxWidth: 420, marginBottom: 24, lineHeight: 1.6 }}>
              To maintain the integrity of this secure interview, you must remain in fullscreen mode at all times. Please click the button below to resume.
            </p>
            <button
              onClick={requestFullscreen}
              style={{
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff',
                border: 'none', borderRadius: 8, padding: '12px 24px', fontSize: 14,
                fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 12px rgba(99,102,241,0.3)',
                display: 'flex', alignItems: 'center', gap: 8
              }}
            >
              <Video size={16} /> Enter Fullscreen & Resume
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: '100vh', background: '#090d16', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'Poppins, sans-serif' }}>
      <div style={{ maxWidth: 900, width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, background: '#0f172a', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 16, padding: 32, boxShadow: '0 20px 40px rgba(0,0,0,0.4)', color: '#f8fafc' }}>
        
        {/* Left Side: Hardware Preview & Indicator */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ position: 'relative', width: '100%', aspectRatio: '4/3', borderRadius: 12, overflow: 'hidden', background: '#020617', border: '1px solid #1e293b' }}>
            <video
              ref={videoPreviewRef}
              style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
              autoPlay playsInline muted
            />
            <div style={{ position: 'absolute', bottom: 12, left: 12, display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(15,23,42,0.8)', padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: localStream ? '#10b981' : '#ef4444' }} />
              {localStream ? 'Camera Feed Online' : 'Camera Disconnected'}
            </div>
          </div>

          {/* Real-time mic indicator */}
          <div style={{ background: '#020617', borderRadius: 12, padding: 16, border: '1px solid #1e293b' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 8 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Mic size={12} /> Microphone Input</span>
              <span>{micLevel > 0 ? 'Active' : 'Silent'}</span>
            </div>
            <div style={{ height: 6, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${micLevel}%`, height: '100%', background: 'linear-gradient(90deg, #6366f1, #8b5cf6)', borderRadius: 3, transition: 'width 0.1s ease' }} />
            </div>
          </div>
        </div>

        {/* Right Side: Setup & Details */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 800, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 12 }}>
              <ShieldAlert size={14} /> Secure Interview Portal
            </div>
            
            <h2 style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 6 }}>Welcome, {candidateData.candidate_name}</h2>
            <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 20 }}>You have been invited to interview for the role of <b>{candidateData.job_title}</b>.</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: '#020617', border: '1px solid #1e293b', borderRadius: 12, padding: 16, marginBottom: 20, fontSize: 13 }}>
              <div><span style={{ color: '#64748b' }}>Date:</span> <b style={{ color: '#cbd5e1' }}>{candidateData.date}</b></div>
              <div><span style={{ color: '#64748b' }}>Time:</span> <b style={{ color: '#cbd5e1' }}>{candidateData.time}</b></div>
              <div><span style={{ color: '#64748b' }}>Duration:</span> <b style={{ color: '#cbd5e1' }}>{candidateData.duration} minutes</b></div>
            </div>

            {/* Hardware selectors */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>Camera Device</label>
                <select
                  value={selectedVideo}
                  onChange={(e) => handleDeviceChange('video', e.target.value)}
                  style={{ width: '100%', background: '#020617', border: '1px solid #1e293b', color: '#cbd5e1', borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none' }}
                >
                  {videoDevices.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${videoDevices.indexOf(d) + 1}`}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>Microphone Device</label>
                <select
                  value={selectedAudio}
                  onChange={(e) => handleDeviceChange('audio', e.target.value)}
                  style={{ width: '100%', background: '#020617', border: '1px solid #1e293b', color: '#cbd5e1', borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none' }}
                >
                  {audioDevices.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${audioDevices.indexOf(d) + 1}`}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Identity Consent Box */}
            <label style={{ display: 'flex', gap: 10, background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: 10, padding: 12, cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={identityConfirmed}
                onChange={(e) => setIdentityConfirmed(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.5 }}>
                By entering this interview room, I confirm I am <b>{candidateData.candidate_name}</b> and agree to the secure proctored environment.
              </span>
            </label>
          </div>

          {/* Join Portal Buttons */}
          <div style={{ marginTop: 24 }}>
            {joinStatus === 'early' && (
              <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b', borderRadius: 10, padding: 12, textAlign: 'center', fontSize: 13, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <AlertTriangle size={16} /> Meeting has not started. {timeUntilStart}
              </div>
            )}

            {joinStatus === 'grace_expired' && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', borderRadius: 10, padding: 12, textAlign: 'center', fontSize: 13, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <ShieldAlert size={16} /> Missed Interview: The 15-minute grace period has expired.
              </div>
            )}

            {!hasPermissions && (
              <div style={{
                background: 'rgba(239,68,68,0.15)',
                border: '2px solid #ef4444',
                color: '#fca5a5',
                borderRadius: 12,
                padding: '16px',
                textAlign: 'left',
                fontSize: 13.5,
                fontWeight: 600,
                marginBottom: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ef4444', fontSize: 15, fontWeight: 700 }}>
                  <ShieldAlert size={20} />
                  <span>MANDATORY WARNING: Camera & Microphone Access Denied</span>
                </div>
                <p style={{ margin: 0, color: '#cbd5e1', fontWeight: 400, lineHeight: 1.5 }}>
                  This interview room requires active camera and microphone access for verification and proctoring. You cannot join the interview without enabling these permissions.
                </p>
                <p style={{ margin: 0, color: '#94a3b8', fontWeight: 500, fontSize: 12 }}>
                  Please click the camera icon in your browser address bar, reset the permission to "Allow", and refresh this page.
                </p>
              </div>
            )}

            <button
              onClick={joinSecureInterview}
              disabled={!identityConfirmed || joinStatus !== 'ready' || !hasPermissions}
              style={{
                width: '100%',
                padding: '14px',
                background: identityConfirmed && joinStatus === 'ready' && hasPermissions ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : '#1e293b',
                color: identityConfirmed && joinStatus === 'ready' && hasPermissions ? '#fff' : '#64748b',
                border: 'none',
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 700,
                cursor: identityConfirmed && joinStatus === 'ready' && hasPermissions ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                transition: 'all 0.2s ease',
                boxShadow: identityConfirmed && joinStatus === 'ready' && hasPermissions ? '0 4px 20px rgba(99,102,241,0.3)' : 'none'
              }}
            >
              <Play size={16} fill="currentColor" /> Join Secure Interview
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
