// Username login on top of Supabase Auth. Supabase identifies users by email,
// so each username maps to a synthetic address that never receives mail.
export const USERNAME = /^[a-z0-9_]{3,24}$/;

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const usernameToEmail = (username: string) =>
  `${username.trim().toLowerCase()}@users.agent-on-call.example.com`;

// People sign in with either an email address or a username.
export const isEmail = (identifier: string) => identifier.includes("@");
export const loginEmail = (identifier: string) => {
  const id = identifier.trim().toLowerCase();
  return isEmail(id) ? id : usernameToEmail(id);
};

// A valid username made from the part of an email before the @.
export function usernameFromEmail(email: string): string {
  const base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20);
  return base.length >= 3 ? base : `${base}_user`.replace(/^_+/, "");
}

export function toE164(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "project";
