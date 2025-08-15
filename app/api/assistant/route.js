// app/api/assistant/route.js
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

// ---- env ----
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
if (!OPENAI_ASSISTANT_ID) throw new Error("Missing OPENAI_ASSISTANT_ID");
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("Missing Supabase env vars");

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Helpers
const ok = (data = {}) => Response.json({ ok: true, ...data });
const bad = (msg) => new Response(JSON.stringify({ ok: false, error: msg }), { status: 400 });

/**
 * Handle tool call: save_document
 */
async function handleSaveDocument(args) {
  const {
    kind,
    content,
    body = null,
    happened_at = null,
    place = null,
    person_names = null,
    category = null,
    amount = null,
    is_ignored = false,
  } = args || {};

  if (!kind || !content) throw new Error("save_document requires kind and content");

  const { data, error } = await supabase
    .from("documents")
    .insert([
      {
        kind,
        content,
        body,
        happened_at,
        place,
        person_names: person_names || null,
        category,
        amount,
        is_ignored,
        recorded_at: new Date().toISOString(),
      },
    ])
    .select("id")
    .single();

  if (error) throw error;
  return { status: "saved", id: data.id };
}

/**
 * Handle tool call: create_goal
 */
async function handleCreateGoal(args) {
  const { title, category = "overall", why = null, target_date = null } = args || {};
  if (!title) throw new Error("create_goal requires title");

  const { data, error } = await supabase
    .from("goals")
    .insert([{ title, category, why, target_date }])
    .select("id")
    .single();

  if (error) throw error;
  return { status: "goal_created", id: data.id };
}

/**
 * Handle tool call: create_task
 */
async function handleCreateTask(args) {
  const {
    title,
    category, // work | personal
    goal_id = null,
    next_action = null,
    due = null,
    impact = null,
    energy_fit = null,
    effort_hours = null,
  } = args || {};

  if (!title || !category) throw new Error("create_task requires title and category");

  const row = {
    title,
    category,
    goal_id,
    next_action,
    due,
    impact,
    energy_fit,
    effort_hours,
  };

  const { data, error } = await supabase
    .from("tasks")
    .insert([row])
    .select("id")
    .single();

  if (error) throw error;
  return { status: "task_created", id: data.id };
}

/**
 * Handle tool call: search_documents
 */
async function handleSearchDocuments(args) {
  const { keywords = [], date_from = null, date_to = null, limit = 10 } = args || {};
  const kw = (Array.isArray(keywords) ? keywords : []).filter(Boolean);

  // very simple search: ilike on content/body, newest first
  let query = supabase
    .from("v_documents_search")
    .select("id, content, happened_at, recorded_at, place")
    .order("event_time", { ascending: false })
    .limit(limit);

  if (kw.length > 0) {
    // build OR ilike across content/body
    const ors = kw
      .map((k) => `content.ilike.%${k}%,body.ilike.%${k}%`)
      .join(",");
    query = query.or(ors);
  }

  if (date_from) query = query.gte("event_time", date_from);
  if (date_to) query = query.lte("event_time", date_to);

  const { data, error } = await query;
  if (error) throw error;

  return { status: "ok", results: data || [] };
}

/**
 * Handle tool call: upsert_contact
 * args: { full_name: string, preferred_name?: string, relation: 'spouse'|'partner'|'child'|'parent'|'sibling'|'friend'|'colleague'|'other' }
 */
async function handleUpsertContact(args) {
  const { full_name, preferred_name = null, relation } = args || {};
  if (!full_name || !relation) throw new Error("upsert_contact requires full_name and relation");

  // 1) ensure contact exists
  let { data: existing, error: findErr } = await supabase
    .from("contacts")
    .select("id")
    .ilike("full_name", full_name)
    .limit(1)
    .maybeSingle();

  if (findErr) throw findErr;

  let contactId = existing?.id;

  if (!contactId) {
    const { data: created, error: insErr } = await supabase
      .from("contacts")
      .insert([{ full_name, preferred_name }])
      .select("id")
      .single();
    if (insErr) throw insErr;
    contactId = created.id;
  } else if (preferred_name) {
    // update preferred_name if provided
    const { error: updErr } = await supabase
      .from("contacts")
      .update({ preferred_name })
      .eq("id", contactId);
    if (updErr) throw updErr;
  }

  // 2) upsert relation
  const { error: relErr } = await supabase
    .from("contacts_to_user")
    .upsert({ contact_id: contactId, relation })
    .eq("contact_id", contactId);
  if (relErr) throw relErr;

  return { status: "contact_upserted", id: contactId };
}

