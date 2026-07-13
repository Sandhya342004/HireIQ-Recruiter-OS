import { useState, useEffect } from 'react';
import Sidebar from '../components/Sidebar';
import Navbar from '../components/Navbar';
import API from '../api/client';
import toast from 'react-hot-toast';
import { MdWork, MdAdd, MdPeople } from 'react-icons/md';

export default function Jobs() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title:'', company:'', description:'', location:'', required_experience_years:0 });

  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const fetchJobs = () => {
    setLoading(true);
    API.get('/jobs/list').then(r => setJobs(r.data)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(fetchJobs, []);

  const createJob = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await API.post('/jobs/create', { ...form, required_experience_years: Number(form.required_experience_years) });
      toast.success('Job created!');
      setForm({ title:'', company:'', description:'', location:'', required_experience_years:0 });
      setShowForm(false);
      fetchJobs();
    } catch { 
      toast.error('Failed to create job'); 
    } finally {
      setSubmitting(false);
    }
  };

  const downloadReport = async (jobId, format) => {
    try {
      const loadingToast = toast.loading(`Generating ${format.toUpperCase()} report...`);
      const res = await API.get(`/jobs/${jobId}/shortlisted-report?format=${format}`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Shortlisted_Candidates_${jobId}.${format === 'excel' ? 'xlsx' : 'pdf'}`);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      toast.success('Report downloaded!', { id: loadingToast });
    } catch (error) {
      toast.dismiss();
      if (error.response?.status === 404) {
        toast.error('No candidates available yet for this job.');
      } else {
        toast.error('Failed to generate report');
      }
    }
  };

  return (
    <div className="layout">
      <Sidebar />
      <div className="main-content">
        <Navbar title="Jobs" />
        <div className="page-body animate-fade">
          <div className="flex-between page-header">
            <div><h1>Job Postings</h1><p>Manage your open positions</p></div>
            <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
              <MdAdd /> {showForm ? 'Cancel' : 'New Job'}
            </button>
          </div>

          {showForm && (
            <div className="card" style={{ marginBottom:20 }}>
              <h3 style={{ marginBottom:16, fontSize:15, fontWeight:600 }}>Create New Job</h3>
              <form onSubmit={createJob} style={{ display:'flex', flexDirection:'column', gap:14 }}>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Job Title *</label>
                    <input className="form-input" required placeholder="e.g. Data Scientist"
                      value={form.title} onChange={e => setF('title', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Company *</label>
                    <input className="form-input" required placeholder="Company name"
                      value={form.company} onChange={e => setF('company', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Location</label>
                    <input className="form-input" placeholder="e.g. Remote / Bangalore"
                      value={form.location} onChange={e => setF('location', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Min Experience (years)</label>
                    <input type="number" min={0} max={30} className="form-input"
                      value={form.required_experience_years}
                      onChange={e => setF('required_experience_years', e.target.value)} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Job Description *</label>
                  <textarea className="form-textarea" required rows={6}
                    placeholder="Full job description including required skills, responsibilities…"
                    value={form.description} onChange={e => setF('description', e.target.value)} />
                </div>
                <button type="submit" className="btn btn-primary" style={{ alignSelf:'flex-end' }} disabled={submitting}>
                  {submitting && <span className="spinner" style={{ marginRight: 8, borderTopColor: '#fff' }} />}
                  {submitting ? 'Creating...' : 'Create Job'}
                </button>
              </form>
            </div>
          )}

          {loading ? (
            <div style={{ textAlign:'center', padding:40 }}><div className="spinner" style={{ margin:'0 auto' }} /></div>
          ) : jobs.length === 0 ? (
            <div className="card empty-state">
              <MdWork style={{ fontSize:48, color:'#94a3b8' }} />
              <p style={{ marginTop:12 }}>No jobs yet. Create your first job posting.</p>
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              {jobs.map(j => (
                <div key={j.id} className="card" style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:600, fontSize:16 }}>{j.title}</div>
                    <div style={{ color:'var(--text-secondary)', fontSize:13, marginTop:2 }}>
                      {j.company} {j.location && `· ${j.location}`} · Posted {j.created_at ? new Date(j.created_at).toLocaleDateString() : ''}
                    </div>
                    <div style={{ marginTop:10, fontSize:13, color:'var(--text-secondary)', lineHeight:1.5 }}>
                      {j.description?.slice(0, 200)}{j.description?.length > 200 ? '…' : ''}
                    </div>
                  </div>
                  <div style={{ marginLeft:20, textAlign:'center', flexShrink:0, display:'flex', flexDirection:'column', gap:8, alignItems:'center' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13 }}>
                      <MdPeople style={{ color:'var(--primary)' }} />
                      <span style={{ fontWeight:600 }}>{j.candidate_count}</span>
                      <span style={{ color:'var(--text-secondary)' }}>candidates</span>
                    </div>
                    <div style={{ display:'flex', gap:6, flexDirection: 'column' }}>
                      <div style={{ display:'flex', gap:6 }}>
                        <button className="btn btn-outline btn-sm" style={{ flex: 1, padding: '4px 8px', fontSize: 12 }} onClick={() => downloadReport(j.id, 'pdf')} disabled={!j.candidate_count}>
                          PDF
                        </button>
                        <button className="btn btn-outline btn-sm" style={{ flex: 1, padding: '4px 8px', fontSize: 12 }} onClick={() => downloadReport(j.id, 'excel')} disabled={!j.candidate_count}>
                          Excel
                        </button>
                      </div>
                      <button className="btn btn-outline btn-sm" style={{ borderColor:'var(--danger)', color:'var(--danger)', width: '100%' }}
                        onClick={() => {
                          if (window.confirm("Are you sure you want to delete this job and all associated candidates?")) {
                            API.delete(`/jobs/${j.id}`).then(() => {
                              toast.success("Job deleted");
                              fetchJobs();
                            }).catch(() => toast.error("Failed to delete job"));
                          }
                        }}>
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
