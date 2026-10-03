// Creates or repairs the Vapi tools and assistant from vapi/assistant.json.
// Safe to re-run: tools are matched by function name; the assistant is the one
// attached to the account's phone number, or else matched by name.
//
//   npx tsx vapi/setup.ts            create/update tools + assistant
//   npx tsx vapi/setup.ts --attach   also attach the account's only phone number
import { readFileSync } from "node:fs";
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
  const existing =
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
  // An existing assistant keeps its own name, greeting and voice.
  const assistant = existing
    ? await vapi("PATCH", `/assistant/${existing.id}`, { model, ...reporting })
    : await vapi("POST", "/assistant", {
        name: config.name,
        firstMessage: config.firstMessage,
        firstMessageMode: "assistant-speaks-first",
        model,
        ...reporting,
      });
  console.log(`${existing ? "updated" : "created"} assistant "${assistant.name ?? config.name}" with ${toolIds.length} tools`);
  console.log(`ASSISTANT_ID=${assistant.id}`);

  // Phone number
  const attached = numbers.find((n) => n.assistantId === assistant.id);
  if (attached) {
    console.log(`Phone number ${attached.number ?? attached.id} rings this assistant.`);
  } else if (process.argv.includes("--attach") && numbers.length === 1) {
    await vapi("PATCH", `/phone-number/${numbers[0].id}`, { assistantId: assistant.id });
    console.log(`attached phone number ${numbers[0].number ?? numbers[0].id}`);
  } else {
    console.log(
      `MANUAL: ${numbers.length} phone number(s) found, none ringing this assistant. Attach one in the Vapi dashboard, or re-run with --attach if there is exactly one.`,
    );
  }
}

main().catch((e) => {
  console.error("ERROR", e.message ?? e);
  process.exit(1);
});
