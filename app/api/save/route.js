export const runtime = 'nodejs';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SYSTEM = `You are Psyclone. Decide if the user's message is SAVEWORTHY.
SAVEWORTHY if it contains a durable fact, event, place, person, money amount, or a commitment/goal.
Return ONLY strict JSON in this schema:
{
  "saveworthy": true|false,
  "confidence": number,
  "kind": "event|fact|note|task",
  "content": "one-sentence summary",
  "body": "optional longer text or empty",
  "happened_at": "ISO datetime or empty",
  "place": "string or empty",
  "amount": number|null,
  "category": "work|health|finance|places|personal|other",
  "person_names": ["Name", ...]
}
Rules:
- saveworthy must be false if confidence < 0.75.
- Use ISO 8601 in Europe/London when parsing relative dates (e.g., "yesterday 18:00").
- Do not invent amounts or people.`;

export async function POST(request) {
  try {
    const { message } = await request.json();
    if (!message || typeof message !== 'string') {
      return Response.json({ saved: false, reason: 'No message' }, { status: 400 });
    }

    const chat = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: message }
      ],
      response_format: { type: 'json_object' }
    });

    const raw = chat.choices?.[0]?.message?.content ?? '{}';
    let parsed = {};
    try { parsed = JSON.parse(raw); } catch { /* ignore */ }

    const {
      saveworthy = false,
      confidence = 0,
      kind = 'note',
      content = '',
      body = '',
      happened_at = '',
      place = '',
      amount = null,
      category = 'other',
      person_names = []
    } = parsed;

    if (!saveworthy || confidence < 0.75) {
      return Response.json({ saved: false, reason: 'Not saveworthy' });
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
      source: 'web'
    };

    const { data, error } = await supabase.from('documents').insert(insert).select().single();
    if (error) throw error;

    return Response.json({ saved: true, id: data.id, summary: data.content });
  } catch (err) {
    return Response.json({ saved: false, reason: err.message || 'Unknown error' }, { status: 500 });
  }
}
