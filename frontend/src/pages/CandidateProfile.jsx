import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import InterviewModal from '../components/InterviewModal';
import ProfileDonut from '../components/ProfileDonut';
import InterviewInsightCard from '../components/InterviewInsightCard';
import API from '../api/client';
import toast from 'react-hot-toast';
import './CandidateProfile.css';

const ss = v => Math.min(100, Math.max(0, Math.round(Number(v) || 0)));
const col = s => s >= 80 ? '#10b981' : s >= 60 ? '#6366f1' : s >= 40 ? '#f59e0b' : '#ef4444';
const verdictClass = r => r?.toLowerCase().includes('strong') ? '' : r?.toLowerCase().includes('hire') ? '' : r?.toLowerCase().includes('hold') ? 'hold' : 'reject';
const verdictColor = r => r?.toLowerCase().includes('hire') ? '#16a34a' : r?.toLowerCase().includes('hold') ? '#d97706' : '#dc2626';

const Bar = ({ label, value, color }) => (
  <div className="cp-bar-row">
    <span className="cp-bar-label">{label}</span>
    <div className="cp-bar-track"><div className="cp-bar-fill" style={{ width: `${ss(value)}%`, background: color || col(ss(value)) }} /></div>
    <span className="cp-bar-pct">{ss(value)}%</span>
  </div>
);

const Chip = ({ label, variant = 'gray' }) => <span className={`cp-skill-chip chip-${variant}`}>{label}</span>;

