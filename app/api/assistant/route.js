export const runtime = 'nodejs';

import OpenAI from 'openai';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function sb(path, method = 'GET', body) {
  const res = await fetch(`${process.env.SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'return=representation' : undefined,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || res.statusText);
  try { return JSON.parse(text); } catch { return text; }
}

export async function POST(req) {
  try {
    const { message } = await req.json();
    if (!message || typeof message !== 'string') {
      return Response.json({ reply: 'Please send a message.' }, { status: 200 });
    }
    if (!process.env.ASSISTANT_ID) throw new Error('Missing ASSISTANT_ID');

    const thread = await openai.beta.threads.create();
    await openai.beta.threads.messages.create(thread.id, { role: 'user', content: message });
    let run = await openai.beta.threads.runs.create(thread.id, { assistant_id: process.env.ASSISTANT_ID });

    const start = Date.now();
    while (true) {
      if (Date.now() - start > 45_000) throw new Error('Assistant timed out');
      run = await openai.beta.threads.runs.retrieve(thread.id, run.id);

      if (run.status === 'requires_action') {
        const calls = run.required_action?.submit_tool_outputs?.tool_calls || [];
        const outputs = [];

        for (const call of calls) {
          const name = call.function.name;
          let args = {};
          try { args = JSON.parse(call.function.arguments || '{}'); } catch {}

          if (name === 'save_document') {
            const payload = {
              kind: args.kind,
              content: args.content,
              body: args.body || null,
              happened_at: args.happened_at || null,
              place: args.place || null,
              person_names: Array.isArray(args.person_names) ? args.person_names : [],
              source: 'assistant'
            };
            const ins = await sb('/rest/v1/documents', 'POST', payload);
            const id = Array.isArray(ins) ? ins[0]?.id : ins?.id;
            outputs.push({ tool_call_id: call.id, output: JSON.stringify({ ok: true, id }) });

          } else if (name === 'create_goal') {
            const payload = {
              title: args.title,
              category: args.category || 'overall',
              why: args.why || '',
              target_date: args.target_date || null
            };
            const ins = await sb('/rest/v1/goals', 'POST', payload);
            const id = Array.isArray(ins) ? ins[0]?.id : ins?.id;
            outputs.push({ tool_call_id: call.id, output: JSON.stringify({ ok: true, id }) });

          } else if (name === 'create_task') {
            const payload = {
              title: args.title,
              category: args.category,
              due: args.due || null,
              impact: args.impact ?? null,
              energy_fit: args.energy_fit ?? null,
              effort_hours: args.effort_hours ?? null,
              next_action: args.next_action || null
            };
            const ins = await sb('/rest/v1/tasks', 'POST', payload);
            const id = Array.isArray(ins) ? ins[0]?.id : ins?.id;
            outputs.push({ tool_call_id: call.id, output: JSON.stringify({ ok: true, id }) });

          } else if (name === 'search_documents') {
            const limit = Math.min(Math.max(args.limit || 10, 1), 25);
            const parts = [
              'select=id,kind,content,happened_at,place',
              `limit=${limit}`,
              'order=recorded_at.desc',
              'is_ignored=is.false',
            ];
            const kws = Array.isArray(args.keywords) ? args.keywords.filter(Boolean) : [];
            if (kws.length) {
              const or = kws.slice(0, 4).flatMap(k => [
                `content.ilike.*${encodeURIComponent(k)}*`,
                `place.ilike.*${encodeURIComponent(k)}*`
              ]).join(',');
              parts.push(`or=(${or})`);
            }
            if (args.date_from) parts.push(`happened_at=gte.${encodeURIComponent(args.date_from)}`);
            if (args.date_to)   parts.push(`happened_at=lte.${encodeURIComponent(args.date_to)}`);

            const qs = parts.join('&');
            const rows = await sb(`/rest/v1/documents?${qs}`, 'GET');
            outputs.push({ tool_call_id: call.id, output: JSON.stringify({ ok: true, rows }) });

          } else {
            outputs.push({ tool_call_id: call.id, output: JSON.stringify({ ok: false, reason: 'unknown_tool' }) });
          }
        }

        await openai.beta.threads.runs.submitToolOutputs(thread.id, run.id, { tool_outputs: outputs });

      } else if (run.status === 'completed') {
        const msgs = await openai.beta.threads.messages.list(thread.id, { order: 'desc', limit: 5 });
        const reply =
          msgs.data.find((m) => m.role === 'assistant')?.content?.[0]?.text?.value?.trim() ||
          'OK.';
        return Response.json({ reply });
      } else if (['failed','cancelled','expired'].includes(run.status)) {
        throw new Error(`Run ${run.status}${run.last_error ? ': ' + run.last_error.message : ''}`);
      } else {
        await new Promise(r => setTimeout(r, 600));
      }
    }
  } catch (e) {
    return Response.json({ reply: `Error: ${e.message}` }, { status: 200 });
  }
}
