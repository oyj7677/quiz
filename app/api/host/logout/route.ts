import { clearSessionCookie, logoutHost } from "@/lib/server/auth";
import { fail, json } from "@/lib/server/http";

export async function POST(request: Request) {
  try {
    await logoutHost(request);
    return json(
      { ok: true },
      { headers: { "Set-Cookie": clearSessionCookie(), "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : "logout failed", 500);
  }
}
