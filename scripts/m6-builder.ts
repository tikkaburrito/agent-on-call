// Site builder acceptance: npx tsx scripts/m6-builder.ts
// Calls build_landing_page through the deployed vapi-tools endpoint (as a web
// call, so it builds for the seeded site), waits for the Vercel deployment,
// then checks the page is public and its form target creates a pending order.
import { admin, check, env, finish, FUNCTIONS_URL, SITE_A } from "./_env";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const db = admin();
  const started = Date.now();
  const res = await fetch(`${FUNCTIONS_URL}/vapi-tools`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-vapi-secret": env("VAPI_SERVER_SECRET") },
    body: JSON.stringify({
      message: {
        type: "tool-calls",
        call: { type: "webCall" },
        toolCallList: [{ id: "t1", type: "function", function: { name: "build_landing_page", arguments: { intent: "A warm, simple page for busy beginners who want to try yoga" } } }],
      },
    }),
  });
  const toolSeconds = (Date.now() - started) / 1000;
  const result = (await res.json()).results?.[0];
  console.log(`      tool (${toolSeconds.toFixed(2)}s): ${result?.result ?? result?.error}`);
  check("build_landing_page answers within 5 s", toolSeconds < 5 && !!result?.result);

  let build: { status: string; url: string | null; error: string | null; copy: Record<string, unknown> | null } | null = null;
  for (let i = 0; i < 75; i++) {
    await sleep(2000);
    const { data } = await db.from("site_builds").select("status, url, error, copy").eq("site_id", SITE_A).order("created_at", { ascending: false }).limit(1);
    build = data?.[0] ?? null;
    if (build && build.status !== "building") break;
  }
  const total = ((Date.now() - started) / 1000).toFixed(0);
  check(`build finished live in ${total}s`, build?.status === "live" && !!build.url, build?.error ?? "");
  if (build?.status !== "live" || !build.url) return finish();
  console.log(`      url: ${build.url}`);
  console.log(`      copy source: ${build.copy?.source}; notified: ${JSON.stringify(build.copy?.notified)}`);

  const page = await fetch(build.url, { redirect: "manual" });
  const html = await page.text();
  check("landing page is public (200, no login redirect)", page.status === 200, `http ${page.status}`);
  check("landing page is for this site", html.includes(SITE_A) && html.includes("/api/checkout"));

  const { data: site } = await db.from("sites").select("landing_url").eq("id", SITE_A).single();
  check("sites.landing_url updated", site?.landing_url === build.url);

  // The same request the page's form makes, including the CORS preflight.
  const endpoint = html.match(/"endpoint":"([^"]+)"/)?.[1];
  if (!endpoint) return check("form endpoint found in page", false), finish();
  const preflight = await fetch(endpoint, { method: "OPTIONS", headers: { Origin: build.url, "Access-Control-Request-Method": "POST" } });
  check("checkout allows cross-origin posts", preflight.headers.get("access-control-allow-origin") === "*");
  const email = `qa-builder-${Date.now()}@example.com`;
  const signup = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: build.url },
    body: JSON.stringify({ site_id: SITE_A, name: "QA Builder", email, phone: "", consent: false }),
  });
  const body = await signup.json().catch(() => ({}));
  check("form post returns a Stripe Checkout url", signup.ok && String(body.url).startsWith("https://checkout.stripe.com"), body.error ?? "");
  const { data: customer } = await db.from("customers").select("id, orders(status)").eq("email", email).maybeSingle();
  check("signup created customer + pending order", (customer?.orders as { status: string }[] | undefined)?.[0]?.status === "pending");
  if (customer) {
    await db.from("orders").delete().eq("customer_id", customer.id);
    await db.from("customers").delete().eq("id", customer.id);
  }
  finish();
}

main().catch((e) => {
  console.error("ERROR", e.message ?? e);
  process.exit(1);
});
