'use client';
import { useState } from 'react';

export default function Home() {
  const [msg, setMsg] = useState('');
  const [status, setStatus] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!msg.trim()) return;
    setLoading(true);
    setStatus(''); setItems([]);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.reason || 'Failed');

      if (data.type === 'saved') {
        setStatus(`Saved ✅ ${data.summary || ''}`);
      } else if (data.type === 'results') {
        if (data.count === 0) setStatus('No matches.');
        else setStatus(`Found ${data.count} item(s):`);
        setItems(data.items || []);
      } else if (data.type === 'no-save') {
        setStatus(`Not saved: ${data.reason || ''}`);
      } else if (data.type === 'no-action') {
        setStatus('Not a save or search. (We can add small talk later.)');
      } else {
        setStatus('OK');
      }
      setMsg('');
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const ignoreLast = async () => {
    setLoading(true);
    setStatus(''); setItems([]);
    try {
      const res = await fetch('/api/ignore-last', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.reason || 'Failed to ignore');
      setStatus(`Ignored ✅ ${data.summary || ''}`);
    } catch (e) {
      setStatus(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ maxWidth: 720, margin: '40px auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 44, marginBottom: 16 }}>Psyclone (MLP)</h1>
      <form onSubmit={submit} style={{ display: 'flex', gap: 8 }}>
        <input
          style={{ flex: 1, padding: 12, border: '1px solid #ccc', borderRadius: 8 }}
          placeholder="Tell Psyclone something… or ask a question"
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
        />
        <button disabled={loading || !msg.trim()} style={{ padding: '12px 18px' }}>
          {loading ? 'Working…' : 'Send'}
        </button>
      </form>

      <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
        <button onClick={ignoreLast}>Ignore last</button>
      </div>

      <p style={{ marginTop: 16 }}>{status}</p>

      {items.length > 0 && (
        <ul style={{ marginTop: 8, paddingLeft: 18 }}>
          {items.map((it) => (
            <li key={it.id} style={{ marginBottom: 8 }}>
              <strong>[{it.kind}]</strong> {it.content}
              {it.happened_at ? ` — ${new Date(it.happened_at).toLocaleString()}` : ''}
              {it.person_names?.length ? ` — people: ${it.person_names.join(', ')}` : ''}
              {it.category ? ` — ${it.category}` : ''}
            </li>
          ))}
        </ul>
      )}

      <p style={{ marginTop: 24, fontSize: 12, color: '#666' }}>
        Tip: try “show entries from yesterday”, “Tatton this month”, or “things about Helena”.
      </p>
    </main>
  );
}
