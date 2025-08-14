export const runtime = 'nodejs';

import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

/** Helpers */
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

/** Quick heuristic router for obvious questions */
function quickSearchParse(message) {
  const m = message.trim().toLowerCase();

  const isQuery =
    /\b(show|list|find|search|entries?)\b/.test(m) ||
    /\b(when|what|where|who|did i|have i|how many)\b/.test(m) ||
    m.includes('?');

  if (!isQuery) return null;

  const now = new Date();
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
  const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

  let date_from = '';
  let date_to = '';

  if (m.includes('today')) {
    date_from = startOfDay(now).toISOString();
    date_to = endOfDay(now).toISOString();
  } else if (m.includes('yesterday')) {
    const y = new Date(now); y.setDate(now.getDate() - 1);
    date_from = startOfDay(y).toISOString();
    date_to = endOfDay(y).toISOString();
  } else if (m.includes('this month')) {
    date_from = startOfMonth(now).toISOString();
    date_to = endOfMonth(now).toISOString();
  } else if (m.includes('last month')) {
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    date_from = startOfMonth(lm).toISOString();
    date_to = endOfMonth(lm).toISOString();
  } else if (m.includes('this week')) {
    const d = new Date(now);
    const day = (d.getDay() + 6) % 7; // Mon=0
    const mon = new Date(d); mon.setDate(d.getDate() - day);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    date_from = startOfDay(mon).toISOString();
    date_to = endOfDay(sun).toISOString();
  } else if (m.includes('last week')) {
    const d = new Date(now);
    const day = (d.getDay() + 6) % 7;
    const mon = new Date(d); mon.setDate(d.getDate() - day - 7);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    date_from = startOfDay(mon).toISOString();
    date_to = endOfDay(sun).toISOString();
  }

  // crude keywords: words >2 chars, strip stop-words
  const stop = new Set(['show','list','find','search','entries','entry','this','last','week','month','today','yesterday','the','a','an','of','at','in','with','for','to','and','or','me','my','did','i','what','when','where','who','how','many']);
  const keywords = m.split(/[^a-z0-9]+/).filter(w => w.length > 2 && !stop.has(w));

  return {
    intent: 'SEARCH',
    search: {
      keywords,
      person_names: [],
      kind: '',
      date_from,
      date_to,
      limit: 10
    }
  };
}

/** LLM router prompt (used when not obviously a query) */
const SYSTEM = `You are Psyclone's router.
Decide INTENT for the user's message:
- "SAVE" if it's a durable note/event/fact/task we should store.
- "SEARCH" if it's a question requesting items from memory.
- Otherwise "NONE".

When INTENT="SAVE", return:
  save: {
    kind: "event|fact|note|task",
    content: string,
    body: string or "",
    happened_at: ISO8601 string or "",
    place: string or "",
    amount: number or null,
    category: "work|health|finance|places|personal|other",
    person_names: [string, ...],
    confidence: number 0..1
  }

When INTENT="SEARCH", return:
  search: {
    keywords: [string,...],
    person_names: [string,...],
    kind: "event|fact|note|task" or "" ,
    date_from: ISO date or "",
    date_to: ISO date or "",
    limit: number <= 20
  }

Output STRICT JSON:
{ "intent": "SAVE|SEARCH|NONE", "save": {...} or null, "search": {...} or null }

Rules:
- If the message begins with or contains words like "show", "list", "find", "search", "entries", or is clearly a question ("when did I", "what did I", "where did I", "?"), classify as SEARCH.
- Only SAVE if confidence >= 0.75.
- Europe/London when resolving relative dates ("yesterday 6pm").
- Do not invent people or amounts.`;

export async function POST(req) {
  try {
    const { message } = await req.json();
    if (!message || typeof message !== 'string') {
      return Response.json({ ok: false, reason: 'No message' }, { status: 400 });
    }

    // 1) Heuristic: obvious questions => SEARCH
    const quick = quickSearchParse(message);
    let intent, payload;
    if (quick) {
      intent = quick.intent;
      payload = quick;
    } else {
      // 2) Fall back to LLM router
      const openai = oa();
      const chat = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: message }],
        response_format: { type: 'json_object' },
      });
      const raw = chat.choices?.[0]?.message?.content ?? '{}';
      try { payload = JSON.parse(raw); } catch { payload = { intent: 'NONE' }; }
      intent = payload.intent || 'NONE';
    }

    // SAVE flow
    if (intent === 'SAVE' && payload.save) {
      const {
        kind = 'note',
        content = '',
        body = '',
        happened_at = '',
        place = '',
        amount = null,
        category = 'other',
        person_names = [],
        confidence = 0,
      } = payload.save;

      if (confidence < 0.75) {
        return Response.json({ type: 'no-save', reason: 'Not saveworthy' });
      }

      const insert = {
        kind,
        content: content || message.slice(0, 180),
        body: body || null,
        happened_at: happened_at || null,
        place: place || null,
        amount,
        category,
        person_names,
        confidence,
        source: 'web',
      };

      const { data, error } = await sb().from('documents').insert(insert).select().single();
      if (error) throw error;
      return Response.json({ type: 'saved', id: data.id, summary: data.content });
    }

    // SEARCH flow
    if (intent === 'SEARCH' && (payload.search || payload.intent === 'SEARCH')) {
      const supabase = sb();
      const {
        keywords = [],
        person_names = [],
        kind = '',
        date_from = '',
        date_to = '',
        limit = 10,
      } = (payload.search || {});

      let query = supabase
        .from('documents')
        .select('id, kind, content, place, happened_at, category, person_names')
        .eq('is_ignored', false)
        .order('recorded_at', { ascending: false })
        .limit(Math.min(Math.max(limit || 10, 1), 20));

      if (kind) query = query.eq('kind', kind);
      if (date_from) query = query.gte('happened_at', date_from);
      if (date_to) query = query.lte('happened_at', date_to);
      if (person_names?.length) query = query.contains('person_names', person_names);

      if (keywords?.length) {
        const ors = [];
        for (const k of keywords) {
          const like = `%${k}%`;
          ors.push(`content.ilike.${like}`, `body.ilike.${like}`, `place.ilike.${like}`);
        }
        query = query.or(ors.join(','));
      }

      const { data, error } = await query;
      if (error) throw error;
      return Response.json({ type: 'results', count: data.length, items: data });
    }

    return Response.json({ type: 'no-action', reason: 'Just chat' });
  } catch (e) {
    return Response.json({ ok: false, reason: e.message || 'Unknown error' }, { status: 500 });
  }
}
