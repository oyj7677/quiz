import { isAuthError, requireHost } from "@/lib/server/auth";
import { closeQuestion, getRoomState } from "@/lib/server/rooms";
import { fail, getRouteParam, json } from "@/lib/server/http";

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    await requireHost(request);
    const { code } = await getRouteParam(context);
    await closeQuestion(code);
    return json(await getRoomState(code, "host"), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to close question";
    return fail(message, isAuthError(error) ? 401 : 400);
  }
}