export default function CandidateProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [c, setC] = useState(null);
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('Overview');
  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [showInterview, setShowInterview] = useState(false);
  const [reranking, setReranking] = useState(false);

  const load = async () => {
    try {
      const r = await API.get(`/candidates/${id}`);
      setC(r.data);
      if (r.data?.job_id) { const jr = await API.get(`/jobs/${r.data.job_id}`); setJob(jr.data); }
    } catch { toast.error('Candidate not found'); navigate('/candidates'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [id]);

  const updateStatus = async st => { await API.put(`/candidates/${id}/status`, { status: st }); toast.success(`Stage: ${st}`); load(); };
  const addNote = async e => {
    e.preventDefault(); if (!note.trim()) return; setSavingNote(true);
    try { await API.post(`/candidates/${id}/notes`, { text: note }); toast.success('Note saved'); setNote(''); load(); }
    catch { toast.error('Failed'); } finally { setSavingNote(false); }
  };

  if (loading) return <div className="layout"><Sidebar /><div className="main-content flex-center"><div className="spinner" /></div></div>;
  if (!c) return null;

  const overall = ss(c.ai_match_score ?? c.score);
  const hs = c.hiring_summary || {};
  const bd = c.score_breakdown || {};
  
  // Employment timeline — filter out bogus entries
  const tl = (Array.isArray(c.employment_timeline) ? c.employment_timeline : [])
    .filter(j => j && (j.company || j.title) && typeof j === 'object');
    
  // Skills — merge all possible field names
  const candidateTechSkills = [...new Set([
    ...(c.technical_skills || []), ...(c.skills || []),
    ...(c.matched_skills || []), ...(c.extracted_skills || [])
  ])].filter(Boolean);
  const candidateSoftSkills = c.soft_skills || [];
  const candidateAllSkills  = [...new Set([...candidateTechSkills, ...candidateSoftSkills])];
  
  // JD required/preferred skills
  const jdRequired  = c.jd_required_skills  || job?.required_skills  || job?.skills || [];
  const jdPreferred = c.jd_preferred_skills || job?.preferred_skills || [];
  
  // Matches — use stored OR compute on the fly
  const exact   = c.exact_matches?.length   ? c.exact_matches   : jdRequired.filter(s => candidateAllSkills.some(cs => cs.toLowerCase() === s.toLowerCase()));
  const sem     = c.semantic_matches?.length ? c.semantic_matches : [];
  const partial = c.partial_matches?.length  ? c.partial_matches  : [];
  const missing = c.missing_skills?.length   ? c.missing_skills   : jdRequired.filter(s => !candidateAllSkills.some(cs => cs.toLowerCase() === s.toLowerCase()));
  const bonus   = c.bonus_skills?.length     ? c.bonus_skills     : jdPreferred.filter(s => candidateAllSkills.some(cs => cs.toLowerCase() === s.toLowerCase()));
  const certs   = c.certifications || [];

  // Deduped and consolidated matched and missing lists
  const matchedSkillsCombined = [...new Set([...exact, ...sem, ...partial].filter(Boolean))];
  const matchedSkillsLower = new Set(matchedSkillsCombined.map(s => s.toLowerCase()));
  const uniqueMissing = missing.filter(s => s && !matchedSkillsLower.has(s.toLowerCase()));
  const tabs    = ['Overview','Resume','AI Match Analysis','Skills','Experience','Projects','Education','Interviews','Activity','Notes & Feedback'];
  const rec     = hs.recommendation || c.ai_verdict || 'Hold';
  const expYrs  = c.total_experience_years || c.experience_years || c.experience || 0;

  // Build the shareable candidate join URL.
  // Priority: backend-generated candidate_join_url (uses FRONTEND_URL env var)
  //           → VITE_FRONTEND_URL (set in frontend/.env for tunnels/production)
  //           → window.location.origin (last resort, works only locally)
  const getCandidateJoinUrl = (token) => {
    const backendUrl = c?.interview?.candidate_join_url;
    if (backendUrl) return backendUrl;
    let base = import.meta.env.VITE_FRONTEND_URL || window.location.origin;
    if (base.endsWith('/')) base = base.slice(0, -1);
    return `${base}/candidate-interview/${token}`;
  };
  
  // Education — handle structured + legacy string formats
  const eduArr  = (c.education_structured?.length && typeof c.education_structured[0] === 'object')
    ? c.education_structured.filter(e => e && e.degree && String(e.degree).trim())
    : (c.education || []).map(e => {
        if (typeof e === 'object') return e;
        const s = String(e); const low = s.toLowerCase();
        const deg = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
        return { degree: deg, institution: '', year: '', field: '' };
      }).filter(e => e.degree && e.degree.length > 2);
      
  // Projects — filter out junk single-word / name entries
  const rawProj = c.projects_structured?.length ? c.projects_structured : (c.projects || []).map(p => ({ name: typeof p === 'object' ? p.name||'' : p, description: typeof p === 'object' ? p.description||'' : '', technologies: typeof p === 'object' ? p.technologies||[] : [] }));
  const projArr = rawProj.filter(p => { const n = p.name||''; return n.length > 5 && !/^[A-Z\s\.]+$/.test(n) || (p.description && p.description.length > 10); });
  
  // ── Interview join window helpers ──────────────────────────────────────
  const getInterviewJoinStatus = () => {
    if (!c.interview?.date || !c.interview?.time) return { canJoin: false, expired: false, label: '' };
    try {
      const scheduledDt = new Date(`${c.interview.date}T${c.interview.time}:00`);
      const now = new Date();
      const diffMs = now - scheduledDt; // positive = past scheduled time
      const fifteenMin = 15 * 60 * 1000;
      if (diffMs > fifteenMin) return { canJoin: false, expired: true, label: 'Session window expired (15 min past scheduled time)' };
      if (diffMs < -fifteenMin) return { canJoin: false, expired: false, label: `Starts at ${c.interview.time}` };
      return { canJoin: true, expired: false, label: '' };
    } catch { return { canJoin: false, expired: false, label: '' }; }
  };

  // Derive the correct interview display status from candidate status
  const getInterviewDisplayStatus = () => {
    const st = c.status || '';
    if (st === 'interview_completed' || st === 'interview_analyzed' || st === 'interview_analyzing') return 'completed';
    if (st === 'interview_incomplete') return 'incomplete';
    if (st === 'interview_live') return 'live';
    if (c.interview?.status) return c.interview.status;
    return 'scheduled';
  };

  const rerank = async () => {
    setReranking(true);
    try { const r = await API.post(`/candidates/rerank/${id}`); setC(r.data); toast.success(' AI re-analysis complete!'); }
    catch (e) { toast.error(e?.response?.data?.detail || 'Re-analysis failed'); }
    finally { setReranking(false); }
  };

  return (
    <div className="layout"><Sidebar />
    <div className="cp-wrap">

      {/* ── HEADER ── */}
      <div className="cp-header">
        <button className="cp-back-btn" onClick={() => navigate(-1)} title="Back to Candidates">
          ← Back
        </button>
        <div className="cp-avatar" style={{ background: `conic-gradient(${col(overall)} ${overall*3.6}deg, #e2e8f0 0deg)`, padding: 3 }}>
          <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 800, color: '#fff' }}>
            {(c.name || 'C').charAt(0).toUpperCase()}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
            <h1 className="cp-name">{c.name}</h1>
            <span className="badge" style={{ background: '#dbeafe', color: '#1d4ed8', borderRadius: 20, padding: '3px 12px', fontSize: 11, fontWeight: 800 }}>{(c.status || 'Applied').replace('_',' ').toUpperCase()}</span>
          </div>
          <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 2 }}>Applied for <b style={{ color: '#4f46e5' }}>{job?.title || c.job_title || 'Position'}</b>{c.location && <> &bull; {c.location}</>}</div>
          <div className="cp-meta">
            {c.email && <span>✉️ {c.email}</span>}
            {c.phone && <span>📞 {c.phone}</span>}
            {c.linkedin_url && <a href={c.linkedin_url} target="_blank" rel="noreferrer">🔗 LinkedIn</a>}
            {c.github_url && <a href={c.github_url} target="_blank" rel="noreferrer">🐈 GitHub</a>}
            {c.uploaded_at && <span>Applied: {new Date(c.uploaded_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}</span>}
          </div>
        </div>
        {/* Score ring */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 80, height: 80, borderRadius: '50%', background: `conic-gradient(${col(overall)} ${overall*3.6}deg, #f1f5f9 0deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 0 4px ${col(overall)}20` }}>
            <div style={{ width: 62, height: 62, borderRadius: '50%', background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 18, fontWeight: 900, color: col(overall), lineHeight: 1 }}>{overall}%</span>
              <span style={{ fontSize: 8.5, color: '#64748b', fontWeight: 600 }}>AI Score</span>
            </div>
          </div>
        </div>
        {/* AI Recommendation box */}
        <div className={`cp-rec-box ${verdictClass(rec)}`}>
          <div className="cp-rec-label">👍 AI Recommendation</div>
          <div className="cp-rec-verdict" style={{ color: verdictColor(rec), fontSize: 15 }}>{rec.toUpperCase()}</div>
          <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 4 }}>AI Confidence: <b>{hs.recommendation_confidence || 'Medium'}</b></div>
          <div style={{ fontSize: 9.5, color: '#94a3b8', marginTop: 2 }}>Last updated: just now ↺</div>
        </div>
      </div>

      {/* ── TABS ── */}
      <div className="cp-tabs">
        {tabs.map(t => <div key={t} className={`cp-tab${tab===t?' active':''}`} onClick={() => setTab(t)}>{t}</div>)}
      </div>

      {/* ── BODY ── */}
      <div className="cp-body">

        <div className="cp-stats">
          <div className="cp-stat"><div className="cp-stat-label">AI Match Score</div><div className="cp-stat-val" style={{color:col(overall)}}>{overall}%</div><div className="cp-stat-sub">{overall>=80?'Excellent':overall>=60?'Good':overall>=40?'Moderate':'Low'} Match</div></div>
          <div className="cp-stat"><div className="cp-stat-label">Experience</div><div className="cp-stat-val">{expYrs}<span style={{fontSize:13}}> Yrs</span></div><div className="cp-stat-sub">Total Experience</div></div>
          <div className="cp-stat"><div className="cp-stat-label">Current Stage</div><div className="cp-stat-val" style={{fontSize:13,color:'#4f46e5'}}>{(c.status||'Applied').replace(/_/g,' ')}</div><div className="cp-stat-sub">Pipeline stage</div></div>
          <div className="cp-stat"><div className="cp-stat-label">Skills Matched</div><div className="cp-stat-val" style={{color:col(ss(c.skill_score))}}>{matchedSkillsCombined.length}</div><div className="cp-stat-sub">of {jdRequired.length||(matchedSkillsCombined.length+uniqueMissing.length)} required</div></div>
          <div className="cp-stat"><div className="cp-stat-label">Missing Skills</div><div className="cp-stat-val" style={{color:uniqueMissing.length>0?'#ef4444':'#10b981'}}>{uniqueMissing.length}</div><div className="cp-stat-sub">{uniqueMissing.length===0?'All covered':'Gaps found'}</div></div>
          <div className="cp-stat" style={{cursor:'pointer',background:reranking?'#f0f9ff':'#fff'}} onClick={rerank}>
            <div className="cp-stat-label"> Re-Analyze</div>
            <div className="cp-stat-val" style={{fontSize:13,color:'#6366f1'}}>{reranking?'Running...':'AI Parse'}</div>
            <div className="cp-stat-sub">Click to re-run LLM</div>
          </div>
        </div>

        {tab === 'Overview' && <>
          {/* ── 3-COL MAIN GRID ── */}
          <div className="cp-grid3">

            {/* LEFT: AI Summary + Weaknesses + Risks */}
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div className="cp-card">
                <div className="cp-card-title">🧠 AI Candidate Summary</div>
                <p style={{fontSize:12.5,color:'#475569',lineHeight:1.7,margin:0}}>{hs.narrative || hs.executive_summary || 'AI evaluation completed. Review score breakdown for detailed analysis.'}</p>
                <div style={{marginTop:12,padding:'10px 14px',borderRadius:8,border:'1px solid #bbf7d0',background:'#f0fdf4'}}>
                  <div style={{fontSize:10,fontWeight:800,color:'#64748b',textTransform:'uppercase',marginBottom:4}}>Overall Recommendation</div>
                  <div style={{fontWeight:700,fontSize:13,color:verdictColor(rec)}}>{rec}</div>
                </div>
                <div style={{marginTop:10,display:'flex',gap:8,flexWrap:'wrap'}}>
                  {[['Onboarding',hs.onboarding_complexity],['Productivity',hs.time_to_productivity],['Level',hs.salary_range_fit]].filter(x=>x[1]).map(([k,v])=>(
                    <div key={k} style={{fontSize:11,padding:'3px 10px',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:6}}><span style={{color:'#94a3b8',fontWeight:600}}>{k}: </span><b style={{color:'#1e293b'}}>{v}</b></div>
                  ))}
                </div>
              </div>

              <div className="cp-card" style={{borderLeft:'3px solid #ef4444'}}>
                <div className="cp-card-title" style={{color:'#dc2626'}}>AI Weaknesses / Gaps</div>
                {(hs.weaknesses?.length ? hs.weaknesses : ['No critical gaps identified.']).map((w,i)=>(
                  <div key={i} className="cp-strength-item"><span style={{color:'#f59e0b',fontSize:14,flexShrink:0}}>△</span><span>{w}</span></div>
                ))}
              </div>

              <div className="cp-card" style={{borderLeft:'3px solid #f59e0b'}}>
                <div className="cp-card-title" style={{color:'#92400e'}}>🚨 Hiring Risks</div>
                {(hs.risks?.length ? hs.risks : ['No critical risks flagged.']).map((r,i)=>(
                  <div key={i} className="cp-strength-item"><span style={{color:'#ef4444',fontSize:14,flexShrink:0}}>🚩</span><span>{r}</span></div>
                ))}
              </div>

              <div className="cp-card">
                <div className="cp-card-title"> Interview Readiness</div>
                <div style={{fontSize:20,fontWeight:900,color:overall>=70?'#16a34a':overall>=50?'#d97706':'#dc2626',marginBottom:4}}>{overall>=70?'HIGH':overall>=50?'MEDIUM':'LOW'}</div>
                <div style={{fontSize:11.5,color:'#64748b',marginBottom:10}}>AI Confidence: {hs.recommendation_confidence||'Medium'}</div>
                {hs.interview_focus_areas?.length > 0 && <>
                  <div style={{fontSize:10,fontWeight:800,color:'#64748b',textTransform:'uppercase',marginBottom:6}}>Suggested Focus Areas</div>
                  {hs.interview_focus_areas.slice(0,4).map((a,i)=><div key={i} style={{fontSize:12,color:'#334155',marginBottom:4,display:'flex',gap:6}}><span style={{color:'#6366f1'}}>▶</span>{a}</div>)}
                </>}
              </div>
            </div>

            {/* CENTER: Score Breakdown + Skills Analysis + Opportunities */}
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div className="cp-card">
                <div className="cp-card-title">Match Score Breakdown</div>
                <ProfileDonut score={overall} breakdown={bd} />
                <div style={{marginTop:16,display:'flex',flexDirection:'column',gap:0}}>
                  <Bar label="Skills Match" value={c.skill_score} color="#6366f1" />
                  <Bar label="Experience Match" value={c.experience_score} color="#10b981" />
                  <Bar label="Semantic Similarity" value={c.semantic_score} color="#f59e0b" />
                  <Bar label="Resume Quality" value={c.resume_quality||bd.quality_score} color="#ef4444" />
                  <Bar label="Certifications" value={c.certification_score||bd.cert_score} color="#8b5cf6" />
                </div>
              </div>

              <div className="cp-card">
                <div className="cp-card-title">Skills Analysis</div>
                {[
                  matchedSkillsCombined.length > 0 && <div key="m" style={{marginBottom:10}}><div style={{fontSize:10,fontWeight:800,color:'#16a34a',textTransform:'uppercase',marginBottom:6}}>Matched Skills ({matchedSkillsCombined.length})</div><div>{matchedSkillsCombined.map(s=><Chip key={s} label={s} variant="green"/>)}</div></div>,
                  uniqueMissing.length > 0 && <div key="ms" style={{marginBottom:10}}><div style={{fontSize:10,fontWeight:800,color:'#dc2626',textTransform:'uppercase',marginBottom:6}}> Missing Required ({uniqueMissing.length})</div><div>{uniqueMissing.map(s=><Chip key={s} label={s} variant="red"/>)}</div></div>,
                  bonus.length > 0 && <div key="b"><div style={{fontSize:10,fontWeight:800,color:'#0891b2',textTransform:'uppercase',marginBottom:6}}>💎 Bonus Skills ({bonus.length})</div><div>{bonus.map(s=><Chip key={s} label={s} variant="blue"/>)}</div></div>
                ]}
              </div>

              <div className="cp-card" style={{borderLeft:'3px solid #6366f1'}}>
                <div className="cp-card-title" style={{color:'#4f46e5'}}> Growth Opportunities</div>
                {(hs.opportunities?.length ? hs.opportunities : ['Assess candidate for potential growth in this role.']).map((o,i)=>(
                  <div key={i} className="cp-strength-item"><span style={{color:'#6366f1',fontSize:14,flexShrink:0}}>★</span><span>{o}</span></div>
                ))}
              </div>
            </div>

            {/* RIGHT: Strengths + Risk Assessment + Contact info */}
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div className="cp-card" style={{borderLeft:'3px solid #10b981'}}>
                <div className="cp-card-title" style={{color:'#16a34a'}}>AI Strengths</div>
                {(hs.strengths?.length ? hs.strengths : ['Core requirements matched.']).map((s,i)=>(
                  <div key={i} className="cp-strength-item"><span style={{color:'#10b981',fontSize:14,flexShrink:0}}></span><span>{s}</span></div>
                ))}
              </div>

              <div className="cp-card">
                <div className="cp-card-title">Risk Assessment</div>
                {(() => { const r = overall>=75?'LOW':overall>=50?'MEDIUM':'HIGH'; const rc = r==='LOW'?'low':r==='MEDIUM'?'med':'high'; return (<>
                  <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
                    <span style={{fontSize:11,fontWeight:700,color:'#64748b'}}>Overall Hiring Risk</span>
                    <span className={`cp-risk-pill risk-${rc}`}>{r}</span>
                  </div>
                  {hs.hiring_green_flags?.length > 0 && <><div style={{fontSize:10,fontWeight:800,color:'#16a34a',textTransform:'uppercase',marginBottom:4}}>Positive Signals</div>{hs.hiring_green_flags.slice(0,3).map((f,i)=><div key={i} style={{fontSize:11.5,color:'#334155',marginBottom:3,display:'flex',gap:6}}><span style={{color:'#10b981'}}>●</span>{f}</div>)}</>}
                  {hs.hiring_red_flags?.length > 0 && <><div style={{fontSize:10,fontWeight:800,color:'#dc2626',textTransform:'uppercase',marginBottom:4,marginTop:8}}>Potential Risks</div>{hs.hiring_red_flags.slice(0,3).map((f,i)=><div key={i} style={{fontSize:11.5,color:'#334155',marginBottom:3,display:'flex',gap:6}}><span style={{color:'#f59e0b'}}>●</span>{f}</div>)}</>}
                </>); })()}
              </div>

              <div className="cp-card">
                <div className="cp-card-title"> Contact & Basic Info</div>
                {[['✉️','Email',c.email],['📞','Phone',c.phone],['📍','Location',c.location],['','Current Title',c.current_title],['🎓','Experience',expYrs+' Years']].filter(x=>x[2]).map(([icon,label,val])=>(
                  <div key={label} style={{display:'flex',gap:8,alignItems:'flex-start',marginBottom:7,fontSize:12.5,color:'#334155'}}>
                    <span style={{flexShrink:0,width:18}}>{icon}</span>
                    <span style={{color:'#94a3b8',width:90,flexShrink:0,fontSize:11}}>{label}</span>
                    <span style={{fontWeight:600,wordBreak:'break-word'}}>{val}</span>
                  </div>
                ))}
                {(c.github_url||c.linkedin_url||c.portfolio_url) && <div style={{marginTop:8,paddingTop:8,borderTop:'1px solid #f1f5f9',display:'flex',gap:8,flexWrap:'wrap'}}>
                  {c.github_url && <a href={c.github_url} target="_blank" rel="noreferrer" style={{fontSize:11,color:'#4f46e5',fontWeight:700,textDecoration:'none'}}>🐈 GitHub</a>}
                  {c.linkedin_url && <a href={c.linkedin_url} target="_blank" rel="noreferrer" style={{fontSize:11,color:'#0077b5',fontWeight:700,textDecoration:'none'}}> LinkedIn</a>}
                  {c.portfolio_url && <a href={c.portfolio_url} target="_blank" rel="noreferrer" style={{fontSize:11,color:'#10b981',fontWeight:700,textDecoration:'none'}}>🌐 Portfolio</a>}
                </div>}
              </div>

              <div className="cp-card">
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                  <span style={{fontSize:11,fontWeight:800,color:'#64748b',textTransform:'uppercase',letterSpacing:'.5px'}}>Update Stage</span>
                </div>
                <select value={c.status||'applied'} onChange={e=>updateStatus(e.target.value)} style={{width:'100%',padding:'8px 10px',border:'1px solid #e2e8f0',borderRadius:8,fontSize:12.5,fontWeight:600,color:'#334155',background:'#f8fafc',cursor:'pointer'}}>
                  {['applied','screening','shortlisted','interview_scheduled','interview_completed','interview_analyzing','interview_analyzed','interview_incomplete','offered','hired','rejected'].map(s=><option key={s} value={s}>{s.replace('_',' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>)}
                </select>
                <button className="cp-footer-btn primary" style={{width:'100%',marginTop:8,justifyContent:'center'}} onClick={()=>setShowInterview(true)}>Schedule Interview</button>
              </div>
            </div>
          </div>

          {/* ── CAREER PROGRESSION TIMELINE ── */}
          {tl.length > 0 && <div className="cp-card">
            <div className="cp-card-title">📈 Career Progression Timeline</div>
            <div className="cp-timeline-h">
              {tl.map((job,i)=>(
                <div key={i} className="cp-tl-item">
                  <div className="cp-tl-dot" style={{background:i===0?'#6366f1':'#94a3b8',boxShadow:i===0?'0 0 0 3px #6366f130':undefined}} />
                  <div className="cp-tl-title">{job.title}</div>
                  <div className="cp-tl-company">{job.company}</div>
                  <div className="cp-tl-date">{job.start_date} – {job.end_date||'Present'}</div>
                  {job.duration_months>0 && <div className="cp-tl-dur">({Math.round(job.duration_months/12*10)/10} yrs)</div>}
                  {job.is_internship && <span className="cp-skill-chip chip-blue" style={{marginTop:4,fontSize:9}}>INTERN</span>}
                  {job.is_freelance && <span className="cp-skill-chip chip-green" style={{marginTop:4,fontSize:9}}>FREELANCE</span>}
                </div>
              ))}
            </div>
          </div>}

          {/* ── BOTTOM ROW ── */}
          <div className="cp-bottom">
            {/* Activity Timeline */}
            <div className="cp-card">
              <div className="cp-card-title">🕒 Activity Timeline</div>
              {(c.notes||[]).slice(0,5).map((n,i)=>(
                <div key={i} className="cp-activity-item">
                  <div className="cp-activity-dot" />
                  <div><div style={{fontSize:12,color:'#334155',fontWeight:600}}>{n.text}</div><div style={{fontSize:10.5,color:'#94a3b8',marginTop:2}}>By {n.author} · {n.created_at?.slice(0,10)}</div></div>
                </div>
              ))}
              {(!c.notes||c.notes.length===0) && <div style={{fontSize:12,color:'#94a3b8',fontStyle:'italic'}}>No activity recorded yet.</div>}
            </div>

            {/* Recent Interview */}
            <div className="cp-card">
              <div className="cp-card-title">🎥 Recent Interview</div>
              {c.interview ? (
                <>
                  <div style={{padding:'10px 12px',background:'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0',marginBottom:10}}>
                    <div style={{fontSize:12,fontWeight:700,color:'#1e293b',marginBottom:2}}>Technical Interview</div>
                    <div style={{fontSize:11,color:'#64748b'}}>{c.interview.date} · {c.interview.time}</div>
                    <div style={{marginTop:4}}><span className={`cp-risk-pill ${getInterviewDisplayStatus()==='completed'?'risk-low':getInterviewDisplayStatus()==='live'?'risk-high':'risk-med'}`} style={{fontSize:10}}>{getInterviewDisplayStatus().toUpperCase()}</span></div>
                  </div>
                  {c.interview.meeting_link && (() => {
                    const joinStatus = getInterviewJoinStatus();
                    const displayStatus = getInterviewDisplayStatus();
                    const isCompleted = displayStatus === 'completed';
                    return (
                      <div style={{display:'flex',gap:8,flexDirection:'column'}}>
                        {isCompleted ? (
                          <div style={{padding:'10px 12px',background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:8,fontSize:12,color:'#16a34a',fontWeight:600,textAlign:'center'}}>
                            ✅ Interview Completed
                          </div>
                        ) : joinStatus.expired ? (
                          <div style={{padding:'10px 12px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,fontSize:11.5,color:'#dc2626',fontWeight:600,textAlign:'center'}}>
                            ⏱ {joinStatus.label}
                          </div>
                        ) : (
                          <a href={`/interview-room/${id}`} target="_blank" rel="noreferrer" className="cp-footer-btn primary" style={{textDecoration:'none',fontSize:11.5,display:'flex',justifyContent:'center',alignItems:'center'}}>🔗 Join Session</a>
                        )}
                        {c.interview.secure_token && !isCompleted && (
                          <button 
                            onClick={() => {
                              const link = getCandidateJoinUrl(c.interview.secure_token);
                              navigator.clipboard.writeText(link);
                              toast.success('Candidate invite link copied!');
                            }}
                            className="cp-footer-btn"
                            style={{fontSize:11.5,display:'flex',justifyContent:'center',alignItems:'center',background:'#f1f5f9',color:'#475569',border:'1px solid #cbd5e1'}}
                          >
                             Copy Invite Link
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </>
              ) : <div style={{fontSize:12,color:'#94a3b8',fontStyle:'italic',textAlign:'center',padding:'20px 0'}}>No interview scheduled.<br/><button className="cp-footer-btn primary" style={{marginTop:8,fontSize:11.5}} onClick={()=>setShowInterview(true)}>Schedule Now</button></div>}
            </div>

            {/* Education + Certs + Projects */}
            <div className="cp-card">
              <div className="cp-card-title">🎓 Academic & Credentials</div>
              {eduArr.slice(0,3).map((e,i)=>(
                <div key={i} style={{marginBottom:10,paddingLeft:8,borderLeft:'2px solid #e2e8f0'}}>
                  <div style={{fontWeight:700,fontSize:12.5,color:'#1e293b'}}>{typeof e==='object'?(e.degree||e):e}</div>
                  {e.institution && <div style={{fontSize:11.5,color:'#4f46e5',fontWeight:600}}>{e.institution}</div>}
                  {(e.field||e.year) && <div style={{fontSize:11,color:'#94a3b8'}}>{[e.field,e.year].filter(Boolean).join(' · ')}</div>}
                </div>
              ))}
              {certs.length>0 && <>
                <div style={{fontSize:10,fontWeight:800,color:'#64748b',textTransform:'uppercase',marginBottom:6,marginTop:8,borderTop:'1px solid #f1f5f9',paddingTop:8}}>Certifications</div>
                {certs.slice(0,4).map((cert,i)=><div key={i} style={{fontSize:12,color:'#334155',marginBottom:3,display:'flex',gap:6}}><span style={{color:'#f59e0b'}}>★</span>{typeof cert==='object'?cert.name||JSON.stringify(cert):cert}</div>)}
              </>}
              {projArr.length>0 && <>
                <div style={{fontSize:10,fontWeight:800,color:'#64748b',textTransform:'uppercase',marginBottom:6,marginTop:8,borderTop:'1px solid #f1f5f9',paddingTop:8}}>Key Projects</div>
                {projArr.slice(0,3).map((p,i)=>(
                  <div key={i} style={{marginBottom:8,paddingLeft:8,borderLeft:'2px solid #e2e8f0'}}>
                    <div style={{fontWeight:700,fontSize:12,color:'#1e293b'}}>{typeof p==='object'?p.name:p}</div>
                    {p.description && <div style={{fontSize:11,color:'#64748b',marginTop:1}}>{p.description}</div>}
                    {p.technologies?.length>0 && <div style={{marginTop:3,display:'flex',flexWrap:'wrap',gap:3}}>{p.technologies.slice(0,3).map((t,ti)=><Chip key={ti} label={t} variant="blue"/>)}</div>}
                  </div>
                ))}
              </>}
            </div>

            {/* Recruiter Notes */}
            <div className="cp-card">
              <div className="cp-card-title">📝 Recruiter Notes</div>
              <div style={{maxHeight:200,overflowY:'auto',marginBottom:10}}>
                {(c.notes||[]).map((n,i)=>(
                  <div key={i} className="cp-note-card">
                    {n.text}
                    <div className="cp-note-author">— {n.author} · {n.created_at?.slice(0,10)}</div>
                  </div>
                ))}
                {(!c.notes||c.notes.length===0) && <div style={{fontSize:12,color:'#94a3b8',fontStyle:'italic',textAlign:'center',padding:'16px 0'}}>No notes yet.</div>}
              </div>
              <form onSubmit={addNote} style={{display:'flex',gap:6}}>
                <input value={note} onChange={e=>setNote(e.target.value)} placeholder="Add a note..." style={{flex:1,padding:'7px 10px',border:'1px solid #e2e8f0',borderRadius:8,fontSize:12,outline:'none'}} />
                <button type="submit" disabled={savingNote} style={{padding:'7px 12px',background:'#4f46e5',color:'#fff',border:'none',borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:700}}>Add</button>
              </form>
            </div>
          </div>
        </>}

        {tab === 'Resume' && (
          <div className="cp-card" style={{maxWidth:900}}>
            <div className="cp-card-title"> Original Resume</div>
            <div style={{display:'flex',gap:10,marginBottom:12}}>
              <a href={`${API.defaults.baseURL}/candidates/${id}/resume`} target="_blank" rel="noreferrer" className="cp-footer-btn">🔗 Open PDF</a>
              <a href={`${API.defaults.baseURL}/candidates/${id}/resume`} download className="cp-footer-btn">⬇️ Download</a>
            </div>
            <iframe src={`${API.defaults.baseURL}/candidates/${id}/resume#toolbar=0`} style={{width:'100%',height:700,border:'1px solid #e2e8f0',borderRadius:10}} title="resume" />
          </div>
        )}

        {tab === 'AI Match Analysis' && (
          <div style={{display:'flex',flexDirection:'column',gap:16}}>
            {/* Top banner */}
            <div className="cp-card" style={{background:`linear-gradient(135deg,${col(overall)}15,#fff)`,borderLeft:`4px solid ${col(overall)}`}}>
              <div style={{display:'flex',justifyContent: 'space-between',alignItems:'center',flexWrap:'wrap',gap:12}}>
                <div>
                  <div style={{fontSize:11,fontWeight:800,color:'#64748b',textTransform:'uppercase',letterSpacing:1,marginBottom:4}}>AI Match Analysis — {job?.title || c.job_title || 'Position'}</div>
                  <div style={{fontSize:28,fontWeight:900,color:col(overall)}}>{overall}% <span style={{fontSize:14,fontWeight:600,color:'#64748b'}}>Overall Match</span></div>
                  <div style={{fontSize:13,color:'#475569',marginTop:4,maxWidth:600}}>{hs.narrative || hs.executive_summary || 'Run AI re-analysis to generate detailed insights.'}</div>
                </div>
                <div style={{textAlign:'center',padding:'14px 24px',borderRadius:12,background:col(overall)+'18',border:`1.5px solid ${col(overall)}40`}}>
                  <div style={{fontSize:10,fontWeight:800,color:'#64748b',textTransform:'uppercase',marginBottom:4}}>Recommendation</div>
                  <div style={{fontSize:18,fontWeight:900,color:col(overall)}}>{rec}</div>
                  <div style={{fontSize:11,color:'#64748b',marginTop:2}}>{hs.recommendation_confidence||'Medium'} Confidence</div>
                </div>
              </div>
            </div>

            {/* Score breakdown table */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
              <div className="cp-card">
                <div className="cp-card-title"> Score Breakdown</div>
                {[
                  ['Skills Match',      c.skill_score,         '#6366f1'],
                  ['Experience Match',  c.experience_score,    '#10b981'],
                  ['Semantic Fit',      c.semantic_score,      '#f59e0b'],
                  ['Resume Quality',    c.resume_quality||bd.quality_score, '#ef4444'],
                  ['Certifications',    c.certification_score||bd.cert_score,'#8b5cf6'],
                ].map(([lbl,val,clr])=>(
                  <div key={lbl} className="cp-bar-row">
                    <span className="cp-bar-label">{lbl}</span>
                    <div className="cp-bar-track"><div className="cp-bar-fill" style={{width:`${ss(val)}%`,background:clr}}/></div>
                    <span className="cp-bar-pct">{ss(val)}%</span>
                  </div>
                ))}
                <div style={{marginTop:14,paddingTop:12,borderTop:'1px solid #f1f5f9',display:'flex',justifyContent: 'space-between',alignItems:'center'}}>
                  <span style={{fontSize:13,fontWeight:700,color:'#1e293b'}}>Overall Score</span>
                  <span style={{fontSize:20,fontWeight:900,color:col(overall)}}>{overall}%</span>
                </div>
              </div>

              <div className="cp-card">
                <div className="cp-card-title"> JD Requirements vs Candidate</div>
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:10,fontWeight:800,color:'#16a34a',textTransform:'uppercase',marginBottom:6}}> Matched ({matchedSkillsCombined.length})</div>
                  <div style={{display:'flex',flexWrap:'wrap',gap:4}}>{matchedSkillsCombined.slice(0,12).map(s=><Chip key={s} label={s} variant="green"/>)}</div>
                  {matchedSkillsCombined.length===0 && <p style={{fontSize:12,color:'#94a3b8',fontStyle:'italic',margin:0}}>Click  Re-Analyze to compute matches</p>}
                </div>
                {uniqueMissing.length>0 && <div style={{borderTop:'1px solid #f1f5f9',paddingTop:10}}>
                  <div style={{fontSize:10,fontWeight:800,color:'#dc2626',textTransform:'uppercase',marginBottom:6}}> Missing ({uniqueMissing.length})</div>
                  <div style={{display:'flex',flexWrap:'wrap',gap:4}}>{uniqueMissing.slice(0,10).map(s=><Chip key={s} label={s} variant="red"/>)}</div>
                </div>}
                {jdRequired.length===0 && uniqueMissing.length===0 && <div style={{padding:'16px 0',textAlign:'center',color:'#94a3b8',fontSize:12}}>No JD skill requirements found.<br/>Click  Re-Analyze to extract from JD.</div>}
              </div>
            </div>

            {/* Strengths / Weaknesses / Risks / Opportunities */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:14}}>
              {[
                ['Strengths',   hs.strengths,    '#16a34a','#f0fdf4','#bbf7d0'],
                ['Weaknesses', hs.weaknesses,   '#dc2626','#fef2f2','#fecaca'],
                ['🚨 Risks',      hs.risks,        '#b45309','#fffbeb','#fde68a'],
                [' Opportunities',hs.opportunities,'#4f46e5','#eff6ff','#c7d2fe'],
              ].map(([title,items,tc,bg,border])=>(
                <div key={title} className="cp-card" style={{borderLeft:`3px solid ${border}`,background:bg}}>
                  <div className="cp-card-title" style={{color:tc}}>{title}</div>
                  {(items?.length ? items : ['Click  Re-Analyze to generate AI insights']).map((s,i)=>(
                    <div key={i} className="cp-strength-item"><span style={{color:tc,flexShrink:0}}>›</span><span>{s}</span></div>
                  ))}
                </div>
              ))}
            </div>

            {/* Interview focus + metadata */}
            {(hs.interview_focus_areas?.length>0 || hs.salary_range_fit) && (
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
                {hs.interview_focus_areas?.length>0 && <div className="cp-card">
                  <div className="cp-card-title" style={{color:'#0891b2'}}> Interview Focus Areas</div>
                  {hs.interview_focus_areas.map((a,i)=><div key={i} style={{display:'flex',gap:8,marginBottom:6,fontSize:12.5,color:'#334155'}}><span style={{color:'#6366f1',fontWeight:700}}>{i+1}.</span>{a}</div>)}
                </div>}
                <div className="cp-card">
                  <div className="cp-card-title"> Hiring Metadata</div>
                  {[['Salary Level',hs.salary_range_fit],['Onboarding',hs.onboarding_complexity],['Time to Productivity',hs.time_to_productivity],['Extraction Reliability',c.extraction_reliability]].filter(x=>x[1]).map(([k,v])=>(
                    <div key={k} style={{display: 'flex',justifyContent: 'space-between',padding:'6px 0',borderBottom:'1px solid #f1f5f9',fontSize:12.5}}>
                      <span style={{color:'#64748b',fontWeight:500}}>{k}</span><span style={{fontWeight:700,color:'#1e293b'}}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Re-analyze CTA if empty */}
            {!hs.strengths?.length && <div className="cp-card" style={{textAlign:'center',padding:32,border:'2px dashed #e2e8f0'}}>
              <div style={{fontSize:32,marginBottom:12}}>🤖</div>
              <div style={{fontSize:16,fontWeight:700,color:'#1e293b',marginBottom:6}}>No AI Analysis Yet</div>
              <div style={{fontSize:13,color:'#64748b',marginBottom:16}}>This candidate was uploaded before the AI analysis engine. Click below to run a full LLM analysis now.</div>
              <button className="cp-footer-btn primary" onClick={rerank} disabled={reranking} style={{margin:'0 auto'}}>
                {reranking ? ' Analyzing...' : ' Run Full AI Analysis Now'}
              </button>
            </div>}
          </div>
        )}

        {tab === 'Skills' && (
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            {/* JD Required Skills */}
            {jdRequired.length>0 && <div className="cp-card">
              <div className="cp-card-title"> JD Required Skills ({jdRequired.length})</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                {jdRequired.map(s=>{
                  const matched = candidateAllSkills.some(cs=>cs.toLowerCase()===s.toLowerCase());
                  return <span key={s} style={{padding:'5px 12px',borderRadius:20,fontSize:12,fontWeight:600,background:matched?'#ecfdf5':'#fef2f2',color:matched?'#047857':'#b91c1c',border:`1px solid ${matched?'#a7f3d0':'#fecaca'}`,display:'inline-flex',alignItems:'center',gap:5}}>{matched?'':'✗'} {s}</span>;
                })}
              </div>
            </div>}
            {/* Three-col skill analysis */}
            <div className="cp-grid3">
              <div className="cp-card" style={{borderLeft:'3px solid #10b981'}}>
                <div className="cp-card-title" style={{color:'#16a34a'}}>Matched Skills ({matchedSkillsCombined.length})</div>
                {matchedSkillsCombined.map(s=><Chip key={s} label={s} variant="green"/>)}
                {matchedSkillsCombined.length===0 && <p style={{fontSize:12,color:'#94a3b8',fontStyle:'italic'}}>No matches found. Click  Re-Analyze.</p>}
              </div>
              <div className="cp-card" style={{borderLeft:'3px solid #ef4444'}}>
                <div className="cp-card-title" style={{color:'#dc2626'}}> Missing Required ({uniqueMissing.length})</div>
                {uniqueMissing.map(s=><Chip key={s} label={s} variant="red"/>)}
                {uniqueMissing.length===0 && jdRequired.length===0 && <p style={{fontSize:12,color:'#94a3b8',fontStyle:'italic'}}>No JD skills to compare. Click  Re-Analyze.</p>}
                {uniqueMissing.length===0 && jdRequired.length>0 && <p style={{fontSize:12,color:'#10b981',fontWeight:600}}>All required skills covered! </p>}
              </div>
              <div className="cp-card" style={{borderLeft:'3px solid #6366f1'}}>
                <div className="cp-card-title" style={{color:'#4f46e5'}}>💎 Candidate Skills ({candidateAllSkills.length})</div>
                {candidateTechSkills.map(s=><Chip key={s} label={s} variant="blue"/>)}
                {candidateSoftSkills.map(s=><Chip key={s} label={s} variant="gray"/>)}
                {candidateAllSkills.length===0 && <p style={{fontSize:12,color:'#94a3b8',fontStyle:'italic'}}>No skills extracted. Click  Re-Analyze.</p>}
              </div>
            </div>
            {/* Preferred / Bonus skills */}
            {jdPreferred.length>0 && <div className="cp-card">
              <div className="cp-card-title" style={{color:'#0891b2'}}>⭐ Preferred/Bonus Skills</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                {jdPreferred.map(s=>{
                  const has = candidateAllSkills.some(cs=>cs.toLowerCase()===s.toLowerCase());
                  return <span key={s} style={{padding:'4px 12px',borderRadius:20,fontSize:12,fontWeight:600,background:has?'#f0f9ff':'#f8fafc',color:has?'#0369a1':'#64748b',border:`1px solid ${has?'#bae6fd':'#e2e8f0'}`}}>{has?'':''}{s}</span>;
                })}
              </div>
            </div>}
          </div>
        )}

        {tab === 'Experience' && (
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div className="cp-card">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                <div className="cp-card-title" style={{margin:0}}> Work History ({tl.length} positions)</div>
                {tl.length===0 && <button className="cp-footer-btn primary" onClick={rerank} disabled={reranking} style={{fontSize:11.5}}>{reranking?'Running...':' Extract via AI'}</button>}
              </div>
              {tl.length>0 ? tl.map((job,i)=>(
                <div key={i} style={{marginBottom:24,paddingLeft:18,borderLeft:`3px solid ${i===0?'#6366f1':'#e2e8f0'}`,position:'relative'}}>
                  <div style={{position:'absolute',left:-8,top:2,width:14,height:14,borderRadius:'50%',background:i===0?'#6366f1':'#94a3b8',border:'2px solid #fff'}}/>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:6}}>
                    <div>
                      <div style={{fontWeight:800,fontSize:14,color:'#1e293b'}}>{job.title||'Unknown Role'}</div>
                      <div style={{fontSize:13,color:'#4f46e5',fontWeight:600,marginTop:2}}>{job.company||'Unknown Company'}</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:12,color:'#64748b',fontWeight:600}}>{job.start_date} – {job.end_date||'Present'}</div>
                      {job.duration_months>0 && <div style={{fontSize:11,color:'#94a3b8',marginTop:1}}>{Math.round(job.duration_months/12*10)/10} yrs</div>}
                    </div>
                  </div>
                  {job.description && <p style={{fontSize:12.5,color:'#475569',marginTop:8,lineHeight:1.7}}>{job.description}</p>}
                  <div style={{marginTop:6,display:'flex',gap:6,flexWrap:'wrap'}}>
                    {job.is_internship && <Chip label="Internship" variant="blue"/>}
                    {job.is_freelance && <Chip label="Freelance" variant="green"/>}
                    {job.duration_months>0 && job.duration_months<12 && !job.is_internship && <Chip label="Short Tenure" variant="red"/>}
                  </div>
                </div>
              )) : (
                <div style={{textAlign:'center',padding:'32px 0',color:'#94a3b8'}}>
                  <div style={{fontSize:32,marginBottom:8}}>📁</div>
                  <div style={{fontSize:13,fontWeight:600,marginBottom:4}}>No work history extracted yet</div>
                  <div style={{fontSize:12,marginBottom:12}}>The AI needs to re-parse this resume to extract structured work history.</div>
                  <button className="cp-footer-btn primary" onClick={rerank} disabled={reranking}>{reranking?' Extracting...':' Extract Work History via AI'}</button>
                </div>
              )}
            </div>
            {/* Summary card */}
            {c.summary_or_objective && <div className="cp-card">
              <div className="cp-card-title">📝 Professional Summary (from resume)</div>
              <p style={{fontSize:13,color:'#475569',lineHeight:1.7,margin:0,fontStyle:'italic'}}>"{c.summary_or_objective}"</p>
            </div>}
          </div>
        )}

        {tab === 'Projects' && (
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            {projArr.length>0 ? (
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
                {projArr.map((p,i)=>(
                  <div key={i} className="cp-card" style={{borderLeft:'3px solid #6366f1'}}>
                    <div style={{fontWeight:800,fontSize:14,color:'#1e293b',marginBottom:6}}>{p.name||`Project ${i+1}`}</div>
                    {p.description && <p style={{fontSize:12.5,color:'#475569',lineHeight:1.6,margin:'0 0 10px'}}>{p.description}</p>}
                    {p.technologies?.length>0 && <div style={{display:'flex',flexWrap:'wrap',gap:4}}>{p.technologies.map((t,ti)=><Chip key={ti} label={t} variant="blue"/>)}</div>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="cp-card" style={{textAlign:'center',padding:32,border:'2px dashed #e2e8f0'}}>
                <div style={{fontSize:32,marginBottom:8}}>🛠️</div>
                <div style={{fontSize:13,fontWeight:600,color:'#1e293b',marginBottom:4}}>No projects extracted yet</div>
                <div style={{fontSize:12,color:'#64748b',marginBottom:12}}>Click Re-Analyze to extract projects from the resume.</div>
                <button className="cp-footer-btn primary" onClick={rerank} disabled={reranking}>{reranking?' Extracting...':' Extract Projects via AI'}</button>
              </div>
            )}
          </div>
        )}

        {tab === 'Education' && (
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            {eduArr.length>0 ? (
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
                {eduArr.map((e,i)=>(
                  <div key={i} className="cp-card" style={{borderLeft:'3px solid #8b5cf6'}}>
                    <div style={{display:'flex',alignItems:'flex-start',gap:12}}>
                      <span style={{fontSize:28}}>🎓</span>
                      <div>
                        <div style={{fontWeight:800,fontSize:14,color:'#1e293b'}}>{typeof e==='object'?(e.degree||'Degree'):e}</div>
                        {e.institution && <div style={{fontSize:13,color:'#4f46e5',fontWeight:600,marginTop:3}}>{e.institution}</div>}
                        {e.field && <div style={{fontSize:12,color:'#64748b',marginTop:2}}>Field: {e.field}</div>}
                        {e.year && <div style={{fontSize:12,color:'#94a3b8',marginTop:2}}>Year: {e.year}</div>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="cp-card" style={{textAlign:'center',padding:32,border:'2px dashed #e2e8f0'}}>
                <div style={{fontSize:32,marginBottom:8}}>🎓</div>
                <div style={{fontSize:13,fontWeight:600,color:'#1e293b',marginBottom:4}}>No education data extracted yet</div>
                <button className="cp-footer-btn primary" onClick={rerank} disabled={reranking}>{reranking?' Extracting...':' Extract Education via AI'}</button>
              </div>
            )}
            {/* Certifications */}
            {certs.length>0 && <div className="cp-card">
              <div className="cp-card-title"> Certifications ({certs.length})</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                {certs.map((cert,i)=>(
                  <div key={i} style={{display:'flex',gap:10,alignItems:'center',padding:'8px 12px',background:'#fffbeb',border:'1px solid #fde68a',borderRadius:8}}>
                    <span style={{fontSize:18}}>⭐</span>
                    <span style={{fontSize:12.5,fontWeight:600,color:'#92400e'}}>{typeof cert==='object'?cert.name||JSON.stringify(cert):cert}</span>
                  </div>
                ))}
              </div>
            </div>}
          </div>
        )}

        {tab === 'Interviews' && (
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div className="cp-card">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                <div className="cp-card-title" style={{margin:0}}>🎥 Scheduled Interviews</div>
                <button className="cp-footer-btn primary" onClick={()=>setShowInterview(true)}>Schedule Interview</button>
              </div>
              {c.interview ? (
                <div>
                  <div className="cp-card" style={{borderLeft:'3px solid #4f46e5',background:'#f8fafc',marginBottom:16}}>
                    <div style={{fontWeight:800,fontSize:14,color:'#1e293b',marginBottom:6}}>Technical Interview</div>
                    <div style={{fontSize:12.5,color:'#334155',marginBottom:4}}><b>Date:</b> {c.interview.date}</div>
                    <div style={{fontSize:12.5,color:'#334155',marginBottom:4}}><b>Time:</b> {c.interview.time}</div>
                    <div style={{fontSize:12.5,color:'#334155',marginBottom:8}}><b>Status:</b> <span className={`cp-risk-pill ${c.interview.status==='completed'?'risk-low':'risk-med'}`} style={{fontSize:10.5,marginLeft:4}}>{(c.interview.status||'Scheduled').toUpperCase()}</span></div>
                    {c.interview.meeting_link && (
                      <div style={{display:'flex',gap:8,marginTop:12,flexWrap:'wrap'}}>
                        {c.interview.status !== 'completed' && (
                          <a href={`/interview-room/${id}`} target="_blank" rel="noreferrer" className="cp-footer-btn primary" style={{textDecoration:'none',fontSize:12,display:'inline-flex',width:'fit-content'}}>
                            🔗 Join Live Interview Room
                          </a>
                        )}
                        {c.interview.secure_token && c.interview.status !== 'completed' && (
                          <button 
                            onClick={() => {
                              const link = getCandidateJoinUrl(c.interview.secure_token);
                              navigator.clipboard.writeText(link);
                              toast.success('Candidate invite link copied!');
                            }}
                            className="cp-footer-btn"
                            style={{fontSize:12,display:'inline-flex',width:'fit-content',background:'#f1f5f9',color:'#475569',border:'1px solid #cbd5e1'}}
                          >
                             Copy Candidate Link
                          </button>
                        )}
                        {(c.interview.status === 'live' || c.status === 'interview_live') && (
                          <button 
                            onClick={async () => {
                              if (window.confirm('Are you sure you want to end this interview session and trigger AI feedback generation?')) {
                                try {
                                  await API.post('/interviews/end', { candidate_id: id });
                                  toast.success('Interview ended. Generating AI analysis...');
                                  load();
                                } catch {
                                  toast.error('Failed to end interview session');
                                }
                              }
                            }}
                            className="cp-footer-btn danger"
                            style={{fontSize:12,display:'inline-flex',width:'fit-content'}}
                          >
                            🛑 End Interview & Generate AI Feedback
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{textAlign:'center',padding:32,color:'#94a3b8'}}>
                  <div style={{fontSize:32,marginBottom:8}}>🎥</div>
                  <div style={{fontSize:13,fontWeight:600,color:'#1e293b',marginBottom:4}}>No interviews scheduled yet</div>
                  <p style={{fontSize:12,marginBottom:12}}>Schedule an interview to generate a secure LiveKit meet room and coordinate with the recruiter.</p>
                  <button className="cp-footer-btn primary" style={{margin:'0 auto'}} onClick={()=>setShowInterview(true)}> Schedule Now</button>
                </div>
              )}
            </div>

            {/* AI Interview Intelligence Card */}
            <InterviewInsightCard candidate={c} />
          </div>
        )}

        {tab === 'Activity' && (
          <div className="cp-card" style={{maxWidth:800}}>
            <div className="cp-card-title">🕒 Complete Activity Timeline</div>
            <div style={{display:'flex',flexDirection:'column',gap:12,marginTop:12}}>
              {(c.notes||[]).map((n,i)=>(
                <div key={i} className="cp-activity-item" style={{borderBottom:'1px solid #f1f5f9',paddingBottom:12}}>
                  <div className="cp-activity-dot" style={{background:'#6366f1',marginTop:6}} />
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,color:'#1e293b',fontWeight:600}}>{n.text}</div>
                    <div style={{fontSize:11,color:'#94a3b8',marginTop:4}}>Author: <b>{n.author}</b> · {n.created_at ? new Date(n.created_at).toLocaleString() : 'Just now'}</div>
                  </div>
                </div>
              ))}
              {(!c.notes||c.notes.length===0) && (
                <div style={{textAlign:'center',padding:32,color:'#94a3b8',fontSize:12.5,fontStyle:'italic'}}>
                  No activities or updates logged yet.
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'Notes & Feedback' && (
          <div className="cp-card" style={{maxWidth:700}}>
            <div className="cp-card-title">📝 All Recruiter Notes</div>
            <div style={{marginBottom:14}}>
              {(c.notes||[]).map((n,i)=>(
                <div key={i} className="cp-note-card">{n.text}<div className="cp-note-author">— {n.author} · {n.created_at?.slice(0,10)}</div></div>
              ))}
              {(!c.notes||c.notes.length===0) && <p style={{fontSize:12,color:'#94a3b8',fontStyle:'italic'}}>No notes yet.</p>}
            </div>
            <form onSubmit={addNote} style={{display:'flex',gap:8}}>
              <input value={note} onChange={e=>setNote(e.target.value)} placeholder="Write a note..." style={{flex:1,padding:'9px 12px',border:'1px solid #e2e8f0',borderRadius:8,fontSize:13,outline:'none'}} />
              <button type="submit" disabled={savingNote} style={{padding:'9px 16px',background:'#4f46e5',color:'#fff',border:'none',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:700}}>Post Note</button>
            </form>
          </div>
        )}

      </div>{/* end cp-body */}

      {/* ── FOOTER ACTIONS ── */}
      <div className="cp-footer">
        <button className="cp-footer-btn" onClick={()=>setShowInterview(true)}>Schedule Interview</button>
        <button className="cp-footer-btn" onClick={()=>updateStatus('shortlisted')}>⏭️ Move to Next Stage</button>
        <button className="cp-footer-btn primary" onClick={rerank} disabled={reranking}>{reranking?' Analyzing...':'Re-Analyze Resume'}</button>
        <button className="cp-footer-btn" onClick={()=>window.open(`${API.defaults.baseURL}/candidates/${id}/resume`,'_blank')}>View Resume</button>
        <div style={{flex:1}} />
        <button className="cp-footer-btn danger" onClick={()=>{ if(window.confirm('Reject this candidate?')) updateStatus('rejected'); }}>✖ Reject Candidate</button>
      </div>

    </div>{/* end cp-wrap */}
    {showInterview && <InterviewModal candidate={c} onClose={()=>setShowInterview(false)} onSuccess={load} />}
    </div>
  );
}
