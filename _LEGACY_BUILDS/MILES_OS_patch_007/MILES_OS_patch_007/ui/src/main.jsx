import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CheckCircle2, ShieldAlert, Play, RefreshCw } from 'lucide-react';
import { approveWork, bootstrap, completeWork, getHealth, getSegments, getWork } from './lib/api';
import './style.css';

function Stat({ label, value }) {
  return <div className="stat"><div className="statValue">{value}</div><div className="statLabel">{label}</div></div>;
}

function App() {
  const [health, setHealth] = useState(null);
  const [work, setWork] = useState([]);
  const [segments, setSegments] = useState([]);
  const [error, setError] = useState('');

  async function refresh() {
    try {
      setError('');
      setHealth(await getHealth());
      setWork(await getWork());
      setSegments(await getSegments());
    } catch (err) {
      setError(String(err.message || err));
    }
  }

  useEffect(() => { refresh(); }, []);

  const stats = useMemo(() => {
    const waiting = work.filter(w => w.status === 'waiting_approval').length;
    const ready = work.filter(w => w.status === 'ready').length;
    const verified = segments.reduce((sum, s) => sum + (s.verified_email_count || 0), 0);
    return { waiting, ready, verified };
  }, [work, segments]);

  async function seed() { await bootstrap(); await refresh(); }
  async function approve(id) { await approveWork(id); await refresh(); }
  async function complete(id) { await completeWork(id); await refresh(); }

  return <main>
    <header>
      <div>
        <h1>MILES Desktop</h1>
        <p>Digital COO control center · Never Wait execution kernel</p>
      </div>
      <button onClick={refresh}><RefreshCw size={16}/> Refresh</button>
    </header>

    {error && <div className="error">{error}</div>}
    <section className="grid stats">
      <Stat label="Ready Work" value={stats.ready} />
      <Stat label="Needs Kevin" value={stats.waiting} />
      <Stat label="Segments" value={segments.length} />
      <Stat label="Verified Emails" value={stats.verified.toLocaleString()} />
    </section>

    <section className="panel">
      <div className="panelHead"><h2>Execution Board</h2><button onClick={seed}><Play size={16}/> Bootstrap</button></div>
      <div className="table">
        <div className="row head"><span>Priority</span><span>Status</span><span>Department</span><span>Title</span><span>Twin</span><span>Action</span></div>
        {work.map(item => <div className="row" key={item.id}>
          <span>{item.priority}</span>
          <span className={`pill ${item.status}`}>{item.status}</span>
          <span>{item.department}</span>
          <span><b>{item.title}</b><small>{item.objective}</small></span>
          <span>{item.assigned_twin}</span>
          <span className="actions">
            {item.status === 'waiting_approval' && <button onClick={() => approve(item.id)}><ShieldAlert size={14}/> Approve</button>}
            {item.status === 'ready' && <button onClick={() => complete(item.id)}><CheckCircle2 size={14}/> Complete</button>}
          </span>
        </div>)}
      </div>
    </section>

    <section className="panel">
      <h2>Segment Inventory</h2>
      <div className="table segments">
        <div className="row head"><span>Priority</span><span>Segment</span><span>Leads</span><span>Verified</span><span>Needs Upload</span><span>Needs Enrichment</span></div>
        {segments.map(s => <div className="row" key={s.id}>
          <span>{s.priority}</span><span>{s.segment_name}</span><span>{s.lead_count}</span><span>{s.verified_email_count}</span><span>{String(s.needs_upload)}</span><span>{String(s.needs_enrichment)}</span>
        </div>)}
      </div>
    </section>
    <footer>API: {health?.data_root || 'not connected'}</footer>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
