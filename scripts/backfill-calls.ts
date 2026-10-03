// Imports past calls from Vapi into the call log (transcripts, tool calls and
// results), and links earlier actions to the call that created them.
// Calls made after the assistant started reporting are logged live; this is
// for history.   npx tsx scripts/backfill-calls.ts
import { admin, env } from "./_env";

type VapiMessage = {
  role: string;
  message?: string;
  time?: number;
  name?: string;
  result?: string;
  toolCalls?: { function?: { name?: string; arguments?: unknown } }[];
};

async function main() {
  const db = admin();
  const res = await fetch("https://api.vapi.ai/call?limit=100", { headers: { Authorization: `Bearer ${env("VAPI_API_KEY")}` } });
  if (!res.ok) throw new Error(`Vapi GET /call -> ${res.status}`);
  const calls: any[] = await res.json();
  const { data: profiles } = await db.from("profiles").select("id, phone");
  const { data: businesses } = await db.from("businesses").select("id, owner_id");
  let imported = 0;

  for (const c of calls) {
    const { data: existing } = await db.from("call_events").select("kind").eq("call_id", c.id);
    const hasTranscript = (existing ?? []).some((e) => e.kind === "transcript");
    const hasTools = (existing ?? []).some((e) => e.kind === "tool_call");
    if (hasTranscript) continue; // already complete
    const messages: VapiMessage[] = c.artifact?.messages ?? c.messages ?? [];
    if (messages.filter((m) => m.role !== "system").length === 0) continue;

    const number: string | null = c.customer?.number ?? null;
    const owner = number ? profiles?.find((p) => p.phone === number) : null;
    const business = owner ? businesses?.find((b) => b.owner_id === owner.id) : null;
    const { error } = await db.from("calls").upsert({
      id: c.id,
      business_id: business?.id ?? null,
      caller_phone: number,
      type: c.type ?? null,
      status: c.status === "ended" ? "ended" : c.status ?? "ended",
      ended_reason: c.endedReason ?? null,
      summary: c.analysis?.summary ?? c.summary ?? null,
      recording_url: c.artifact?.recordingUrl ?? c.recordingUrl ?? null,
      started_at: c.startedAt ?? c.createdAt,
      ended_at: c.endedAt ?? null,
    });
    if (error) throw error;

    const base = Date.parse(c.startedAt ?? c.createdAt);
    const rows: Record<string, unknown>[] = [];
    const batchIds: string[] = [];
    let seq = 0;
    messages.forEach((m, i) => {
      const at = new Date(m.time ?? base + i * 1000).toISOString();
      if (m.role === "system") return;
      if ((m.toolCalls?.length || m.role === "tool_call_result") && hasTools) return; // logged live already
      if (m.toolCalls?.length) {
        for (const t of m.toolCalls) {
          let args: unknown = t.function?.arguments;
          if (typeof args === "string") try { args = JSON.parse(args); } catch { /* keep the string */ }
          rows.push({ call_id: c.id, at, kind: "tool_call", text: t.function?.name ?? "tool", data: { args } });
        }
      } else if (m.role === "tool_call_result") {
        const text = String(m.result ?? "");
        rows.push({ call_id: c.id, at, kind: "tool_result", text, data: { tool: m.name, ok: true } });
        const batch = text.match(/batch_id: ([0-9a-f-]{36})/)?.[1];
        if (batch) batchIds.push(batch);
      } else if (m.message) {
        rows.push({ call_id: c.id, at, seq: seq++, kind: "transcript", role: m.role === "user" ? "user" : "assistant", text: m.message });
      }
    });
    if (rows.length) {
      const { error: eventsError } = await db.from("call_events").insert(rows);
      if (eventsError) throw eventsError;
    }
    for (const batch of batchIds) await db.from("actions").update({ call_id: c.id }).eq("batch_id", batch).is("call_id", null);
    // Landing pages built during the call window belong to it too.
    if (business && c.endedAt) {
      const { data: sites } = await db.from("sites").select("id").eq("business_id", business.id);
      await db
        .from("site_builds")
        .update({ call_id: c.id })
        .in("site_id", (sites ?? []).map((s) => s.id))
        .is("call_id", null)
        .gte("created_at", c.startedAt ?? c.createdAt)
        .lte("created_at", new Date(Date.parse(c.endedAt) + 60_000).toISOString());
    }
    imported++;
  }
  console.log(`Imported ${imported} call(s) from Vapi (${calls.length} checked).`);
}

main().catch((e) => {
  console.error("ERROR", e.message ?? e);
  process.exit(1);
});
