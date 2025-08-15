export const runtime = 'nodejs';
import { createClient } from '@supabase/supabase-js';
function sb() { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); }

export async function POST(req) {
  try {
    const { title, category = 'overall', why = '', target_date = null } = await req.json();
    if (!title?.trim()) return Response.json({ ok: false, error: 'Title required' }, { status: 400 });
    if (!['overall','personal','work'].includes(category)) return Response.json({ ok: false, error: 'Bad category' }, { status: 400 });
    const { data, error } = await sb().from('goals').insert({ title, category, why, target_date }).select().single();
    if (error) throw error;
    return Response.json({ ok: true, goal: data });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
