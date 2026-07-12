import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import API from '../api/client';
import toast from 'react-hot-toast';
import Sidebar from '../components/Sidebar';
import Navbar from '../components/Navbar';
import { MdWarning, MdShield, MdVideocam, MdMicOff, MdStop,
         MdFullscreen, MdBarChart, MdPerson, MdTimer } from 'react-icons/md';
import { LiveKitRoom, RoomAudioRenderer, useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import '@livekit/components-styles';
import CustomInterviewCall from '../components/CustomInterviewCall';
import { useAuth } from '../context/AuthContext';

// ── Timezone-Aware Timestamp Formatter ──────────────────────────────────────────
const formatTimestamp = (ts) => {
  if (!ts) return 'Recent';
  const str = ts.toString();
  const hasTimezone = str.endsWith('Z') || str.includes('+') || str.includes('GMT');
  const dateObj = new Date(hasTimezone ? str : str + 'Z');
  return dateObj.toLocaleTimeString();
};


// ── Violation Banner ───────────────────────────────────────────────────────────
function ViolationBanner({ violations }) {
  const latest = violations[0];
  if (!latest) return null;
  const isHigh = latest.severity === 'high';
  return (
    <div style={{
      position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999, background: isHigh ? '#ef4444' : '#f59e0b',
      color: '#fff', padding: '10px 24px', borderRadius: 8,
      fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8,
      boxShadow: '0 4px 20px rgba(0,0,0,0.3)', animation: 'fadeIn 0.3s ease',
      maxWidth: 500,
    }}>
      <MdWarning size={18} />
      {isHigh ? 'INTEGRITY ALERT: ' : 'Warning: '}{latest.details}
    </div>
  );
}

// ── Live Stats Card ────────────────────────────────────────────────────────────
function StatCard({ label, value, color = '#6366f1' }) {
  return (
    <div style={{ background: '#1e293b', borderRadius: 10, padding: '12px 16px', border: '1px solid #334155' }}>
      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color }}>{value}</div>
    </div>
  );
}

