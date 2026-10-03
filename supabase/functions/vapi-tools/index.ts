// Vapi Server URL handler. Authenticated by the x-vapi-secret header that the
// tools and the assistant are configured to send (vapi/setup.ts).
//
// Two jobs: run the agent's tool calls, and keep a call log (transcripts, tool
// calls, results, status) for the admin console.
import { type CallerContext, contextForPhone, contextForSite, db, firstName, keepAlive, timingSafeEqual } from "../_shared/db.ts";
import { runTool } from "../_shared/tools.ts";

type ToolCall = {
  id: string;
  name?: string;
  parameters?: unknown;
  function?: { name?: string; arguments?: unknown };
};
type Message = Record<string, any>;

const NOT_REGISTERED =
  "This phone number is not registered with Agent on Call. Tell the caller their number isn't registered, then end the call politely. Do not share any data.";

function parseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

const callerNumber = (message: Message): string | undefined =>
  message.call?.customer?.number ?? message.customer?.number;

// The caller's phone identifies the user, their business and its projects.
// Web calls (no number) use the demo business.
async function resolveContext(message: Message): Promise<CallerContext | null> {
  const number = callerNumber(message);
  const ctx = number
    ? await contextForPhone(number)
    : Deno.env.get("DEMO_FALLBACK_SITE_ID")
      ? await contextForSite(Deno.env.get("DEMO_FALLBACK_SITE_ID")!)
      : null;
  if (ctx) ctx.callId = message.call?.id;
  return ctx;
}

// ---------------------------------------------------------------- call log
// Logging must never break a call: every write is best-effort.

async function upsertCall(message: Message, fields: Record<string, unknown> = {}) {
  const id: string | undefined = message.call?.id;
  if (!id) return null;
  const { error } = await db.from("calls").upsert(
    { id, caller_phone: callerNumber(message) ?? null, type: message.call?.type ?? null, ...fields },
    { onConflict: "id" },
  );
  if (error) console.error("call log upsert failed:", error.message);
  return id;
}

async function logEvent(callId: string | null | undefined, event: Record<string, unknown>) {
  if (!callId) return;
  const { error } = await db.from("call_events").insert({ call_id: callId, ...event });
  if (error) console.error("call log insert failed:", error.message);
}

// Vapi sends the whole conversation so far on every turn (and once more in
// the end-of-call report). Each spoken line is stored at its position in the
// call, so repeats update in place.
async function syncTranscript(message: Message, messages: unknown, final = false) {
  if (!Array.isArray(messages)) return;
  const callId = await upsertCall(message);
  if (!callId) return;
  const rows: Record<string, unknown>[] = [];
  for (const m of messages as Message[]) {
    const spoken = m.role === "user" || m.role === "bot" || m.role === "assistant";
    const text = typeof m.message === "string" ? m.message : typeof m.content === "string" ? m.content : "";
    if (!spoken || !text.trim()) continue;
    rows.push({
      call_id: callId,
      seq: rows.length,
      kind: "transcript",
      role: m.role === "user" ? "user" : "assistant",
      text: text.trim(),
      ...(typeof m.time === "number" ? { at: new Date(m.time).toISOString() } : {}),
    });
  }
  if (rows.length === 0) return;
  // Turn-by-turn updates can arrive out of order and re-split sentences. The
  // end-of-call report is authoritative, so it replaces the transcript.
  if (final) await db.from("call_events").delete().eq("call_id", callId).eq("kind", "transcript");
  const { error } = await db.from("call_events").upsert(rows, { onConflict: "call_id,seq" });
  if (error) console.error("transcript sync failed:", error.message);
  if (!final) await db.from("call_events").delete().eq("call_id", callId).eq("kind", "transcript").gte("seq", rows.length);
}

// A draft the owner never said yes to must not sit there looking half-sent.
async function cancelUnconfirmed(callId: string | undefined) {
  if (!callId) return;
  const { error } = await db
    .from("actions")
    .update({ status: "cancelled", result: { note: "The call ended before the owner said yes, so nothing was sent." } })
    .eq("call_id", callId)
    .eq("status", "proposed");
  if (error) console.error("cancel unconfirmed failed:", error.message);
}

async function logStatus(message: Message) {
  const status: string = message.status ?? "unknown";
  const fields: Record<string, unknown> = { status };
  if (status === "in-progress") {
    const ctx = await resolveContext(message).catch(() => null);
    if (ctx) fields.business_id = ctx.business.id;
  }
  if (status === "ended") {
    fields.ended_at = new Date().toISOString();
    if (message.endedReason) fields.ended_reason = message.endedReason;
  }
  const callId = await upsertCall(message, fields);
  await logEvent(callId, { kind: "status", text: status });
}

