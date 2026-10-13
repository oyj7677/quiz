import { isAuthError, requireHost } from "@/lib/server/auth";
import { fail, getRouteParam, json } from "@/lib/server/http";
import { getRoomState, nextQuestion } from "@/lib/server/rooms";

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    await requireHost(request);
    const { code } = await getRouteParam(context);
    await nextQuestion(code);
    return json(await getRoomState(code, "host"), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to move next";
    return fail(message, isAuthError(error) ? 401 : 400);
  }
}
