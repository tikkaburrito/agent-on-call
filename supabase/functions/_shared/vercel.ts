// Deploys a single static index.html as its own Vercel project (REST API).

const API = "https://api.vercel.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function vercel(method: string, path: string, body?: unknown) {
  const token = Deno.env.get("VERCEL_TOKEN");
  if (!token) throw new Error("VERCEL_TOKEN is not configured");
  const teamId = Deno.env.get("VERCEL_TEAM_ID");
  const url = new URL(API + path);
  if (teamId) url.searchParams.set("teamId", teamId);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Vercel ${res.status}: ${data?.error?.message ?? "request failed"}`);
  return data;
}

export async function deployStatic(input: { name: string; html: string; timeoutMs?: number }): Promise<{
  deploymentId: string;
  url: string;
}> {
  const created = await vercel("POST", "/v13/deployments?skipAutoDetectionConfirmation=1", {
    name: input.name,
    files: [{ file: "index.html", data: input.html, encoding: "utf-8" }],
    projectSettings: { framework: null },
    target: "production",
  });

  // New projects default to Vercel Authentication; the page must be public.
  await vercel("PATCH", `/v9/projects/${created.projectId}`, { ssoProtection: null }).catch((e) =>
    console.log("could not disable deployment protection:", e.message)
  );

  const deadline = Date.now() + (input.timeoutMs ?? 100_000);
  let deployment = created;
  while (!(deployment.readyState === "READY" && deployment.aliasAssigned)) {
    if (deployment.readyState === "ERROR" || deployment.readyState === "CANCELED") {
      throw new Error(`deployment ${deployment.readyState}: ${deployment.errorMessage ?? "no details"}`);
    }
    if (deployment.aliasError) throw new Error(`alias failed: ${deployment.aliasError.message}`);
    if (Date.now() > deadline) throw new Error("deployment timed out");
    await sleep(2000);
    deployment = await vercel("GET", `/v13/deployments/${created.id}`);
  }

  // The production alias is public; the per-deployment URL is not guaranteed to be.
  const aliases: string[] = (deployment.alias ?? []).filter((a: string) => a.endsWith(".vercel.app"));
  aliases.sort((a, b) => a.length - b.length);
  let host = aliases[0];
  if (!host) {
    const domains = await vercel("GET", `/v9/projects/${created.projectId}/domains?production=true`);
    host = domains?.domains?.[0]?.name ?? deployment.url;
  }
  return { deploymentId: created.id, url: `https://${host}` };
}
