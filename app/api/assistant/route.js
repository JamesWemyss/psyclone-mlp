export const runtime = 'nodejs';

import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

// ───── helpers ───────────────────────────────────────────────
function sb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase envs');
  return createClient(url, key);
}
function oa() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('Missing OPENAI_API_KEY');
  return new OpenAI({ apiKey: key });
}
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

// ───── tool executors ────────────────────────────────────────
async function saveDocument(args) {
  const s = sb();
  const insert = {
    kind: args.kind || 'note',
    content: args.content?.slice(0, 180) || 'Untitled',
    body: args.body || null,
    happened_at: args.happened_at || null,
    place: args.place || null,
    person_names: Array.isArray(args.person_names) ? args.person_names : [],
    category: args.category || null,
    amount: args.amount ?? null,
    is_ignored: false,
    recorded_at: new Date().toISOString(),
    source: 'assistant'
  };
  const { error } = await s.from('documents').insert(insert);
  if (error) throw error;
  return 'ok';
}

async function createGoal(args) {
  const s = sb();
  const row = {
    title: args.title,
    category: args.category || 'overall',
    why: args.why || null,
    target_date: args.target_date || null
  };
  const { error } = await s.from('goals').insert(row);
  if (error) throw error;
  return 'ok';
}

async function createTask(args) {
  const s = sb();
  const row = {
    title: args.title,
    category: args.category, // work|personal required by tool schema
    goal_id: args.goal_id || null,
    next_action: args.next_action || null,
    due: args.due || null,
    impact: args.impact ?? null,
    energy_fit: args.energy_fit ?? null,
    effort_hours: args.effort_hours ?? null
  };
  const { error } = await s.from('tasks').insert(row);
  if (error) throw error;
  return 'ok';
}

async function searchDocuments(args) {
  const s = sb();
  let q = s
    .from('v_documents_search')
    .select('id, kind, content, place, happened_at, recorded_at')
    .order('happened_at', { ascending: false })
    .limit(Math.min(Math.max(args.limit || 10, 1), 20));

  if (args.date_from) q = q.gte('happened_at', args.date_from);
  if (args.date_to) q = q.lte('happened_at', args.date_to);

  // keyword ORs across content/body/place
  const kws = Array.isArray(args.keywords) ? args.keywords : [];
  if (kws.length) {
    const ors = [];
    for (const k of kws) {
      const like = `%${k}%`;
      ors.push(`content.ilike.${like}`, `body.ilike.${like}`, `place.ilike.${like}`);
    }
    q = q.or(ors.join(','));
  }

  const { data, error } = await q;
  if (error) throw error;

  // Short markdown summary for the chat
  const items = (data || []).map(d => {
    const when = d.happened_at || d.recorded_at;
    const place = d.place ? ` — **Place:** ${d.place}` : '';
    return `- **${d.content}**\n  **When:** ${when}${place}`;
  });
  return items.length ? items.join('\n') : 'No matches.';
}

// NEW: create/update a contact (and relation)
async function upsertContact(args) {
  const s = sb();
  const full_name = (args.full_name || '').trim();
  if (!full_name) throw new Error('full_name required');

  // find by lower(full_name)
  const { data: found, error: findErr } = await s
    .from('contacts')
    .select('id')
    .eq('full_name', full_name)
    .maybeSingle();
  if (findErr) throw findErr;

  if (found?.id) {
    // update
    const { error: updErr } = await s.from('contacts').update({
      preferred_name: args.preferred_name ?? null,
      email: args.email ?? null,
      phone: args.phone ?? null,
      notes: args.notes ?? null
    }).eq('id', found.id);
    if (updErr) throw updErr;

    if (args.relation) {
      // upsert relation
      const { error: relErr } = await s
        .from('contacts_to_user')
        .upsert({ contact_id: found.id, relation: args.relation }, { onConflict: 'contact_id' });
      if (relErr) throw relErr;
    }
  } else {
    // insert then relation
    const { data: ins, error: insErr } = await s
      .from('contacts')
      .insert({
        full_name,
        preferred_name: args.preferred_name ?? null,
        email: args.email ?? null,
        phone: args.phone ?? null,
        notes: args.notes ?? null
      })
      .select('id')
      .single();
    if (insErr) throw insErr;

    if (args.relation) {
      const { error: relErr } = await s
        .from('contacts_to_user')
        .upsert({ contact_id: ins.id, relation: args.relation }, { onConflict: 'contact_id' });
      if (relErr) throw relErr;
    }
  }
  return `ok`;
}

