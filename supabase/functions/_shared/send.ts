// Resend (email) and Twilio (SMS) through their REST APIs.

async function withRetry<T>(fn: () => Promise<Response>, parse: (r: Response) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fn();
    if (res.status === 429 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
      continue;
    }
    return parse(res);
  }
}

export async function sendEmail(msg: { to: string; subject: string; text: string }): Promise<{ id: string }> {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM");
  if (!key || !from) throw new Error("Email is not configured");
  return withRetry(
    () =>
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text }),
      }),
    async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Resend ${res.status}: ${data?.message ?? "send failed"}`);
      return { id: data.id as string };
    },
  );
}

export async function sendSms(msg: { to: string; body: string }): Promise<{ sid: string }> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_FROM");
  if (!sid || !token || !from) throw new Error("SMS is not configured");
  return withRetry(
    () =>
      fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: msg.to, From: from, Body: msg.body }),
      }),
    async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Twilio ${res.status}: ${data?.message ?? "send failed"}`);
      return { sid: data.sid as string };
    },
  );
}

// Twilio accepts a message before the carrier decides. A short while later the
// status tells us whether it was rejected (for example error 30034: the sending
// number is not registered for US A2P 10DLC). Returns null when it is fine or
// still in flight, or a reason when the carrier refused it.
export async function smsRejection(sid: string, waitMs = 2500): Promise<string | null> {
  const account = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!account || !token) return null;
  await new Promise((r) => setTimeout(r, waitMs));
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages/${sid}.json`, {
      headers: { Authorization: `Basic ${btoa(`${account}:${token}`)}` },
    });
    const m = await res.json();
    if (m.status !== "undelivered" && m.status !== "failed") return null;
    const why = m.error_code === 30034
      ? "the sending number is not registered for US business texting (A2P 10DLC)"
      : m.error_message || "the carrier rejected it";
    return `text not delivered: ${why} (Twilio ${m.error_code ?? m.status})`;
  } catch {
    return null;
  }
}
