import { isAuthError, requireHost } from "@/lib/server/auth";
import { fail, getRouteParam, json, readJson } from "@/lib/server/http";
import { getRoomState, gradeAnswer } from "@/lib/server/rooms";

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { username } = await requireHost(request);
    const { code } = await getRouteParam(context);
    const payload = await readJson<{ participantId?: string; correct?: boolean }>(request);
    await gradeAnswer(username, code, payload.participantId ?? "", Boolean(payload.correct));
    return json(await getRoomState(code, "host", null, username), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to grade answer";
    return fail(message, isAuthError(error) ? 401 : 400);
  }
}
