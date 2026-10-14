import { isAuthError, requireHost } from "@/lib/server/auth";
import { deleteQuiz, getQuiz, updateQuiz } from "@/lib/server/quizzes";
import { fail, getRouteParam, json, readJson } from "@/lib/server/http";
import type { QuizPayload } from "@/lib/server/types";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { username } = await requireHost(request);
    const { id } = await getRouteParam(context);
    const quiz = await getQuiz(username, id);
    return quiz ? json({ quiz }) : fail("quiz not found", 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to read quiz";
    return fail(message, isAuthError(error) ? 401 : 500);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { username } = await requireHost(request);
    const { id } = await getRouteParam(context);
    const quiz = await updateQuiz(username, id, await readJson<QuizPayload>(request));
    return quiz ? json({ quiz }, { headers: { "Cache-Control": "no-store" } }) : fail("quiz not found", 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to update quiz";
    return fail(message, isAuthError(error) ? 401 : 400);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { username } = await requireHost(request);
    const { id } = await getRouteParam(context);
    return (await deleteQuiz(username, id))
      ? json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
      : fail("quiz not found", 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to delete quiz";
    return fail(message, isAuthError(error) ? 401 : 500);
  }
}