async function logEndOfCall(message: Message) {
  await syncTranscript(message, message.artifact?.messages, true);
  await cancelUnconfirmed(message.call?.id);
  await upsertCall(message, {
    status: "ended",
    ended_reason: message.endedReason ?? null,
    summary: message.analysis?.summary ?? null,
    recording_url: message.artifact?.recordingUrl ?? null,
    ...(message.startedAt ? { started_at: message.startedAt } : {}),
    ended_at: message.endedAt ?? new Date().toISOString(),
  });
}

// ---------------------------------------------------------------- who answers

// Vapi asks this before the call is answered (it allows 7.5 seconds). We look
// up the caller and greet them by name. Any failure falls back to the plain
// assistant rather than failing the call.
async function answerAssistantRequest(message: Message): Promise<Record<string, unknown>> {
  const assistantId = Deno.env.get("VAPI_ASSISTANT_ID");
  if (!assistantId) return { error: "Agent on Call is not set up yet. Please try again later." };
  try {
    const number = callerNumber(message);
    const ctx = number ? await contextForPhone(number) : null;
    if (number && !ctx) {
      return {
        error:
          "Hi, this is Agent on Call. This phone number isn't registered yet. Sign up on our website with this number, then call back. Goodbye.",
      };
    }
    keepAlive(upsertCall(message, ctx ? { business_id: ctx.business.id } : {}));
    if (!ctx) return { assistantId };
    const name = ctx.owner?.full_name ? ` ${firstName(ctx.owner.full_name)}` : "";
    return {
      assistantId,
      assistantOverrides: {
        firstMessage: `Hi${name}, this is Agent Seven for ${ctx.business.name}. What can I do for you today?`,
      },
    };
  } catch (e) {
    console.error("assistant-request lookup failed:", (e as Error).message);
    return { assistantId };
  }
}

// ---------------------------------------------------------------- handler

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 }); // warm ping

  const secret = Deno.env.get("VAPI_SERVER_SECRET") ?? "";
  const given = req.headers.get("x-vapi-secret") ?? "";
  if (!secret || !timingSafeEqual(given, secret)) return new Response("unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const message: Message | undefined = body?.message;
  const type: string = message?.type ?? "unknown";

  if (type === "assistant-request") return Response.json(await answerAssistantRequest(message!));

  if (type !== "tool-calls") {
    // Informational messages: record them after answering, so Vapi never waits.
    if (message) {
      if (type === "conversation-update") keepAlive(syncTranscript(message, message.messages ?? message.artifact?.messages ?? message.messagesOpenAIFormatted));
      else if (type === "status-update") keepAlive(logStatus(message));
      else if (type === "end-of-call-report") keepAlive(logEndOfCall(message));
      else console.log(`vapi message type=${type} ignored`);
    }
    return Response.json({});
  }

  const ctx = await resolveContext(message!);
  const calls: ToolCall[] = Array.isArray(message!.toolCallList) ? message!.toolCallList : [];
  const callId = await upsertCall(message!, ctx ? { business_id: ctx.business.id } : {}).catch(() => null);

  // Vapi ignores non-200 responses, so failures are reported per call in `error`.
  const results = await Promise.all(
    calls.map(async (call) => {
      const name = call.function?.name ?? call.name ?? "";
      const args = parseArgs(call.function?.arguments ?? call.parameters);
      const started = Date.now();
      keepAlive(logEvent(callId, { kind: "tool_call", text: name, data: { args } }));
      if (!ctx) {
        keepAlive(logEvent(callId, { kind: "tool_result", text: "Caller not registered", data: { tool: name, ok: false } }));
        return { toolCallId: call.id, name, result: NOT_REGISTERED };
      }
      try {
        const result = await runTool(name, ctx, args);
        const ms = Date.now() - started;
        console.log(`vapi tool=${name} business=${ctx.business.id} ${ms}ms result_len=${result.length}`);
        keepAlive(logEvent(callId, { kind: "tool_result", text: result, data: { tool: name, ok: true, ms } }));
        return { toolCallId: call.id, name, result };
      } catch (e) {
        const ms = Date.now() - started;
        console.error(`vapi tool=${name} business=${ctx.business.id} ${ms}ms error=${(e as Error).message}`);
        keepAlive(logEvent(callId, { kind: "tool_result", text: (e as Error).message, data: { tool: name, ok: false, ms } }));
        return { toolCallId: call.id, name, error: "That didn't work on my side. Apologize and offer to try again." };
      }
    }),
  );
  return Response.json({ results });
});
