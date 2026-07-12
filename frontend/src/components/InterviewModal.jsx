import { useState } from 'react';
import API from '../api/client';
import toast from 'react-hot-toast';
import { MdClose, MdCalendarToday } from 'react-icons/md';

export default function InterviewModal({ candidate, onClose, onSuccess }) {
  const [form, setForm] = useState({
    date: '', time: '10:00', mode: 'online', location: '', notes: '', duration: 30
  });
  const [loading, setLoading] = useState(false);
  const [scheduledLink, setScheduledLink] = useState(null);

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.date) { toast.error('Please select a date'); return; }
    setLoading(true);
    try {
      const res = await API.post(`/interviews/schedule`, { ...form, candidate_id: candidate.id, job_id: candidate.job_id });
      toast.success('Interview scheduled!');
      
      let link = res.data.candidate_join_url;
      if (!link && res.data.secure_token) {
        let base = import.meta.env.VITE_FRONTEND_URL || window.location.origin;
        if (base.endsWith('/')) base = base.slice(0, -1);
        link = `${base}/candidate-interview/${res.data.secure_token}`;
      }
      setScheduledLink(link || 'Link generation pending');
      onSuccess();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to schedule interview');
    } finally {
      setLoading(false);
    }
  };

  if (scheduledLink) {
    return (
      <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="modal-box animate-slide" style={{ maxWidth: 440, textAlign: 'center', padding: 28 }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>📅</div>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>Interview Scheduled!</h3>
          <p style={{ fontSize: 12.5, color: '#64748b', lineHeight: 1.6, marginBottom: 20 }}>
            The secure LiveKit interview session is ready. As requested, <b>no email has been sent to the candidate</b>. Please copy the invite link below to share with them directly.
          </p>
          
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 20, wordBreak: 'break-all', fontSize: 12, fontWeight: 600, color: '#1e293b', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ color: '#64748b', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Candidate Invite Link</span>
            <span style={{ background: '#fff', border: '1px solid #e2e8f0', padding: '8px 10px', borderRadius: 6, userSelect: 'all', color: '#4f46e5' }}>{scheduledLink}</span>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button 
              onClick={() => {
                navigator.clipboard.writeText(scheduledLink);
                toast.success('Link copied to clipboard!');
              }}
              className="btn btn-info"
              style={{ padding: '10px 20px', fontSize: 13, fontWeight: 700 }}
            >
              📋 Copy Invite Link
            </button>
            <button 
              onClick={onClose}
              className="btn btn-outline"
              style={{ padding: '10px 20px', fontSize: 13 }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box animate-slide">
        <div className="modal-header">
          <div className="flex-center gap-8">
            <MdCalendarToday style={{ color: 'var(--info)', fontSize: 20 }} />
            <span className="modal-title">Schedule Interview</span>
          </div>
          <button className="modal-close" onClick={onClose}><MdClose /></button>
        </div>

        <div style={{ marginBottom: 16, padding: '10px 14px', background: '#f8fafc', borderRadius: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{candidate?.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{candidate?.email}</div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Interview Date *</label>
              <input type="date" className="form-input" value={form.date}
                onChange={e => set('date', e.target.value)}
                min={new Date().toISOString().split('T')[0]} required />
            </div>
            <div className="form-group">
              <label className="form-label">Time *</label>
              <input type="time" className="form-input" value={form.time}
                onChange={e => set('time', e.target.value)} required />
            </div>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Mode *</label>
              <select className="form-select" value={form.mode} onChange={e => set('mode', e.target.value)}>
                <option value="online">Online (Video Call)</option>
                <option value="offline">Offline (In-Person)</option>
                <option value="phone">Phone Interview</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Duration *</label>
              <select className="form-select" value={form.duration} onChange={e => set('duration', parseInt(e.target.value))}>
                <option value={15}>15 Minutes</option>
                <option value={30}>30 Minutes</option>
                <option value={45}>45 Minutes</option>
                <option value={60}>60 Minutes</option>
                <option value={90}>90 Minutes</option>
              </select>
            </div>
          </div>

          {form.mode !== 'online' && (
            <div className="form-group">
              <label className="form-label">Location / Address</label>
              <input type="text" className="form-input" placeholder="Office address"
                value={form.location} onChange={e => set('location', e.target.value)} />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Notes (optional)</label>
            <textarea className="form-textarea" rows={2} placeholder="Any instructions..."
              value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-info" disabled={loading}>
              {loading ? <span className="spinner" /> : 'Schedule Interview'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
