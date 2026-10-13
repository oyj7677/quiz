import { isAuthError, requireHost } from "@/lib/server/auth";
import { createTiebreaker, getRoomState } from "@/lib/server/rooms";
import { fail, getRouteParam, json, readJson } from "@/lib/server/http";

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    await requireHost(request);
    const { code } = await getRouteParam(context);
    const payload = await readJson<{ question?: unknown }>(request);
    await createTiebreaker(code, payload.question);
    return json(await getRoomState(code, "host"), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to add tiebreaker";
    return fail(message, isAuthError(error) ? 401 : 400);
  }
}
