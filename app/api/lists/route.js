export const runtime = 'nodejs';
import { createClient } from '@supabase/supabase-js';

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const sortTasks = (a, b) => {
  // order_override asc (NULL last), then score desc, then due asc NULL last, then created_at asc
  const oa = a.order_override ?? Number.POSITIVE_INFINITY;
  const ob = b.order_override ?? Number.POSITIVE_INFINITY;
  if (oa !== ob) return oa - ob;
  if ((b.score ?? 0) !== (a.score ?? 0)) return (b.score ?? 0) - (a.score ?? 0);
  const da = a.due ? new Date(a.due).getTime() : Number.POSITIVE_INFINITY;
  const db = b.due ? new Date(b.due).getTime() : Number.POSITIVE_INFINITY;
  if (da !== db) return da - db;
  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
};

export async function GET() {
  try {
    const supabase = sb();

    // Goals (overall)
    const { data: goals, error: gErr } = await supabase
      .from('v_goals_active')
      .select('id, title, category, why, target_date, days_to_target, created_at')
      .eq('category', 'overall')
      .order('target_date', { ascending: true, nullsFirst: false });
    if (gErr) throw gErr;

    // Tasks (active)
    const selectCols = 'id, title, category, goal_id, next_action, due, impact, energy_fit, effort_hours, alignment_override, order_override, status, created_at, score';
    const { data: tPersonal, error: pErr } = await supabase
      .from('v_tasks_active').select(selectCols).eq('category', 'personal').limit(50);
    if (pErr) throw pErr;
    const { data: tWork, error: wErr } = await supabase
      .from('v_tasks_active').select(selectCols).eq('category', 'work').limit(50);
    if (wErr) throw wErr;

    const personal = (tPersonal || []).sort(sortTasks);
    const work = (tWork || []).sort(sortTasks);

    return Response.json({ ok: true, goals, personal, work });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
