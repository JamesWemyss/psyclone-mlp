'use client';
import { useState } from 'react';

export default function Home() {
  const [msg, setMsg] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!msg.trim()) return;
    setLoading(true);
    setStatus('');
    try {
      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.reason || 'Failed');
      setStatus(data.saved ? `Saved ✅ ${data.summary || ''}` : `Not saved: ${data.reason || ''}`);
      setMsg('');
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const ignoreLast = async () => {
    setLoading(true);
    setStatus('');
    try {
      const res = await fetch('/api/ignore-last', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.reason || 'Failed to ignore');
      setStatus(`Ignored ✅ ${data.summary || ''}`);
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ maxWidth: 640, margin: '40px auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Psyclone (MLP)</h1>
      <form onSubmit={submit} style={{ display: 'flex', gap: 8 }}>
        <input
          style={{ flex: 1, padding: 10, border: '1px solid #ccc', borderRadius: 6 }}
          placeholder="Tell Psyclone something…"
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
        />
        <button disabled={loading || !msg.trim()} style={{ padding: '10px 16px' }}>
          {loading ? 'Working…' : 'Send'}
        </button>
      </form>
      <button onClick={ignoreLast} style={{ marginTop: 10 }}>Ignore last</button>
      <p style={{ marginTop: 14, color: '#333' }}>{status}</p>
      <p style={{ marginTop: 24, fontSize: 12, color: '#666' }}>
        Tip: say “off the record” to pause saving (we’ll wire session pause soon).
      </p>
    </main>
  );
}
