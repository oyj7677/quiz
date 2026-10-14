import { eq, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { hostAuth, hostSessions } from "@/db/schema";
import { hashPassword, now, randomId, sign, verifyPassword } from "./crypto";
import { requireSecret } from "./env";

const COOKIE_NAME = "golden_session";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
function bootstrapSecretFor(username: string) {
  switch (username) {
    case "ming":
      return "HOST_BOOTSTRAP_PASSWORD";
    case "oyj":
      return "OYJ_BOOTSTRAP_PASSWORD";
    default:
      return null;
  }
}

export class AuthError extends Error {
  constructor(message = "로그인이 필요합니다.") {
    super(message);
    this.name = "AuthError";
  }
}

export function isAuthError(error: unknown) {
  return error instanceof AuthError;
}

function parseCookies(request: Request) {
  const header = request.headers.get("cookie") ?? "";
  return Object.fromEntries(
    header
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf("=");
        return index === -1 ? [item, ""] : [item.slice(0, index), decodeURIComponent(item.slice(index + 1))];
      })
  );
}

async function signedSessionValue(id: string) {
  return `${id}.${await sign(id, requireSecret("SESSION_SECRET"))}`;
}

async function readSessionId(request: Request) {
  const value = parseCookies(request)[COOKIE_NAME];
  if (!value) {
    return null;
  }

  const [id, signature] = value.split(".");
  if (!id || !signature) {
    return null;
  }

  const expected = await sign(id, requireSecret("SESSION_SECRET"));
  return signature === expected ? id : null;
}

export async function loginHost(username: string, password: string, secureCookie: boolean) {
  const bootstrapSecret = bootstrapSecretFor(username);
  if (!bootstrapSecret) {
    return null;
  }

  const db = getDb();
  const existing = await db.query.hostAuth.findFirst({ where: eq(hostAuth.username, username) });
  const timestamp = now();

  if (existing) {
    const matches = await verifyPassword(password, existing.passwordHash);
    if (!matches) {
      return null;
    }
  } else {
    const bootstrapPassword = requireSecret(bootstrapSecret);
    if (password !== bootstrapPassword) {
      return null;
    }

    await db.insert(hostAuth).values({
      username,
      passwordHash: await hashPassword(password),
      createdAt: timestamp,
      updatedAt: timestamp,
    }).onConflictDoNothing();

    const provisioned = await db.query.hostAuth.findFirst({ where: eq(hostAuth.username, username) });
    if (!provisioned || !(await verifyPassword(password, provisioned.passwordHash))) {
      return null;
    }
  }

  const sessionId = randomId("sess_");
  await db.delete(hostSessions).where(lt(hostSessions.expiresAt, timestamp));
  await db.insert(hostSessions).values({
    id: sessionId,
    username,
    createdAt: timestamp,
    expiresAt: timestamp + SESSION_MS,
  });

  return {
    username,
    cookie: `${COOKIE_NAME}=${encodeURIComponent(await signedSessionValue(sessionId))}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(
      SESSION_MS / 1000
    )}${secureCookie ? "; Secure" : ""}`,
  };
}

export async function getHostSession(request: Request) {
  const sessionId = await readSessionId(request);
  if (!sessionId) {
    return null;
  }

  const session = await getDb().query.hostSessions.findFirst({
    where: eq(hostSessions.id, sessionId),
  });

  if (!session || session.expiresAt <= now()) {
    return null;
  }

  return { username: session.username, sessionId };
}

export async function requireHost(request: Request) {
  const session = await getHostSession(request);
  if (!session) {
    throw new AuthError();
  }
  return session;
}

export async function logoutHost(request: Request) {
  const sessionId = await readSessionId(request);
  if (sessionId) {
    await getDb().delete(hostSessions).where(eq(hostSessions.id, sessionId));
  }
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

export async function changeHostPassword(username: string, currentPassword: string, nextPassword: string) {
  const db = getDb();
  const existing = await db.query.hostAuth.findFirst({ where: eq(hostAuth.username, username) });

  if (!existing || !(await verifyPassword(currentPassword, existing.passwordHash))) {
    throw new Error("현재 비밀번호가 올바르지 않습니다.");
  }

  if (nextPassword.length < 4) {
    throw new Error("새 비밀번호는 4자 이상이어야 합니다.");
  }

  await db
    .update(hostAuth)
    .set({ passwordHash: await hashPassword(nextPassword), updatedAt: now() })
    .where(eq(hostAuth.username, username));
  await db.delete(hostSessions).where(eq(hostSessions.username, username));
}
