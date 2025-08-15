export const runtime = 'nodejs';
import { createClient } from '@supabase/supabase-js';
function sb() { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); }

export async function POST(req) {
  try {
    const { id, patch } = await req.json();
    if (!id) return Response.json({ ok: false, error: 'Missing id' }, { status: 400 });
    if (!patch || typeof patch !== 'object') return Response.json({ ok: false, error: 'Missing patch' }, { status: 400 });
    const { data, error } = await sb().from('tasks').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return Response.json({ ok: true, task: data });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
