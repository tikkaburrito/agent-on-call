// Creates or repairs the Vapi tools and assistant from vapi/assistant.json.
// Safe to re-run: tools are matched by function name; the assistant is the one
// attached to the account's phone number, or else matched by name.
//
//   npx tsx vapi/setup.ts            create/update tools + assistant
//   npx tsx vapi/setup.ts --attach   also attach the account's only phone number
import { readFileSync, writeFileSync } from "node:fs";
import { env } from "../scripts/_env";

const API = "https://api.vapi.ai";

async function vapi(method: string, path: string, body?: unknown) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${env("VAPI_API_KEY")}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = Array.isArray(data?.message) ? data.message.join("; ") : data?.message;
    throw new Error(`Vapi ${method} ${path} -> ${res.status}: ${message ?? "request failed"}`);
  }
  return data;
}

type ToolSpec = { name: string; description: string; startMessage: string; parameters: unknown };
type Assistant = { id: string; name?: string; firstMessage?: string };
type PhoneNumber = { id: string; number?: string; assistantId?: string };

async function main() {
  const config = JSON.parse(readFileSync(new URL("./assistant.json", import.meta.url), "utf8"));

  // Every tool calls our edge function and must carry the shared secret:
  // without this header the function answers 401 and the agent sees no data.
  const server = {
    url: `${env("NEXT_PUBLIC_SUPABASE_URL")}/functions/v1/vapi-tools`,
    timeoutSeconds: 20,
    headers: { "x-vapi-secret": env("VAPI_SERVER_SECRET") },
  };

  // Tools
  const existingTools: { id: string; type: string; function?: { name?: string } }[] = await vapi("GET", "/tool?limit=1000");
  const toolIds: string[] = [];
  for (const spec of config.tools as ToolSpec[]) {
    const body = {
      async: false,
      function: { name: spec.name, description: spec.description, parameters: spec.parameters },
      server,
      messages: [
        { type: "request-start", content: spec.startMessage },
        { type: "request-failed", content: config.toolFailedMessage },
      ],
    };
    const found = existingTools.find((t) => t.type === "function" && t.function?.name === spec.name);
    const tool = found
      ? await vapi("PATCH", `/tool/${found.id}`, body)
      : await vapi("POST", "/tool", { type: "function", ...body });
    toolIds.push(tool.id);
    console.log(`${found ? "updated" : "created"} tool ${spec.name}`);
  }

  // Assistant: prefer the one the phone number already rings.
  const numbers: PhoneNumber[] = await vapi("GET", "/phone-number");
  const assistants: Assistant[] = await vapi("GET", "/assistant?limit=1000");
  const attachedIds = [...new Set(numbers.map((n) => n.assistantId).filter(Boolean))];
  const wanted = String(config.name).toLowerCase();
  const savedId = process.env.VAPI_ASSISTANT_ID;
  const existing =
    (savedId ? assistants.find((a) => a.id === savedId) : undefined) ??
    (attachedIds.length === 1 ? assistants.find((a) => a.id === attachedIds[0]) : undefined) ??
    assistants.find((a) => (a.name ?? "").toLowerCase() === wanted);

  const model = {
    ...config.model,
    messages: [{ role: "system", content: (config.systemPrompt as string[]).join("\n") }],
    toolIds,
    tools: [{ type: "endCall" }],
  };
  // The assistant also reports transcripts and call status to the same
  // function, which keeps the call log for the admin console.
  const reporting = { server: { url: server.url, headers: server.headers }, serverMessages: config.serverMessages };
  // The repo is the source of truth for the greeting and call settings too.
  // (Editing the assistant in the Vapi dashboard from a stale tab overwrites
  // tools and prompt; re-run this script to put them back.)
  const body = {
    name: config.name,
    firstMessage: config.firstMessage,
    firstMessageMode: "assistant-speaks-first",
    model,
    ...reporting,
    ...config.callSettings,
  };
  const save = (payload: Record<string, unknown>) =>
    existing ? vapi("PATCH", `/assistant/${existing.id}`, payload) : vapi("POST", "/assistant", payload);
  let assistant;
  try {
    assistant = await save(body);
  } catch (e) {
    // Older and newer API versions disagree on the silence timeout field.
    if (!/silenceTimeoutSeconds/.test((e as Error).message)) throw e;
    const { silenceTimeoutSeconds: _dropped, ...rest } = body as Record<string, unknown>;
    assistant = await save(rest);
    console.log("note: this Vapi API version has no silenceTimeoutSeconds; relying on the still-here hook");
  }
  console.log(`${existing ? "updated" : "created"} assistant "${assistant.name ?? config.name}" with ${toolIds.length} tools`);
  console.log(`ASSISTANT_ID=${assistant.id}`);

  // Edge functions need these ids: assistant-request (inbound) and placing calls (outbound).
  const saveEnv = (key: string, value: string) => {
    const file = readFileSync(".env.local", "utf8");
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    writeFileSync(".env.local", pattern.test(file) ? file.replace(pattern, line) : `${file.replace(/\n*$/, "\n")}${line}\n`);
  };
  saveEnv("VAPI_ASSISTANT_ID", assistant.id);

  // Outbound: a separate, customer-facing assistant. It knows only what each
  // call is told through variables, and its single tool reports the outcome.
  // It never gets the owner's tools.
  const out = config.outbound;
  const outToolIds: string[] = [];
  for (const spec of out.tools as ToolSpec[]) {
    const body = {
      async: false,
      function: { name: spec.name, description: spec.description, parameters: spec.parameters },
      server,
      messages: [{ type: "request-failed", content: "Okay." }],
    };
    const found = existingTools.find((t) => t.type === "function" && t.function?.name === spec.name);
    const tool = found ? await vapi("PATCH", `/tool/${found.id}`, body) : await vapi("POST", "/tool", { type: "function", ...body });
    outToolIds.push(tool.id);
  }
  const outBody = {
    name: out.name,
    firstMessage: out.firstMessage,
    firstMessageMode: "assistant-speaks-first",
    model: {
      ...out.model,
      messages: [{ role: "system", content: (out.systemPrompt as string[]).join("\n") }],
      toolIds: outToolIds,
      tools: [{ type: "endCall" }],
    },
    ...reporting,
    maxDurationSeconds: 180,
  };
  const savedOut = process.env.VAPI_OUTBOUND_ASSISTANT_ID;
  const existingOut =
    (savedOut ? assistants.find((a) => a.id === savedOut) : undefined) ??
    assistants.find((a) => (a.name ?? "").toLowerCase() === String(out.name).toLowerCase());
  const outAssistant = existingOut
    ? await vapi("PATCH", `/assistant/${existingOut.id}`, outBody)
    : await vapi("POST", "/assistant", outBody);
  console.log(`${existingOut ? "updated" : "created"} outbound assistant "${out.name}"`);
  saveEnv("VAPI_OUTBOUND_ASSISTANT_ID", outAssistant.id);
  if (numbers.length === 1) saveEnv("VAPI_PHONE_NUMBER_ID", numbers[0].id);

  // Phone number. Default: the number asks our function who should answer
  // (assistant-request), which lets us greet the caller by name.
  // --static-greeting points the number straight at the assistant instead.
  if (numbers.length !== 1) {
    console.log(`MANUAL: ${numbers.length} phone numbers found; point the right one at this assistant in the Vapi dashboard.`);
    return;
  }
  const number = numbers[0];
  if (process.argv.includes("--static-greeting")) {
    await vapi("PATCH", `/phone-number/${number.id}`, { assistantId: assistant.id });
    console.log(`Phone number ${number.number ?? number.id} rings the assistant directly (same greeting for everyone).`);
  } else {
    await vapi("PATCH", `/phone-number/${number.id}`, {
      assistantId: null,
      server: { url: server.url, timeoutSeconds: 7, headers: server.headers },
    });
    console.log(`Phone number ${number.number ?? number.id} asks vapi-tools who should answer (greeting by name).`);
    console.log("If any id above is new, run: bash scripts/push-secrets.sh");
  }
}

main().catch((e) => {
  console.error("ERROR", e.message ?? e);
  process.exit(1);
});
