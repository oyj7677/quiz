import { env } from "cloudflare:workers";

type RuntimeEnv = Cloudflare.Env & Record<string, string | undefined>;

export function getRuntimeEnv() {
  return env as RuntimeEnv;
}

export function requireSecret(name: "HOST_BOOTSTRAP_PASSWORD" | "OYJ_BOOTSTRAP_PASSWORD" | "SESSION_SECRET") {
  const value = getRuntimeEnv()[name];

  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}

export function requireBucket() {
  const bucket = getRuntimeEnv().BUCKET;

  if (!bucket) {
    throw new Error("Cloudflare R2 binding `BUCKET` is unavailable.");
  }

  return bucket;
}

export function requireD1() {
  const db = getRuntimeEnv().DB;

  if (!db) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  }

  return db;
}
