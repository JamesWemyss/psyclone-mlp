'use client';
import { useEffect, useState } from 'react';

function Section({ title, children, defaultOpen=false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border: '1px solid #e5e5e5', borderRadius: 10, marginBottom: 12 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', textAlign: 'left', padding: '10px 12px', background: 'white',
        border: 'none', borderBottom: open ? '1px solid #eee' : 'none', borderRadius: open ? '10px 10px 0 0' : 10,
        cursor: 'pointer', fontWeight: 600
      }}>
        {open ? '▾ ' : '▸ '} {title}
      </button>
      {open && <div style={{ padding: 12 }}>{children}</div>}
    </div>
  );
}

function TaskRow({ t, onDone, onTop }) {
  const due = t.due ? new Date(t.due).toLocaleDateString('en-GB', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 8, alignItems: 'center', padding: '6px 0' }}>
      <div>
        <div style={{ fontWeight: 600 }}>{t.title}</div>
        <div style={{ fontSize: 12, color: '#666' }}>
          {t.next_action ? `next: ${t.next_action} · ` : ''}{due ? `due ${due} · ` : ''}score {t.score}
        </div>
      </div>
      <div><span style={{ fontSize: 12, background: '#f4f4f4', padding: '2px 6px', borderRadius: 6 }}>
        {t.goal_id ? 'linked' : 'unlinked'}</span></div>
      <button onClick={() => onTop(t)} style={{ padding: '6px 8px' }}>Make #1</button>
      <button onClick={() => onDone(t)} style={{ padding: '6px 8px' }}>Done</button>
    </div>
  );
}

