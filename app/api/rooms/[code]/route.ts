import { isAuthError, requireHost } from "@/lib/server/auth";
import { deleteRoom } from "@/lib/server/rooms";
import { fail, getRouteParam, json } from "@/lib/server/http";

export async function DELETE(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    await requireHost(request);
    const { code } = await getRouteParam(context);
    return (await deleteRoom(code))
      ? json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
      : fail("room not found", 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to delete room";
    return fail(message, isAuthError(error) ? 401 : 400);
  }
}
