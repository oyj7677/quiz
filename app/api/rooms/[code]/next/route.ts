import { isAuthError, requireHost } from "@/lib/server/auth";
import { fail, getRouteParam, json } from "@/lib/server/http";
import { getRoomState, nextQuestion } from "@/lib/server/rooms";

async function readOptions(request: Request) {
  const text = await request.text();
  if (!text.trim()) return {};
  const payload = JSON.parse(text) as {
    category?: "regular" | "revival" | "tiebreaker";
    questionId?: string;
    selectionMode?: string;
    playMode?: string;
  };
  return { category: payload.category, questionId: payload.questionId, selectionMode: payload.selectionMode ?? payload.playMode };
}

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { username } = await requireHost(request);
    const { code } = await getRouteParam(context);
    await nextQuestion(username, code, await readOptions(request));
    return json(await getRoomState(code, "host", null, username), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to move next";
    return fail(message, isAuthError(error) ? 401 : 400);
  }
}
