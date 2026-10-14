import { isAuthError, requireHost } from "@/lib/server/auth";
import { createRoom, listRooms } from "@/lib/server/rooms";
import { fail, json, readJson } from "@/lib/server/http";

export async function GET(request: Request) {
  try {
    const { username } = await requireHost(request);
    return json({ rooms: await listRooms(username) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to list rooms";
    return fail(message, isAuthError(error) ? 401 : 500);
  }
}

export async function POST(request: Request) {
  try {
    const { username } = await requireHost(request);
    const payload = await readJson<{ quizId?: string }>(request);
    const code = await createRoom(username, payload.quizId ?? "");
    return json({ code, room: { code } }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to create room";
    return fail(message, isAuthError(error) ? 401 : 400);
  }
}
