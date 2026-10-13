import { isAuthError, requireHost } from "@/lib/server/auth";
import { fail, getRouteParam, json } from "@/lib/server/http";
import { restoreQuiz } from "@/lib/server/quizzes";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireHost(request);
    const { id } = await getRouteParam(context);
    return (await restoreQuiz(id))
      ? json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
      : fail("deleted quiz not found", 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to restore quiz";
    return fail(message, isAuthError(error) ? 401 : 500);
  }
}
