import { EMAIL, isEmail, toE164, USERNAME, usernameFromEmail, usernameToEmail } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Creates a user plus their profile. They can sign up with an email address
// or a plain username. The phone number on the profile is how the phone agent
// recognises them when they call.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const identifier = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const fullName = typeof body?.full_name === "string" ? body.full_name.trim().slice(0, 80) : "";
  const phone = toE164(body?.phone);
  const withEmail = isEmail(identifier);

  if (withEmail ? !EMAIL.test(identifier) || identifier.length > 200 : !USERNAME.test(identifier)) {
    return Response.json(
      { error: "Enter your email address, or a username of 3 to 24 lowercase letters, numbers and underscores." },
      { status: 400 },
    );
  }
  if (password.length < 8 || password.length > 72) {
    return Response.json({ error: "Use a password with at least 8 characters." }, { status: 400 });
  }
  if (!fullName) return Response.json({ error: "Please enter your name." }, { status: 400 });
  if (!phone) return Response.json({ error: "Enter the mobile number you'll call from, with area code." }, { status: 400 });

  const db = supabaseAdmin();
  let username = withEmail ? usernameFromEmail(identifier) : identifier;
  const { data: taken } = await db.from("profiles").select("username, phone").or(`username.eq.${username},phone.eq.${phone}`);
  if (taken?.some((p) => p.phone === phone)) {
    return Response.json({ error: "That phone number is already linked to another account." }, { status: 409 });
  }
  if (taken?.some((p) => p.username === username)) {
    if (!withEmail) return Response.json({ error: "That username is taken." }, { status: 409 });
    username = `${username.slice(0, 19)}_${Math.random().toString(36).slice(2, 6)}`;
  }

  const { data: created, error } = await db.auth.admin.createUser({
    email: withEmail ? identifier : usernameToEmail(username),
    password,
    email_confirm: true,
    user_metadata: { username, full_name: fullName },
  });
  if (error || !created.user) {
    const exists = /already|registered|exists/i.test(error?.message ?? "");
    return Response.json(
      { error: exists ? "An account with that email already exists. Sign in instead." : "Could not create the account. Please try again." },
      { status: exists ? 409 : 400 },
    );
  }

  const { error: profileError } = await db
    .from("profiles")
    .insert({ id: created.user.id, username, full_name: fullName, phone });
  if (profileError) {
    await db.auth.admin.deleteUser(created.user.id);
    return Response.json({ error: "Could not save your profile. Please try again." }, { status: 500 });
  }
  return Response.json({ ok: true });
}
