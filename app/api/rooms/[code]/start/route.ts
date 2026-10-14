import { isAuthError, requireHost } from "@/lib/server/auth";
import { fail, getRouteParam, json } from "@/lib/server/http";
import { getRoomState, startRoom } from "@/lib/server/rooms";

async function readOptions(request: Request) {
  const text = await request.text();
  if (!text.trim()) return {};
  const payload = JSON.parse(text) as { category?: "regular"; questionId?: string; selectionMode?: string; playMode?: string };
  return { category: payload.category, questionId: payload.questionId, selectionMode: payload.selectionMode ?? payload.playMode };
}

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    await requireHost(request);
    const { code } = await getRouteParam(context);
    await startRoom(code, await readOptions(request));
    return json(await getRoomState(code, "host"), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to start room";
    return fail(message, isAuthError(error) ? 401 : 400);
  }
}
