import { isAuthError, requireHost } from "@/lib/server/auth";
import { deleteRoom } from "@/lib/server/rooms";
import { fail, getRouteParam, json } from "@/lib/server/http";

export async function DELETE(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    await requireHost(request);
    const { code } = await getRouteParam(context);
    return json({ ok: await deleteRoom(code) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to delete room";
    return fail(message, isAuthError(error) ? 401 : 500);
  }
}
