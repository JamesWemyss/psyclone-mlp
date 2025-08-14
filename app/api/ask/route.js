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

/** Router prompt */
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
    keywords: [string,...],          // short keywords from the question
    person_names: [string,...],      // names if any
    kind: "event|fact|note|task" or "" ,
    date_from: ISO date or "",       // inclusive
    date_to: ISO date or "",         // inclusive
    limit: number <= 20              // default 10
  }

Output STRICT JSON:
{ "intent": "SAVE|SEARCH|NONE", "save": {...} or null, "search": {...} or null }
Rules:
- Only SAVE if confidence >= 0.75.
- Europe/London when resolving relative dates ("yesterday 6pm").
- Do not invent people or amounts.`;

export async function POST(req) {
  try {
    const { message } = await req.json();
    if (!message || typeof message !== 'string') {
      return Response.json({ ok: false, reason: 'No message' }, { status: 400 });
    }

    // Classify
    const openai = oa();
    const chat = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: message }],
      response_format: { type: 'json_object' },
    });
    const raw = chat.choices?.[0]?.message?.content ?? '{}';
    let parsed = {};
    try { parsed = JSON.parse(raw); } catch {}

    const intent = parsed.intent || 'NONE';

    // SAVE flow
    if (intent === 'SAVE' && parsed.save) {
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
      } = parsed.save;

      if (confidence < 0.75) {
        return Response.json({ type: 'no-save', reason: 'Low confidence' });
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
    if (intent === 'SEARCH' && parsed.search) {
      const supabase = sb();
      const {
        keywords = [],
        person_names = [],
        kind = '',
        date_from = '',
        date_to = '',
        limit = 10,
      } = parsed.search;

      let query = supabase
        .from('documents')
        .select('id, kind, content, happened_at, category, person_names')
        .eq('is_ignored', false)
        .order('recorded_at', { ascending: false })
        .limit(Math.min(Math.max(limit || 10, 1), 20));

      if (kind) query = query.eq('kind', kind);
      if (date_from) query = query.gte('happened_at', date_from);
      if (date_to) query = query.lte('happened_at', date_to);
      if (person_names?.length) query = query.contains('person_names', person_names);

      // simple keyword OR across content/body/place
      if (keywords?.length) {
        const parts = [];
        for (const k of keywords) {
          const like = `%${k}%`;
          parts.push(`content.ilike.${like}`, `body.ilike.${like}`, `place.ilike.${like}`);
        }
        query = query.or(parts.join(','));
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
