import { isAuthError, requireHost } from "@/lib/server/auth";
import { fail, getRouteParam, json } from "@/lib/server/http";
import { finishRoom, getRoomState } from "@/lib/server/rooms";

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { username } = await requireHost(request);
    const { code } = await getRouteParam(context);
    await finishRoom(username, code);
    return json(await getRoomState(code, "host", null, username), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to finish room";
    return fail(message, isAuthError(error) ? 401 : 400);
  }
}
