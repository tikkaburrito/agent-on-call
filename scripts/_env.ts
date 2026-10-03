// Shared helpers for the test scripts. Loads .env.local; never prints values.
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local", quiet: true });

export const SITE_A = "11111111-1111-4111-8111-111111111111"; // Sunrise Yoga Studio
export const SITE_B = "22222222-2222-4222-8222-222222222222"; // Harbor Coffee Roasters

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in .env.local`);
  return v;
}

export const FUNCTIONS_URL = `${env("NEXT_PUBLIC_SUPABASE_URL")}/functions/v1`;

export const admin = () =>
  createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

export const anon = () =>
  createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false },
  });

let failures = 0;
export function check(name: string, pass: boolean, detail = "") {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
export function finish() {
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}
