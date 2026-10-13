import { isAuthError, requireHost } from "@/lib/server/auth";
import { fail, json } from "@/lib/server/http";
import { listDeletedRooms } from "@/lib/server/rooms";

export async function GET(request: Request) {
  try {
    await requireHost(request);
    return json({ rooms: await listDeletedRooms() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to list deleted rooms";
    return fail(message, isAuthError(error) ? 401 : 500);
  }
}
