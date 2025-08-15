// app/api/assistant/route.js
export const runtime = 'nodejs';

import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

/* ──────────────────────────
   Clients
   ────────────────────────── */
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
function getAssistantId() {
  const id = process.env.OPENAI_ASSISTANT_ID;
  if (!id) throw new Error('Missing OPENAI_ASSISTANT_ID');
  return id;
}

/* ──────────────────────────
   DB actions (docs/goals/tasks)
   ────────────────────────── */
async function saveDocument(args) {
  const payload = {
    kind: args.kind || 'note',
    content: args.content || '',
    body: args.body || null,
    happened_at: args.happened_at || null,
    place: args.place || null,
    person_names: Array.isArray(args.person_names) ? args.person_names : [],
    amount: args.amount ?? null,
    category: args.category || 'other',
    source: 'assistant',
  };
  const { data, error } = await sb().from('documents').insert(payload).select().single();
  if (error) throw error;
  return { ok: true, id: data.id, summary: data.content };
}

async function createGoal(args) {
  const payload = {
    title: args.title,
    category: args.category || 'overall', // overall | work | personal
    why: args.why || null,
    target_date: args.target_date || null,
  };
  const { data, error } = await sb().from('goals').insert(payload).select().single();
  if (error) throw error;
  return { ok: true, id: data.id, title: data.title };
}

async function createTask(args) {
  const payload = {
    title: args.title,
    category: args.category, // work | personal (required)
    goal_id: args.goal_id || null,
    next_action: args.next_action || null,
    due: args.due || null,
    impact: args.impact ?? null,
    energy_fit: args.energy_fit ?? null,
    effort_hours: args.effort_hours ?? null,
  };
  const { data, error } = await sb().from('tasks').insert(payload).select().single();
  if (error) throw error;
  return { ok: true, id: data.id, title: data.title };
}

async function searchDocuments(args) {
  const {
    keywords = [],
    person_names = [],
    kind = '',
    date_from = '',
    date_to = '',
    limit = 10,
  } = args || {};

  const supabase = sb();
  let q = supabase
    .from('v_documents_search')
    .select('id, kind, content, place, event_time, recorded_at, category, person_names')
    .eq('is_ignored', false)
    .order('event_time', { ascending: false })
    .limit(Math.min(Math.max(limit || 10, 1), 50));

  if (kind) q = q.eq('kind', kind);
  if (date_from) q = q.gte('event_time', date_from);
  if (date_to) q = q.lte('event_time', date_to);
  if (person_names?.length) q = q.contains('person_names', person_names);

  if (keywords?.length) {
    const ors = [];
    for (const k of keywords) {
      const like = `%${k}%`;
      ors.push(`content.ilike.${like}`, `body.ilike.${like}`, `place.ilike.${like}`);
    }
    q = q.or(ors.join(','));
  }

  const { data, error } = await q;
  if (error) throw error;
  return { count: data.length, items: data };
}

/* ──────────────────────────
   Contacts (People & Relationships)
   ────────────────────────── */
async function upsertContact(args) {
  const { full_name, preferred_name = null, relation = null, email = null, phone = null } = args;

  if (!full_name || typeof full_name !== 'string') {
    throw new Error('full_name is required');
  }

  // 1) Upsert contact by full_name (case-insensitive unique index recommended)
  const { data: found, error: findErr } = await sb()
    .from('contacts')
    .select('id')
    .eq('full_name', full_name)
    .maybeSingle();
  if (findErr) throw findErr;

  let contactId = found?.id;
  if (!contactId) {
    const { data: created, error: createErr } = await sb()
      .from('contacts')
      .insert({ full_name, preferred_name, email, phone })
      .select()
      .single();
    if (createErr) throw createErr;
    contactId = created.id;
  } else {
    // Update light fields if provided
    const updates = {};
    if (preferred_name !== null) updates.preferred_name = preferred_name;
    if (email !== null) updates.email = email;
    if (phone !== null) updates.phone = phone;
    if (Object.keys(updates).length) {
      const { error: updErr } = await sb().from('contacts').update(updates).eq('id', contactId);
      if (updErr) throw updErr;
    }
  }

  // 2) Relation (optional)
  if (relation) {
    const { data: rel, error: relErr } = await sb()
      .from('contacts_to_user')
      .select('contact_id')
      .eq('contact_id', contactId)
      .maybeSingle();
    if (relErr) throw relErr;

    if (!rel) {
      const { error: insRelErr } = await sb()
        .from('contacts_to_user')
        .insert({ contact_id: contactId, relation });
      if (insRelErr) throw insRelErr;
    } else {
      const { error: updRelErr } = await sb()
        .from('contacts_to_user')
        .update({ relation })
        .eq('contact_id', contactId);
      if (updRelErr) throw updRelErr;
    }
  }

  return { ok: true, id: contactId, full_name, relation: relation || null };
}

