export const runtime = 'nodejs';
import { createClient } from '@supabase/supabase-js';
function sb() { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); }

export async function POST(req) {
  try {
    const {
      title, category, goal_id = null,
      next_action = null, due = null,
      impact = null, energy_fit = null, effort_hours = null
    } = await req.json();

    if (!title?.trim()) return Response.json({ ok: false, error: 'Title required' }, { status: 400 });
    if (!['personal','work'].includes(category)) return Response.json({ ok: false, error: 'Bad category' }, { status: 400 });

    const { data, error } = await sb().from('tasks').insert({
      title, category, goal_id, next_action, due, impact, energy_fit, effort_hours
    }).select().single();
    if (error) throw error;
    return Response.json({ ok: true, task: data });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