/**
 * Handle tool call: add_contact_key_date
 * args: { full_name: string, kind: 'birthday'|'anniversary'|'other', the_date: 'YYYY-MM-DD', label?: string }
 */
async function handleAddContactKeyDate(args) {
  const { full_name, kind, the_date, label = null } = args || {};
  if (!full_name || !kind || !the_date)
    throw new Error("add_contact_key_date requires full_name, kind, the_date");

  // find contact
  let { data: contact, error: findErr } = await supabase
    .from("contacts")
    .select("id")
    .ilike("full_name", full_name)
    .limit(1)
    .maybeSingle();

  if (findErr) throw findErr;

  let contactId = contact?.id;
  if (!contactId) {
    const { data: created, error: insErr } = await supabase
      .from("contacts")
      .insert([{ full_name }])
      .select("id")
      .single();
    if (insErr) throw insErr;
    contactId = created.id;
  }

  const { data, error } = await supabase
    .from("contact_key_dates")
    .insert([{ contact_id: contactId, kind, the_date, label }])
    .select("id")
    .single();

  if (error) throw error;
  return { status: "key_date_saved", id: data.id };
}

// Map tool to handler
const HANDLERS = {
  save_document: handleSaveDocument,
  create_goal: handleCreateGoal,
  create_task: handleCreateTask,
  search_documents: handleSearchDocuments,
  upsert_contact: handleUpsertContact,
  add_contact_key_date: handleAddContactKeyDate,
};

export async function POST(req) {
  try {
    const { message } = await req.json();
    if (!message || typeof message !== "string") return bad("Missing message");

    // 1) First call: let Assistant decide tool calls
    let input = [{ role: "user", content: message }];

    let resp = await openai.responses.create({
      assistant_id: OPENAI_ASSISTANT_ID,
      input,
    });

    // 2) If there are tool calls, execute them and provide outputs back
    const toolOutputs = [];

    for (const item of resp.output || []) {
      if (item.type !== "function_call") continue;

      const { name, arguments: argStr, call_id } = item;
      const handler = HANDLERS[name];
      if (!handler) {
        // return a minimal output so the model can apologise
        toolOutputs.push({
          type: "function_call_output",
          call_id,
          output: JSON.stringify({ error: `Unknown tool: ${name}` }),
        });
        continue;
      }

      let args = {};
      try {
        args = argStr ? JSON.parse(argStr) : {};
      } catch (e) {
        toolOutputs.push({
          type: "function_call_output",
          call_id,
          output: JSON.stringify({ error: "Invalid arguments JSON" }),
        });
        continue;
      }

      try {
        const result = await handler(args);
        toolOutputs.push({
          type: "function_call_output",
          call_id,
          output: JSON.stringify(result),
        });
      } catch (e) {
        toolOutputs.push({
          type: "function_call_output",
          call_id,
          output: JSON.stringify({ error: e.message || String(e) }),
        });
      }
    }

    // 3) If we produced any tool outputs, send a SECOND request so the model can craft a final reply
    let finalText = resp.output_text || "OK.";

    if (toolOutputs.length > 0) {
      const followupInput = input
        .concat(resp.output) // include the model's function_call items
        .concat(toolOutputs); // include our tool outputs

      const resp2 = await openai.responses.create({
        assistant_id: OPENAI_ASSISTANT_ID,
        input: followupInput,
      });

      finalText = resp2.output_text || finalText;
    }

    return ok({ text: finalText });
  } catch (err) {
    console.error("assistant route error:", err);
    return new Response(JSON.stringify({ ok: false, error: err.message || String(err) }), {
      status: 500,
    });
  }
}