async function addContactKeyDate(args) {
  // Accept either a direct contact_id or a name to look up
  let { contact_id, full_name, kind = 'other', label = null, the_date } = args;

  if (!contact_id) {
    if (!full_name) throw new Error('Provide contact_id or full_name');
    const { data: c, error: e } = await sb()
      .from('contacts')
      .select('id')
      .eq('full_name', full_name)
      .maybeSingle();
    if (e) throw e;
    if (!c?.id) throw new Error('Contact not found by full_name');
    contact_id = c.id;
  }
  if (!the_date) throw new Error('the_date (YYYY-MM-DD) is required');

  const { data, error } = await sb()
    .from('contact_key_dates')
    .insert({ contact_id, kind, label, the_date })
    .select()
    .single();
  if (error) throw error;
  return { ok: true, id: data.id, contact_id: data.contact_id, kind: data.kind, the_date: data.the_date };
}

/* ▶ NEW: search_contacts wired to v_contacts */
async function searchContacts(args) {
  const { name_contains = null, relation = null, limit = 10 } = args || {};
  const max = Math.min(Math.max(limit || 10, 1), 50);

  let q = sb()
    .from('v_contacts')
    .select('id, full_name, preferred_name, relation, birthday')
    .limit(max);

  if (name_contains) q = q.ilike('full_name', `%${name_contains}%`);
  if (relation) q = q.eq('relation', relation);

  const { data, error } = await q;
  if (error) throw error;
  return { count: data.length, items: data };
}

/* ──────────────────────────
   Tool dispatch
   ────────────────────────── */
async function callToolByName(name, args) {
  switch (name) {
    case 'save_document':        return await saveDocument(args);
    case 'create_goal':          return await createGoal(args);
    case 'create_task':          return await createTask(args);
    case 'search_documents':     return await searchDocuments(args);
    case 'upsert_contact':       return await upsertContact(args);
    case 'add_contact_key_date': return await addContactKeyDate(args);
    case 'search_contacts':      return await searchContacts(args); // ⬅️ NEW
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/* ──────────────────────────
   Chat entrypoint
   ────────────────────────── */
export async function POST(req) {
  try {
    const { message } = await req.json();
    if (!message || typeof message !== 'string') {
      return Response.json({ ok: false, reason: 'No message' }, { status: 400 });
    }

    const openai = oa();
    const assistant_id = getAssistantId();

    // Running input list we’ll append to as tools fire
    let input = [{ role: 'user', content: message }];

    let finalResponse = null;
    let safetyCounter = 0;

    // Loop: let the model call tools; we execute; we send outputs back; repeat
    while (true) {
      if (++safetyCounter > 6) throw new Error('Too many tool-call turns');

      let resp = await openai.responses.create({
        assistant_id,
        input,
      });

      // Keep entire output (needed by API when reasoning items are present)
      input = input.concat(resp.output);

      // Collect tool calls
      const toolCalls = resp.output.filter((x) => x.type === 'function_call');

      if (toolCalls.length === 0) {
        finalResponse = resp;
        break;
      }

      // Execute each call, push function_call_output items
      for (const tc of toolCalls) {
        const name = tc.name;
        const call_id = tc.call_id;
        let args = {};
        try { args = JSON.parse(tc.arguments || '{}'); } catch { args = {}; }

        let result;
        try {
          result = await callToolByName(name, args);
        } catch (e) {
          result = { ok: false, error: String(e.message || e) };
        }

        input.push({
          type: 'function_call_output',
          call_id,
          output: JSON.stringify(result),
        });
      }
    }

    const text = finalResponse?.output_text || 'OK';
    return Response.json({ ok: true, reply: text });

  } catch (e) {
    console.error('assistant route error:', e);
    return Response.json({ ok: false, reason: e.message || 'Unknown error' }, { status: 500 });
  }
}
