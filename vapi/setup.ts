// Creates or updates the Vapi tools and assistant from vapi/assistant.json.
// Safe to re-run: tools are matched by function name, the assistant by name.
//
//   npx tsx vapi/setup.ts            create/update, print the assistant id
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

async function main() {
  const config = JSON.parse(readFileSync(new URL("./assistant.json", import.meta.url), "utf8"));
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

  // Assistant
  const assistantBody = {
    name: config.name,
    firstMessage: config.firstMessage,
    firstMessageMode: "assistant-speaks-first",
    model: {
      ...config.model,
      messages: [{ role: "system", content: (config.systemPrompt as string[]).join("\n") }],
      toolIds,
      tools: [{ type: "endCall" }],
    },
  };
  const assistants: { id: string; name?: string }[] = await vapi("GET", "/assistant?limit=1000");
  const existing = assistants.find((a) => a.name === config.name);
  const assistant = existing
    ? await vapi("PATCH", `/assistant/${existing.id}`, assistantBody)
    : await vapi("POST", "/assistant", assistantBody);
  console.log(`${existing ? "updated" : "created"} assistant "${config.name}"`);
  console.log(`ASSISTANT_ID=${assistant.id}`);

  // Phone number
  const numbers: { id: string; number?: string; assistantId?: string }[] = await vapi("GET", "/phone-number");
  if (process.argv.includes("--attach")) {
    if (numbers.length !== 1) {
      console.log(`MANUAL: found ${numbers.length} phone numbers; attach the assistant to the right one in the Vapi dashboard.`);
    } else {
      await vapi("PATCH", `/phone-number/${numbers[0].id}`, { assistantId: assistant.id });
      console.log(`attached phone number ${numbers[0].number ?? numbers[0].id}`);
    }
  } else {
    const attached = numbers.find((n) => n.assistantId === assistant.id);
    console.log(
      attached
        ? `Phone number ${attached.number ?? attached.id} is attached. Call it from OWNER_PHONE.`
        : "MANUAL: attach a phone number to this assistant in the Vapi dashboard, or re-run with --attach.",
    );
  }
}

main().catch((e) => {
  console.error("ERROR", e.message ?? e);
  process.exit(1);
});
