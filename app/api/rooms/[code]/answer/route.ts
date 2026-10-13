import { fail, getRouteParam, json, readJson } from "@/lib/server/http";
import { getRoomState, playerTokenFrom, submitAnswer } from "@/lib/server/rooms";

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await getRouteParam(context);
    const token = playerTokenFrom(request);
    const payload = await readJson<{ answer?: unknown }>(request);
    await submitAnswer(code, token, payload.answer);
    return json(await getRoomState(code, "player", token), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to submit answer";
    return fail(message, message.includes("token") ? 401 : 400);
  }
}
