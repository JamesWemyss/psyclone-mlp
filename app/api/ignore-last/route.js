export const runtime = 'nodejs';
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function POST() {
  try {
    const { data: latest, error: selErr } = await supabase
      .from('documents')
      .select('id, content')
      .eq('is_ignored', false)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (selErr) throw selErr;
    if (!latest) return Response.json({ reason: 'Nothing to ignore' }, { status: 404 });

    const { error: updErr } = await supabase
      .from('documents')
      .update({ is_ignored: true })
      .eq('id', latest.id);
    if (updErr) throw updErr;

    return Response.json({ ok: true, summary: latest.content });
  } catch (err) {
    return Response.json({ ok: false, reason: err.message || 'Unknown error' }, { status: 500 });
  }
}
