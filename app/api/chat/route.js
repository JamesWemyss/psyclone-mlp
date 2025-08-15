export const runtime = 'nodejs';

import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
function sb() { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); }
function oa() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }

/**
 * The model returns a single-command JSON we can execute.
 * Supported actions:
 *  - create_goal { title, category, why, target_date }
 *  - create_task { title, category, goal_title?, due?, impact?, energy_fit?, effort_hours?, next_action? }
 *  - complete_task { title? }            // resolves by fuzzy title
 *  - reorder_task_top { title? }         // move to top by fuzzy title
 *  - show_lists {}
 *  - chat {}                             // normal assistant reply
 */
const ROUTER = `You are Psyclone's command router for James (UK English).
Return STRICT JSON with shape:
{
  "action": "create_goal|create_task|complete_task|reorder_task_top|show_lists|chat",
  "goal": { "title": "", "category": "overall|personal|work", "why": "", "target_date": "" } | null,
  "task": { "title": "", "category": "personal|work", "goal_title": "", "due": "", "impact": 1, "energy_fit": 1, "effort_hours": 0, "next_action": "" } | null
}
Rules:
- If user asks to add/rename/link/complete/snooze/reorder a priority, choose create_task/complete_task/reorder_task_top.
- If they add a life goal, choose create_goal.
- If they say "show", "list", "what are my priorities", choose show_lists.
- Else, choose chat.
- Use ISO 8601 for dates when possible. Omit fields you don't know (use empty string or null).`;

async function fuzzyFindTaskByTitle(client, title) {
  const like = `%${title}%`;
  const { data } = await client
    .from('tasks')
    .select('id, title, category, created_at')
    .ilike('title', like)
    .order('created_at', { ascending: false })
    .limit(1);
  return data?.[0] || null;
}
async function findGoalByTitle(client, title) {
  const like = `%${title}%`;
  const { data } = await client
    .from('goals')
    .select('id, title, category')
    .ilike('title', like)
    .order('created_at', { ascending: false })
    .limit(1);
  return data?.[0] || null;
}

export async function POST(req) {
  try {
    const { message } = await req.json();
    if (!message || typeof message !== 'string') {
      return Response.json({ ok: false, error: 'No message' }, { status: 400 });
    }

    const client = sb();
    const openai = oa();

    // Route to a command
    const r = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: ROUTER }, { role: 'user', content: message }]
    });

    let cmd = {};
    try { cmd = JSON.parse(r.choices?.[0]?.message?.content || '{}'); } catch {}

    const action = cmd.action || 'chat';

    // Handle actions
    if (action === 'create_goal' && cmd.goal?.title) {
      const { title, category = 'overall', why = '', target_date = null } = cmd.goal;
      const { data, error } = await client.from('goals').insert({ title, category, why, target_date }).select().single();
      if (error) throw error;
      return Response.json({ ok: true, reply: `Added goal: “${data.title}”.`, refresh: true });
    }

    if (action === 'create_task' && cmd.task?.title && cmd.task?.category) {
      let { title, category, goal_title = '', due = null, impact = null, energy_fit = null, effort_hours = null, next_action = null } = cmd.task;

      // If goal_title provided, resolve to goal_id
      let goal_id = null;
      if (goal_title) {
        const g = await findGoalByTitle(client, goal_title);
        goal_id = g?.id || null;
      }

      const { data, error } = await client.from('tasks').insert({
        title, category, goal_id, due, impact, energy_fit, effort_hours, next_action
      }).select().single();
      if (error) throw error;
      return Response.json({ ok: true, reply: `Added ${category} priority: “${data.title}”.`, refresh: true });
    }

    if (action === 'complete_task') {
      const title = cmd?.task?.title || '';
      const task = await fuzzyFindTaskByTitle(client, title);
      if (!task) return Response.json({ ok: true, reply: `I couldn't find a task matching “${title}”.` });
      const { error } = await client.from('tasks').update({ status: 'done' }).eq('id', task.id);
      if (error) throw error;
      return Response.json({ ok: true, reply: `Marked done: “${task.title}”.`, refresh: true });
    }

    if (action === 'reorder_task_top') {
      const title = cmd?.task?.title || '';
      const task = await fuzzyFindTaskByTitle(client, title);
      if (!task) return Response.json({ ok: true, reply: `I couldn't find a task matching “${title}”.` });
      // Move to top via smallest order_override in category
      const { data: mins, error: mErr } = await client
        .from('tasks')
        .select('order_override')
        .eq('category', task.category)
        .order('order_override', { ascending: true, nullsFirst: true })
        .limit(1);
      if (mErr) throw mErr;
      let newVal = (mins && mins.length && mins[0].order_override !== null) ? (mins[0].order_override - 1) : -1;
      const { error: uErr } = await client.from('tasks').update({ order_override: newVal }).eq('id', task.id);
      if (uErr) throw uErr;
      return Response.json({ ok: true, reply: `Moved to #1 in ${task.category}: “${task.title}”.`, refresh: true });
    }

    if (action === 'show_lists') {
      // Just a friendly reply; the UI will already show lists
      return Response.json({ ok: true, reply: "Here are your current priorities and goals." });
    }

    // Default: conversational answer (with tiny memory from active tasks)
    const { data: mem } = await client
      .from('v_tasks_active')
      .select('title, category, next_action, due, score')
      .order('score', { ascending: false })
      .limit(6);

    const context = (mem || []).map((t, i) =>
      `• [${t.category}] ${t.title}${t.next_action ? ` — next: ${t.next_action}` : ''}${t.due ? ` — due: ${t.due}` : ''} (score ${t.score})`
    ).join('\n');

    const sys = `You are Psyclone, a concise, encouraging assistant for James (UK English).
When relevant, use the context list of his top tasks. Offer one short follow-up question if it clearly helps. Avoid long paragraphs.
CONTEXT:
${context || '(no active priorities yet)'}`;

    const chat = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.5,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: message }]
    });

    const reply = chat.choices?.[0]?.message?.content?.trim() || 'Okay.';
    return Response.json({ ok: true, reply });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
