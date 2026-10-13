import { loginHost } from "@/lib/server/auth";
import { fail, json, readJson } from "@/lib/server/http";

export async function POST(request: Request) {
  try {
    const payload = await readJson<{ username?: string; password?: string }>(request);
    const secureCookie = new URL(request.url).protocol === "https:";
    const login = await loginHost(payload.username ?? "", payload.password ?? "", secureCookie);
    if (!login) {
      return fail("invalid credentials", 401);
    }

    return json(
      { ok: true, host: { username: login.username } },
      { headers: { "Set-Cookie": login.cookie, "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : "login failed", 500);
  }
}