// ── Recruiter Monitor Panel ────────────────────────────────────────────────────
function RecruiterMonitor({ candidateId, candidateName, violations, counts, elapsed, onEnd }) {
  const [proctoring, setProctoring] = useState(null);

  useEffect(() => {
    if (!candidateId) return;
    const poll = () => {
      API.get(`/interviews/proctoring-live/${candidateId}`)
        .then(r => setProctoring(r.data))
        .catch(() => {});
    };
    poll();
    const t = setInterval(poll, 8000);
    return () => clearInterval(t);
  }, [candidateId]);

  const integrity = proctoring?.integrity_score ?? 100;
  const risk = proctoring?.risk_level ?? 'low';
  const totalV = proctoring?.total_violations ?? Object.values(counts).reduce((a, b) => a + b, 0);
  const integrityColor = integrity > 75 ? '#10b981' : integrity > 50 ? '#f59e0b' : '#ef4444';
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  return (
    <div style={{ background: '#0f172a', borderRadius: 16, padding: 20, border: '1px solid #1e293b', color: '#fff', height: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Monitoring</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#fff', marginTop: 2 }}>{candidateName}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', animation: 'pulse 2s infinite' }} />
          <span style={{ fontSize: 12, color: '#10b981' }}>LIVE</span>
        </div>
      </div>

      {/* Timer */}
      <div style={{ background: '#1e293b', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
        <div style={{ fontSize: 10, color: '#64748b', marginBottom: 2 }}>ELAPSED TIME</div>
        <div style={{ fontSize: 24, fontWeight: 600, color: '#a5b4fc', fontVariantNumeric: 'tabular-nums' }}>
          {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
        </div>
      </div>

      {/* Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <StatCard label="Integrity Score" value={`${integrity}%`} color={integrityColor} />
        <StatCard label="Risk Level" value={risk.toUpperCase()} color={risk === 'low' ? '#10b981' : risk === 'medium' ? '#f59e0b' : '#ef4444'} />
        <StatCard label="Total Violations" value={totalV} color={totalV > 5 ? '#ef4444' : '#f59e0b'} />
        <StatCard label="Tab Switches" value={proctoring?.counts?.tab_switch ?? counts.tab_switch ?? 0} color="#f59e0b" />
      </div>

      {/* Integrity bar */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11, color: '#64748b' }}>
          <span>INTEGRITY</span><span>{integrity}%</span>
        </div>
        <div style={{ height: 6, background: '#1e293b', borderRadius: 999 }}>
          <div style={{ height: '100%', width: `${integrity}%`, background: integrityColor, borderRadius: 999, transition: 'width 0.5s' }} />
        </div>
      </div>

      {/* Recent violations */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Recent Alerts</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', maxHeight: 180 }}>
          {violations.length === 0 && (
            <div style={{ fontSize: 12, color: '#334155', textAlign: 'center', padding: '20px 0' }}>No violations detected</div>
          )}
          {violations.map((v, i) => (
            <div key={i} style={{
              padding: '6px 10px', borderRadius: 6, fontSize: 11,
              background: v.severity === 'high' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
              border: `1px solid ${v.severity === 'high' ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)'}`,
              color: v.severity === 'high' ? '#fca5a5' : '#fcd34d',
            }}>
              <span style={{ opacity: 0.6 }}>{v.time} · </span>{v.details || v.type}
            </div>
          ))}
        </div>
      </div>

      {/* End button */}
      <button onClick={onEnd} style={{
        background: '#ef4444', border: 'none', color: '#fff', borderRadius: 10,
        padding: '12px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      }}>
        <MdStop size={16} /> End Interview & Analyze
      </button>
    </div>
  );
}

// ── LiveKit Events Handler Component ───────────────────────────────────────────
function LiveKitEventsHandler({ candidateId }) {
  const room = useRoomContext();

  useEffect(() => {
    if (!room) return;

    const onParticipantConnected = async (participant) => {
      toast.success(`${participant.identity || 'Candidate'} joined the meeting`);
      try {
        await API.post(`/interviews/proctoring-event`, {
          candidate_id: candidateId,
          violation_type: 'candidate_joined',
          severity: 'low',
          details: `Candidate joined the LiveKit room`,
          count: 1
        });
      } catch (err) {
        console.error('Failed to report candidate joined', err);
      }
    };

    const onParticipantDisconnected = async (participant) => {
      toast.error('Participant left the meeting');
      try {
        await API.post(`/interviews/proctoring-event`, {
          candidate_id: candidateId,
          violation_type: 'candidate_left',
          severity: 'low',
          details: `Candidate left the LiveKit room`,
          count: 1
        });
      } catch (err) {
        console.error('Failed to report candidate left', err);
      }
    };

    const onTrackMuted = async (publication, participant) => {
      if (participant.identity.startsWith('candidate')) {
        const isAudio = publication.kind === 'audio';
        const type = isAudio ? 'mic_muted' : 'video_muted';
        const details = isAudio ? 'Candidate microphone is now Muted' : 'Candidate camera is now Muted';
        try {
          await API.post(`/interviews/proctoring-event`, {
            candidate_id: candidateId,
            violation_type: type,
            severity: 'low',
            details,
            count: 1
          });
        } catch (err) {}
      }
    };

    const onTrackUnmuted = async (publication, participant) => {
      if (participant.identity.startsWith('candidate')) {
        const isAudio = publication.kind === 'audio';
        const type = isAudio ? 'mic_active' : 'video_active';
        const details = isAudio ? 'Candidate microphone is now Active' : 'Candidate camera is now Active';
        try {
          await API.post(`/interviews/proctoring-event`, {
            candidate_id: candidateId,
            violation_type: type,
            severity: 'low',
            details,
            count: 1
          });
        } catch (err) {}
      }
    };

    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    room.on(RoomEvent.TrackMuted, onTrackMuted);
    room.on(RoomEvent.TrackUnmuted, onTrackUnmuted);

    return () => {
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
      room.off(RoomEvent.TrackMuted, onTrackMuted);
      room.off(RoomEvent.TrackUnmuted, onTrackUnmuted);
    };
  }, [room, candidateId]);

  return null;
}

// ── Main InterviewRoom Component ───────────────────────────────────────────────
export default function InterviewRoom() {
  const { user } = useAuth();
  const { candidateId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [candidate, setCandidate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [violations, setViolations] = useState([]);
  const [counts, setCounts] = useState({});
  const [livekitToken, setLivekitToken] = useState(null);
  const [livekitRoom, setLivekitRoom] = useState(null);
  const [livekitUrl, setLivekitUrl] = useState(null);
  const [ending, setEnding] = useState(false);
  const [liveData, setLiveData] = useState(null);

  const timerRef = useRef(null);

  const launchSession = useCallback(async () => {
    try {
      // Get recruiter token info for room and domain
      const tokenRes = await API.post('/interviews/tokens/recruiter', { candidate_id: candidateId });
      setLivekitToken(tokenRes.data.livekit_token);
      setLivekitRoom(tokenRes.data.livekit_room);
      setLivekitUrl(tokenRes.data.livekit_url);
    } catch (err) {
      console.error('LiveKit launch error:', err);
      toast.error(err.response?.data?.detail || 'Failed to authenticate secure session');
    }
  }, [candidateId]);

  // Live polling for transcript and proctoring
  useEffect(() => {
    if (!sessionStarted || !candidateId) return;
    const poll = () => {
      API.get(`/interviews/proctoring-live/${candidateId}`)
        .then(r => {
          setLiveData(r.data);
          if (r.data.violations) {
            setViolations(r.data.violations);
          }
          if (r.data.counts) {
            setCounts(r.data.counts);
          }
        })
        .catch(() => {});
    };
    poll();
    const t = setInterval(poll, 4000);
    return () => clearInterval(t);
  }, [sessionStarted, candidateId]);



  // Fetch candidate
  useEffect(() => {
    if (!candidateId) return;
    API.get(`/candidates/${candidateId}`)
      .then(r => {
        setCandidate(r.data);
        if (r.data?.interview?.status === 'live' || r.data?.interview?.status === 'candidate_joined') {
          setSessionStarted(true);
        }
      })
      .catch(() => toast.error('Failed to load interview data'))
      .finally(() => setLoading(false));
  }, [candidateId]);

  // Timer
  useEffect(() => {
    if (sessionStarted) {
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [sessionStarted]);

  // Auto-launch LiveKit when session starts
  useEffect(() => {
    if (sessionStarted) {
      const timer = setTimeout(() => {
        launchSession();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [sessionStarted, launchSession]);

  const startSession = async () => {
    try {
      const res = await API.post('/interviews/start', {
        candidate_id: candidateId,
        duration: candidate?.interview?.duration || 30,
      });
      setSessionId(res.data.session_id);
      setSessionStarted(true);
      toast.success('Interview session started');
    } catch (err) {
      const msg = err.response?.data?.detail || 'Failed to start session';
      toast.error(msg);
    }
  };

  const endSession = async () => {
    if (ending) return;
    setEnding(true);
    clearInterval(timerRef.current);
    try {
      await API.post('/interviews/end', { candidate_id: candidateId });
      toast.success('Interview ended. Generating AI analysis...');
      navigate(`/candidates/${candidateId}`);
    } catch {
      toast.error('Failed to end session gracefully');
    } finally {
      setEnding(false);
    }
  };

  if (loading) return (
    <div className="layout">
      <Sidebar />
      <div className="main-content">
        <Navbar title="Interview Room" />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 400 }}>
          <div className="spinner" />
        </div>
      </div>
    </div>
  );

  if (!candidate) return (
    <div className="layout"><Sidebar /><div className="main-content"><Navbar title="Interview Room" />
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Candidate not found.</div>
    </div></div>
  );

  const interview = candidate.interview || {};

  // Pre-session screen
  if (!sessionStarted) {
    return (
      <div className="layout">
        <Sidebar />
        <div className="main-content">
          <Navbar title="Interview Room" />
          <div className="page-body animate-fade">
            <div style={{ maxWidth: 640, margin: '40px auto' }}>
              {/* Header card */}
              <div style={{
                background: 'linear-gradient(135deg, #1e293b, #0f172a)',
                borderRadius: 16, padding: 32, color: '#fff', marginBottom: 20,
                border: '1px solid #334155',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <MdVideocam size={26} style={{ color: '#818cf8' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>Interview Room</div>
                    <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>Secure Proctored Session</div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
                  {[
                    ['Candidate', candidate.name],
                    ['Role', candidate.job_title || 'Scheduled Role'],
                    ['Date', interview.date],
                    ['Time', interview.time],
                    ['Duration', `${interview.duration || 30} min`],
                    ['Mode', 'Online · Proctored'],
                  ].map(([k, v]) => (
                    <div key={k} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: '10px 14px' }}>
                      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{k}</div>
                      <div style={{ fontSize: 14, color: '#e2e8f0', marginTop: 2, fontWeight: 500 }}>{v || '—'}</div>
                    </div>
                  ))}
                </div>

                {/* Security notice */}
                <div style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10, padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <MdShield size={16} style={{ color: '#818cf8' }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#a5b4fc' }}>Enterprise Security Active</span>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#94a3b8', lineHeight: 1.8 }}>
                    <li>Full-screen enforcement with violation tracking</li>
                    <li>Tab-switch and focus-loss monitoring</li>
                    <li>Webcam behavioral analysis</li>
                    <li>JWT-secured video session (recruiter-only host)</li>
                    <li>Real-time integrity score computed live</li>
                  </ul>
                </div>
              </div>

              <button onClick={startSession} style={{
                width: '100%', padding: '14px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                border: 'none', borderRadius: 12, color: '#fff', fontSize: 15, fontWeight: 600,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                boxShadow: '0 4px 20px rgba(99,102,241,0.4)',
              }}>
                <MdVideocam size={20} /> Launch Secure Interview Session
              </button>
              <button onClick={() => navigate(`/candidates/${candidateId}`)} style={{
                width: '100%', padding: '12px', background: 'transparent', border: '1px solid #e2e8f0',
                borderRadius: 12, color: 'var(--text-secondary)', fontSize: 14, fontWeight: 500,
                cursor: 'pointer', marginTop: 10,
              }}>
                Back to Candidate Profile
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Live interview room
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#F7F8FA', overflow: 'hidden', fontFamily: 'Inter, sans-serif' }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      <ViolationBanner violations={violations} />
      
      {/* Top Header */}
      <header style={{
        height: '60px',
        background: '#ffffff',
        borderBottom: '1px solid #E5E7EB',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        zIndex: 100,
        boxShadow: '0 1px 2px 0 rgba(0,0,0,0.02)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-outline btn-sm" onClick={endSession} style={{ color: 'var(--danger)', borderColor: '#FEE2E2', background: '#FFF' }}>
            ← Exit Room
          </button>
          <div style={{ height: '20px', width: '1px', background: '#E5E7EB' }} />
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827', display: 'flex', alignItems: 'center', gap: 8 }}>
              {candidate.name}
              <span style={{ fontSize: '11px', fontWeight: 500, color: '#6B7280' }}>
                · {candidate.job_title || 'Scheduled Role'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <span className="badge badge-interview" style={{ padding: '1px 6px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase' }}>
                LIVE MONITORING
              </span>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#EF4444', animation: 'pulse 1.5s infinite' }} />
              <span style={{ fontSize: '10px', color: '#EF4444', fontWeight: 600, letterSpacing: '0.3px' }}>RECORDING</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F3F4F6', padding: '6px 12px', borderRadius: '4px', border: '1px solid #E5E7EB' }}>
            <MdTimer size={16} style={{ color: '#4B5563' }} />
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#111827', fontVariantNumeric: 'tabular-nums' }}>
              {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}
            </span>
          </div>
          <button className="btn btn-danger" onClick={endSession} style={{ padding: '8px 16px', fontWeight: 600 }}>
            <MdStop size={16} /> End Interview & Analyze
          </button>
        </div>
      </header>

      {/* Main Split Layout */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* LEFT PANEL: Candidate Video & Transcript */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid #E5E7EB', background: '#F9FAFB' }}>
          {/* LiveKit Video Area */}
          <div style={{ height: '55%', position: 'relative', background: '#000', borderBottom: '1px solid #E5E7EB' }}>
            {(!livekitToken || !livekitUrl) ? (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
                <div style={{ textAlign: 'center', color: '#9CA3AF' }}>
                  <div style={{ border: '3px solid rgba(99, 102, 241, 0.1)', borderTop: '3px solid #6366f1', borderRadius: '50%', width: 32, height: 32, animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
                  <div style={{ fontSize: '13px' }}>Connecting to secure video stream...</div>
                </div>
              </div>
            ) : (
              <div style={{ width: '100%', height: '100%' }}>
                <LiveKitRoom
                  video={true}
                  audio={true}
                  token={livekitToken}
                  serverUrl={livekitUrl}
                  connectOptions={{ autoSubscribe: true }}
                  onDisconnected={() => {
                    toast.success('Disconnected from interview session.');
                  }}
                  style={{ height: '100%', width: '100%' }}
                >
                  <CustomInterviewCall
                    onLeave={endSession}
                    candidateName={candidate.name}
                    recruiterName={user?.name || 'Interviewer'}
                  />
                  <RoomAudioRenderer />
                  <LiveKitEventsHandler candidateId={candidateId} />
                </LiveKitRoom>
              </div>
            )}
          </div>

          {/* Transcript Area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#ffffff', overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid #E5E7EB', background: '#F9FAFB', display: 'flex', justifyContext: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Live Transcript Stream
              </div>
              <span className="badge" style={{ background: '#E0E7FF', color: '#4F46E5', fontSize: '9px' }}>
                Whisper AI Active
              </span>
            </div>
            <div style={{ flex: 1, padding: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {liveData?.transcript?.length > 0 ? (
                liveData.transcript.map((line, idx) => {
                  const isObj = typeof line === 'object' && line !== null;
                  const text = isObj ? line.text : line;
                  const speaker = isObj ? (line.speaker || 'Candidate') : 'Candidate';
                  const timestamp = isObj ? (line.timestamp || '') : '';
                  const confidence = isObj ? (line.confidence || 1.0) : 1.0;
                  const isInterviewer = speaker === 'Interviewer';

                  return (
                    <div key={idx} style={{ 
                      display: 'flex', 
                      gap: 10, 
                      alignItems: 'flex-start', 
                      maxWidth: '85%',
                      alignSelf: isInterviewer ? 'flex-end' : 'flex-start',
                      flexDirection: isInterviewer ? 'row-reverse' : 'row'
                    }}>
                      <div style={{ 
                        width: '28px', 
                        height: '28px', 
                        borderRadius: '50%', 
                        background: isInterviewer ? '#A7F3D0' : '#E0E7FF', 
                        color: isInterviewer ? '#065F46' : '#4F46E5', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        fontSize: '10px', 
                        fontWeight: 700, 
                        flexShrink: 0 
                      }}>
                        {speaker[0]}
                      </div>
                      <div style={{ 
                        background: isInterviewer ? '#ECFDF5' : '#F3F4F6', 
                        padding: '10px 14px', 
                        borderRadius: isInterviewer ? '12px 0 12px 12px' : '0 12px 12px 12px', 
                        border: `1px solid ${isInterviewer ? '#A7F3D0' : '#E5E7EB'}` 
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 4, fontSize: '10px', color: '#6B7280', fontWeight: 500 }}>
                          <span style={{ fontWeight: 600, color: isInterviewer ? '#065F46' : '#4F46E5' }}>
                            {speaker} {timestamp && `[${timestamp}]`}
                          </span>
                          {isObj && <span>Conf: {Math.round(confidence * 100)}%</span>}
                        </div>
                        <div style={{ fontSize: '12px', color: '#111827', lineHeight: 1.5 }}>
                          {text}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 8, color: '#9CA3AF' }}>
                  <div className="spinner" style={{ borderTopColor: 'var(--text-muted)' }} />
                  <div style={{ fontSize: '12px' }}>Waiting for speech detection... Speak into the mic to stream transcripts.</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: Integrity & Behavioral Analytics */}
        <div style={{ width: '360px', background: '#ffffff', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          {/* Integrity Score header */}
          <div style={{ padding: '20px', borderBottom: '1px solid #E5E7EB' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
              Proctoring & Integrity
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: '32px', fontWeight: 700, color: (liveData?.integrity_score ?? 100) > 75 ? 'var(--success)' : (liveData?.integrity_score ?? 100) > 50 ? 'var(--warning-dark)' : 'var(--danger)', lineHeight: 1 }}>
                  {liveData?.integrity_score ?? 100}%
                </div>
                <div style={{ fontSize: '11px', color: '#6B7280', marginTop: 4 }}>
                  Integrity Rating
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className="badge" style={{
                  background: liveData?.risk_level === 'high' ? 'var(--danger-light)' : liveData?.risk_level === 'medium' ? 'var(--warning-light)' : 'var(--success-light)',
                  color: liveData?.risk_level === 'high' ? 'var(--danger-dark)' : liveData?.risk_level === 'medium' ? 'var(--warning-dark)' : 'var(--success-dark)',
                  textTransform: 'uppercase',
                  fontWeight: 700
                }}>
                  {liveData?.risk_level?.toUpperCase() ?? 'LOW'} RISK
                </span>
                <div style={{ fontSize: '11px', color: '#6B7280', marginTop: 4 }}>
                  Risk Assessment
                </div>
              </div>
            </div>
          </div>
                      {/* Live Speaking Ratio */}
          <div style={{ padding: '20px', borderBottom: '1px solid #E5E7EB' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
              Live Speaking Ratio
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#374151', marginBottom: 6, fontWeight: 500 }}>
                <span>Candidate: {liveData?.speaking_ratio?.candidate ?? 50}%</span>
                <span>Interviewer: {liveData?.speaking_ratio?.interviewer ?? 50}%</span>
              </div>
              <div style={{ height: '8px', background: '#E5E7EB', borderRadius: '4px', overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: `${liveData?.speaking_ratio?.candidate ?? 50}%`, background: '#4F46E5', transition: 'width 0.5s ease' }} />
                <div style={{ width: `${liveData?.speaking_ratio?.interviewer ?? 50}%`, background: '#10B981', transition: 'width 0.5s ease' }} />
              </div>
            </div>
          </div>

          {/* Feed & Silence Status */}
          <div style={{ padding: '20px', borderBottom: '1px solid #E5E7EB' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
              Live Feed & Mic Status
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ border: '1px solid #E5E7EB', padding: '10px', borderRadius: '6px', textAlign: 'center', background: '#F9FAFB' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: liveData?.webcam_status === 'Active' ? '#059669' : '#DC2626' }}>
                  {liveData?.webcam_status ?? 'No Feed'}
                </div>
                <div style={{ fontSize: '10px', color: '#6B7280', marginTop: 4 }}>Webcam Feed</div>
              </div>
              <div style={{ border: '1px solid #E5E7EB', padding: '10px', borderRadius: '6px', textAlign: 'center', background: '#F9FAFB' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: liveData?.silence_detected ? '#D97706' : '#059669' }}>
                  {liveData?.silence_detected ? 'Silence Alert' : 'Active Speech'}
                </div>
                <div style={{ fontSize: '10px', color: '#6B7280', marginTop: 4 }}>Silence Detection</div>
              </div>
            </div>
          </div>

          {/* Proctoring Counters */}
          <div style={{ padding: '20px', borderBottom: '1px solid #E5E7EB' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
              Integrity Violation Counters
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ border: '1px solid #E5E7EB', padding: '10px', borderRadius: '4px', textAlign: 'center' }}>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#111827' }}>
                  {counts?.looking_away ?? 0}
                </div>
                <div style={{ fontSize: '10px', color: '#6B7280', marginTop: 2 }}>Looking Away</div>
              </div>
              <div style={{ border: '1px solid #E5E7EB', padding: '10px', borderRadius: '4px', textAlign: 'center' }}>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#111827' }}>
                  {counts?.tab_switch ?? 0}
                </div>
                <div style={{ fontSize: '10px', color: '#6B7280', marginTop: 2 }}>Tab Switches</div>
              </div>
              <div style={{ border: '1px solid #E5E7EB', padding: '10px', borderRadius: '4px', textAlign: 'center' }}>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#111827' }}>
                  {counts?.copy_paste ?? 0}
                </div>
                <div style={{ fontSize: '10px', color: '#6B7280', marginTop: 2 }}>Copy/Pastes</div>
              </div>
              <div style={{ border: '1px solid #E5E7EB', padding: '10px', borderRadius: '4px', textAlign: 'center' }}>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#111827' }}>
                  {counts?.multiple_faces ?? 0}
                </div>
                <div style={{ fontSize: '10px', color: '#6B7280', marginTop: 2 }}>Multiple People</div>
              </div>
            </div>
          </div>

          {/* Behavior Timeline */}
          <div style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
              Behavior Violation Log
            </div>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {violations?.length > 0 ? (
                violations.map((v, i) => (
                  <div key={i} style={{
                    padding: '8px 12px',
                    borderRadius: '4px',
                    fontSize: '11.5px',
                    background: v.severity === 'high' ? 'var(--danger-light)' : 'var(--warning-light)',
                    border: `1px solid ${v.severity === 'high' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)'}`,
                    color: v.severity === 'high' ? 'var(--danger-dark)' : 'var(--warning-dark)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                      <span style={{ textTransform: 'capitalize' }}>{v.violation_type?.replace('_', ' ') || v.type}</span>
                      <span style={{ fontSize: '10px', opacity: 0.8 }}>{formatTimestamp(v.timestamp)}</span>
                    </div>
                    {v.details && <div style={{ fontSize: '10.5px', opacity: 0.9 }}>{v.details}</div>}
                  </div>
                ))
              ) : (
                <div style={{ textAlign: 'center', padding: '30px 10px', color: '#9CA3AF', fontSize: '12px' }}>
                  No integrity threats detected. Candidate behavior is normal.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
