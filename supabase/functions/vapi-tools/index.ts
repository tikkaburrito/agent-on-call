// Vapi Server URL handler. Authenticated by the x-vapi-secret header that the
// tools are configured to send (vapi/setup.ts).
import { type CallerContext, contextForPhone, contextForSite, timingSafeEqual } from "../_shared/db.ts";
import { runTool } from "../_shared/tools.ts";

type ToolCall = {
  id: string;
  name?: string;
  parameters?: unknown;
  function?: { name?: string; arguments?: unknown };
};

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

// The caller's phone identifies the user, their business and its projects.
// Web calls (no number) use the demo business.
async function resolveContext(message: Record<string, any>): Promise<CallerContext | null> {
  const number: string | undefined = message.call?.customer?.number ?? message.customer?.number;
  if (number) return contextForPhone(number);
  const fallback = Deno.env.get("DEMO_FALLBACK_SITE_ID");
  return fallback ? contextForSite(fallback) : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 }); // warm ping

  const secret = Deno.env.get("VAPI_SERVER_SECRET") ?? "";
  const given = req.headers.get("x-vapi-secret") ?? "";
  if (!secret || !timingSafeEqual(given, secret)) return new Response("unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const message = body?.message;
  if (message?.type !== "tool-calls") {
    console.log(`vapi message type=${message?.type ?? "unknown"} ignored`);
    return Response.json({});
  }

  const ctx = await resolveContext(message);
  const calls: ToolCall[] = Array.isArray(message.toolCallList) ? message.toolCallList : [];

  // Vapi ignores non-200 responses, so failures are reported per call in `error`.
  const results = await Promise.all(
    calls.map(async (call) => {
      const name = call.function?.name ?? call.name ?? "";
      const started = Date.now();
      if (!ctx) return { toolCallId: call.id, name, result: NOT_REGISTERED };
      try {
        const result = await runTool(name, ctx, parseArgs(call.function?.arguments ?? call.parameters));
        console.log(`vapi tool=${name} business=${ctx.business.id} ${Date.now() - started}ms result_len=${result.length}`);
        return { toolCallId: call.id, name, result };
      } catch (e) {
        console.error(`vapi tool=${name} business=${ctx.business.id} ${Date.now() - started}ms error=${(e as Error).message}`);
        return { toolCallId: call.id, name, error: "That didn't work on my side. Apologize and offer to try again." };
      }
    }),
  );
  return Response.json({ results });
});
