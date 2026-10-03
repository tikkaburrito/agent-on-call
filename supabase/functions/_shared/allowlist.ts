// SEND_ALLOWLIST is a comma-separated list of emails and E.164 phone numbers.
// Anyone not on it is never contacted: their actions end as `simulated`.

const normalize = (v: string) => {
  const s = v.trim().toLowerCase();
  return s.includes("@") ? s : s.replace(/[^\d+]/g, "");
};

export function isAllowed(recipient: string | null | undefined): boolean {
  if (!recipient) return false;
  const list = (Deno.env.get("SEND_ALLOWLIST") ?? "")
    .split(",")
    .map(normalize)
    .filter(Boolean);
  return list.includes(normalize(recipient));
}
