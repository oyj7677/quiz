import { getHostSession } from "@/lib/server/auth";
import { fail, getRouteParam, json } from "@/lib/server/http";
import { getRoomState, isRoomOwnedBy, playerTokenFrom } from "@/lib/server/rooms";

export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await getRouteParam(context);
    const host = await getHostSession(request);
    const playerToken = playerTokenFrom(request);
    const view = new URL(request.url).searchParams.get("view");
    if (view === "display") {
      return json(await getRoomState(code, "display"), { headers: { "Cache-Control": "no-store" } });
    }
    const ownsRoom = host ? await isRoomOwnedBy(host.username, code) : false;
    if (!ownsRoom && !playerToken) {
      if (host) return fail("방을 찾을 수 없습니다.", 403);
      return fail("로그인 또는 참가자 인증이 필요합니다.", 401);
    }

    const state = playerToken
      ? await getRoomState(code, "player", playerToken)
      : await getRoomState(code, "host", null, host?.username);
    return json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to read room";
    return fail(message, message === "player token is invalid" ? 401 : 400);
  }
}
