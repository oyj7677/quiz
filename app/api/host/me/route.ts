import { getHostSession } from "@/lib/server/auth";
import { json } from "@/lib/server/http";

export async function GET(request: Request) {
  const session = await getHostSession(request);
  return json(
    session ? { host: { username: session.username } } : { host: null },
    { status: session ? 200 : 401, headers: { "Cache-Control": "no-store" } }
  );
}
