import { isAuthError, requireHost } from "@/lib/server/auth";
import { fail, json } from "@/lib/server/http";
import { listDeletedQuizzes } from "@/lib/server/quizzes";

export async function GET(request: Request) {
  try {
    const { username } = await requireHost(request);
    return json({ quizzes: await listDeletedQuizzes(username) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to list deleted quizzes";
    return fail(message, isAuthError(error) ? 401 : 500);
  }
}
