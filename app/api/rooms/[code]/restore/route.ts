import { isAuthError, requireHost } from "@/lib/server/auth";
import { fail, getRouteParam, json } from "@/lib/server/http";
import { restoreRoom } from "@/lib/server/rooms";

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { username } = await requireHost(request);
    const { code } = await getRouteParam(context);
    return (await restoreRoom(username, code))
      ? json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
      : fail("deleted room not found", 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to restore room";
    return fail(message, isAuthError(error) ? 401 : 500);
  }
}