export default function Home() {
  const [lists, setLists] = useState({ goals: [], personal: [], work: [] });
  const [loading, setLoading] = useState(true);

  const [goalForm, setGoalForm] = useState({ title: '', category: 'overall', target_date: '', why: '' });
  const [taskForm, setTaskForm] = useState({ title: '', category: 'work', due: '', impact: '', energy_fit: '', effort_hours: '', next_action: '' });

  const [chatMsg, setChatMsg] = useState('');
  const [chat, setChat] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const r = await fetch('/api/lists');
    const d = await r.json();
    if (d.ok) setLists(d);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const createGoal = async (e) => {
    e.preventDefault();
    if (!goalForm.title.trim()) return;
    const r = await fetch('/api/goal.create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(goalForm) });
    const d = await r.json();
    if (!d.ok) return alert(d.error || 'Failed to add goal');
    setGoalForm({ title: '', category: 'overall', target_date: '', why: '' });
    load();
  };

  const createTask = async (e) => {
    e.preventDefault();
    if (!taskForm.title.trim()) return;
    const payload = {
      ...taskForm,
      impact: taskForm.impact ? Number(taskForm.impact) : null,
      energy_fit: taskForm.energy_fit ? Number(taskForm.energy_fit) : null,
      effort_hours: taskForm.effort_hours ? Number(taskForm.effort_hours) : null,
      due: taskForm.due || null
    };
    const r = await fetch('/api/task.create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const d = await r.json();
    if (!d.ok) return alert(d.error || 'Failed to add task');
    setTaskForm({ title: '', category: 'work', due: '', impact: '', energy_fit: '', effort_hours: '', next_action: '' });
    load();
  };

  const markDone = async (t) => {
    const r = await fetch('/api/task.complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: t.id }) });
    const d = await r.json();
    if (!d.ok) return alert(d.error || 'Failed');
    load();
  };

  const makeTop = async (t) => {
    const r = await fetch('/api/task.reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: t.id }) });
    const d = await r.json();
    if (!d.ok) return alert(d.error || 'Failed');
    load();
  };

  const sendChat = async (e) => {
    e.preventDefault();
    const m = chatMsg.trim();
    if (!m) return;
    setChatMsg('');
    setBusy(true);
    setChat(c => [...c, { who: 'you', text: m }]);
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: m }) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Failed');
      setChat(c => [...c, { who: 'bot', text: d.reply }]);
      if (d.refresh) load();
    } catch (e2) {
      setChat(c => [...c, { who: 'bot', text: `Error: ${e2.message}` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ maxWidth: 960, margin: '32px auto', padding: '0 16px', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
      <h1 style={{ fontSize: 34, marginBottom: 12 }}>Psyclone — Goals & Priorities</h1>

      <Section title="Overall Life Goals" defaultOpen={false}>
        {loading ? <div>Loading…</div> : (
          <>
            {(lists.goals || []).length === 0 && <div style={{ color: '#666' }}>No goals yet.</div>}
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {(lists.goals || []).map(g => (
                <li key={g.id} style={{ marginBottom: 6 }}>
                  <strong>{g.title}</strong>
                  {g.target_date ? ` — target ${new Date(g.target_date).toLocaleDateString('en-GB')}` : ''}
                  {g.why ? ` — ${g.why}` : ''}
                </li>
              ))}
            </ul>
            <form onSubmit={createGoal} style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 160px 160px 1fr auto', gap: 8 }}>
              <input placeholder="Add a life goal…" value={goalForm.title} onChange={e => setGoalForm({ ...goalForm, title: e.target.value })} />
              <select value={goalForm.category} onChange={e => setGoalForm({ ...goalForm, category: e.target.value })}>
                <option value="overall">overall</option>
                <option value="personal">personal</option>
                <option value="work">work</option>
              </select>
              <input placeholder="Target date (YYYY-MM-DD)" value={goalForm.target_date} onChange={e => setGoalForm({ ...goalForm, target_date: e.target.value })} />
              <input placeholder="Why does this matter?" value={goalForm.why} onChange={e => setGoalForm({ ...goalForm, why: e.target.value })} />
              <button>Add</button>
            </form>
          </>
        )}
      </Section>

      <Section title="Work — Priorities" defaultOpen={true}>
        {loading ? <div>Loading…</div> : (
          <>
            {(lists.work || []).length === 0 && <div style={{ color: '#666' }}>No work priorities yet.</div>}
            {(lists.work || []).map(t => <TaskRow key={t.id} t={t} onDone={markDone} onTop={makeTop} />)}
            <form onSubmit={createTask} style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 120px 140px 90px 90px 100px 1fr auto', gap: 8 }}>
              <input placeholder="Add a work priority…" value={taskForm.title} onChange={e => setTaskForm({ ...taskForm, title: e.target.value, category: 'work' })} />
              <input placeholder="Due (YYYY-MM-DD)" value={taskForm.due} onChange={e => setTaskForm({ ...taskForm, due: e.target.value, category: 'work' })} />
              <input placeholder="Next action" value={taskForm.next_action} onChange={e => setTaskForm({ ...taskForm, next_action: e.target.value, category: 'work' })} />
              <input placeholder="Impact 1-5" value={taskForm.impact} onChange={e => setTaskForm({ ...taskForm, impact: e.target.value, category: 'work' })} />
              <input placeholder="Energy 1-5" value={taskForm.energy_fit} onChange={e => setTaskForm({ ...taskForm, energy_fit: e.target.value, category: 'work' })} />
              <input placeholder="Hours" value={taskForm.effort_hours} onChange={e => setTaskForm({ ...taskForm, effort_hours: e.target.value, category: 'work' })} />
              <div />
              <button>Add</button>
            </form>
          </>
        )}
      </Section>

      <Section title="Personal — Priorities" defaultOpen={true}>
        {loading ? <div>Loading…</div> : (
          <>
            {(lists.personal || []).length === 0 && <div style={{ color: '#666' }}>No personal priorities yet.</div>}
            {(lists.personal || []).map(t => <TaskRow key={t.id} t={t} onDone={markDone} onTop={makeTop} />)}
            <form onSubmit={createTask} style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 120px 140px 90px 90px 100px 1fr auto', gap: 8 }}>
              <input placeholder="Add a personal priority…" value={taskForm.title} onChange={e => setTaskForm({ ...taskForm, title: e.target.value, category: 'personal' })} />
              <input placeholder="Due (YYYY-MM-DD)" value={taskForm.due} onChange={e => setTaskForm({ ...taskForm, due: e.target.value, category: 'personal' })} />
              <input placeholder="Next action" value={taskForm.next_action} onChange={e => setTaskForm({ ...taskForm, next_action: e.target.value, category: 'personal' })} />
              <input placeholder="Impact 1-5" value={taskForm.impact} onChange={e => setTaskForm({ ...taskForm, impact: e.target.value, category: 'personal' })} />
              <input placeholder="Energy 1-5" value={taskForm.energy_fit} onChange={e => setTaskForm({ ...taskForm, energy_fit: e.target.value, category: 'personal' })} />
              <input placeholder="Hours" value={taskForm.effort_hours} onChange={e => setTaskForm({ ...taskForm, effort_hours: e.target.value, category: 'personal' })} />
              <div />
              <button>Add</button>
            </form>
          </>
        )}
      </Section>

      <Section title="Chat with Psyclone" defaultOpen={true}>
        <div style={{ minHeight: 120 }}>
          {chat.length === 0 && <div style={{ color: '#666' }}>Try: “Add a life goal: Build a personal brand by 2026”, “Add a work task: Finish Bunzl hero by Friday (impact 5, 2h)”, “Make Bunzl hero #1”, or “What should I focus on today?”</div>}
          {chat.map((m, i) => (
            <div key={i} style={{ display: 'flex', marginBottom: 8 }}>
              <div style={{ width: 80, fontWeight: 600, color: m.who === 'you' ? '#333' : '#0070f3' }}>
                {m.who === 'you' ? 'You' : 'Psyclone'}
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
            </div>
          ))}
        </div>
        <form onSubmit={sendChat} style={{ display: 'flex', gap: 8 }}>
          <input value={chatMsg} onChange={e => setChatMsg(e.target.value)} placeholder="Type something…" style={{ flex: 1, padding: 12, border: '1px solid #ccc', borderRadius: 8 }} />
          <button disabled={busy || !chatMsg.trim()} style={{ padding: '12px 18px' }}>{busy ? 'Working…' : 'Send'}</button>
        </form>
      </Section>
    </main>
  );
}
