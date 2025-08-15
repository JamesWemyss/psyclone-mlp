'use client';
import { useState } from 'react';

export default function Home() {
  const [chat, setChat] = useState([
    { who: 'Psyclone', text: 'Hi James — talk to me. I’ll save events, add goals/tasks, and answer questions.' }
  ]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(text) {
    if (!text.trim()) return;
    setChat(c => [...c, { who: 'You', text }]);
    setMsg('');
    setBusy(true);
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      const data = await res.json();
      setChat(c => [...c, { who: 'Psyclone', text: data.reply || 'OK.' }]);
    } catch (e) {
      setChat(c => [...c, { who: 'Psyclone', text: `Error: ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 760, margin: '40px auto', padding: '0 16px', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
      <h1 style={{ fontSize: 34, marginBottom: 12 }}>Psyclone — Chat</h1>

      <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
        {chat.map((m, i) => (
          <div key={i} style={{ display: 'flex' }}>
            <div style={{ width: 90, fontWeight: 600, color: m.who === 'You' ? '#333' : '#0070f3' }}>{m.who}</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
          </div>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); send(msg); }} style={{ display: 'flex', gap: 8 }}>
        <input
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          placeholder="Type anything…"
          style={{ flex: 1, padding: 12, border: '1px solid #ccc', borderRadius: 8 }}
        />
        <button disabled={busy || !msg.trim()} style={{ padding: '12px 18px' }}>
          {busy ? 'Working…' : 'Send'}
        </button>
      </form>

      <p style={{ marginTop: 10, color: '#666', fontSize: 12 }}>
        Try: “I had a walk with mum yesterday in Tatton at noon”, “Add a life goal: Build a personal brand by 2026”, “Add a work priority…”.
      </p>
    </main>
  );
}