// NEW: add a key date (e.g., birthday) for a contact
async function addContactKeyDate(args) {
  const s = sb();
  const full_name = (args.full_name || '').trim();
  if (!full_name) throw new Error('full_name required');

  // ensure contact exists
  let { data: contact, error: findErr } = await s
    .from('contacts')
    .select('id')
    .eq('full_name', full_name)
    .maybeSingle();
  if (findErr) throw findErr;

  if (!contact?.id) {
    const { data: ins, error: insErr } = await s
      .from('contacts')
      .insert({ full_name })
      .select('id')
      .single();
    if (insErr) throw insErr;
    contact = ins;
  }

  const row = {
    contact_id: contact.id,
    kind: args.kind,          // 'birthday' | 'anniversary' | 'other'
    the_date: args.the_date,  // YYYY-MM-DD
    label: args.label ?? null
  };
  const { error } = await s.from('contact_key_dates').insert(row);
  if (error) throw error;
  return 'ok';
}

// Route tool → executor
async function executeToolCall(name, args) {
  switch (name) {
    case 'save_document':          return await saveDocument(args);
    case 'create_goal':            return await createGoal(args);
    case 'create_task':            return await createTask(args);
    case 'search_documents':       return await searchDocuments(args);
    case 'upsert_contact':         return await upsertContact(args);
    case 'add_contact_key_date':   return await addContactKeyDate(args);
    default:
      return `unsupported tool: ${name}`;
  }
}

// ───── main POST handler (Assistants v2 run loop) ────────────
export async function POST(req) {
  try {
    const { message } = await req.json();
    if (!message) return Response.json({ ok: false, reason: 'No message' }, { status: 400 });

    const openai = oa();
    // 1) create thread
    const thread = await openai.beta.threads.create();
    await openai.beta.threads.messages.create(thread.id, { role: 'user', content: message });

    // 2) run with our Assistant
    let run = await openai.beta.threads.runs.create(thread.id, { assistant_id: ASSISTANT_ID });

    // 3) loop: handle tool calls until complete
    for (;;) {
      run = await openai.beta.threads.runs.retrieve(thread.id, run.id);

      if (run.status === 'requires_action') {
        const toolOutputs = [];
        for (const tc of run.required_action.submit_tool_outputs.tool_calls) {
          const name = tc.function.name;
          const args = JSON.parse(tc.function.arguments || '{}');
          const result = await executeToolCall(name, args).catch(e => `error: ${e.message}`);
          toolOutputs.push({ tool_call_id: tc.id, output: String(result) });
        }
        await openai.beta.threads.runs.submitToolOutputs(thread.id, run.id, { tool_outputs: toolOutputs });
        continue;
      }

      if (['completed', 'failed', 'cancelled', 'expired'].includes(run.status)) break;
      await new Promise(r => setTimeout(r, 600)); // small poll
    }

    // 4) collect latest assistant message(s)
    const msgs = await openai.beta.threads.messages.list(thread.id, { limit: 5 });
    const texts = [];
    for (const m of msgs.data) {
      if (m.role === 'assistant') {
        const chunk = m.content?.map(c => c.text?.value).filter(Boolean).join('\n').trim();
        if (chunk) texts.push(chunk);
      }
    }
    return Response.json({ ok: true, reply: texts.reverse().join('\n\n') || 'OK' });
  } catch (e) {
    return Response.json({ ok: false, reason: e.message || 'Unknown error' }, { status: 500 });
  }
}
