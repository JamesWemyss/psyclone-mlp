export const runtime = 'nodejs';
import { createClient } from '@supabase/supabase-js';
function sb() { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); }

/**
 * Move a task to the top of its category list by giving it the smallest order_override.
 * (Lower order_override = higher in the list)
 */
export async function POST(req) {
  try {
    const { id } = await req.json();
    if (!id) return Response.json({ ok: false, error: 'Missing id' }, { status: 400 });

    const client = sb();

    // Get the task (for its category)
    const { data: task, error: tErr } = await client.from('tasks').select('id, category').eq('id', id).single();
    if (tErr) throw tErr;

    // Find current minimum order_override in this category
    const { data: mins, error: mErr } = await client
      .from('tasks')
      .select('order_override')
      .eq('category', task.category)
      .order('order_override', { ascending: true, nullsFirst: true })
      .limit(1);
    if (mErr) throw mErr;

    let newVal = 0;
    if (mins && mins.length && mins[0].order_override !== null) {
      newVal = mins[0].order_override - 1;
    } else {
      newVal = -1;
    }

    const { data, error: uErr } = await client.from('tasks').update({ order_override: newVal }).eq('id', id).select().single();
    if (uErr) throw uErr;

    return Response.json({ ok: true, task: data });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
