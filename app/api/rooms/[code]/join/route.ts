import { fail, getRouteParam, json, readJson } from "@/lib/server/http";
import { joinRoom } from "@/lib/server/rooms";

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await getRouteParam(context);
    const payload = await readJson<{ nickname?: string; token?: string | null }>(request);
    const result = await joinRoom(code, payload.nickname ?? "", payload.token);
    return json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to join room";
    const status = message === "game already started" ? 409 : 400;
    return fail(message, status);
  }
}
