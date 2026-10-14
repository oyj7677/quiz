import { changeHostPassword, isAuthError, requireHost } from "@/lib/server/auth";
import { fail, json, readJson } from "@/lib/server/http";

export async function POST(request: Request) {
  try {
    const host = await requireHost(request);
    const payload = await readJson<{ currentPassword?: string; newPassword?: string }>(request);
    await changeHostPassword(host.username, payload.currentPassword ?? "", payload.newPassword ?? "");
    return json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "password change failed";
    return fail(message, isAuthError(error) ? 401 : 400);
  }
}
