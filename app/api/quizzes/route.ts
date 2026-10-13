import { isAuthError, requireHost } from "@/lib/server/auth";
import { createQuiz, listQuizzes } from "@/lib/server/quizzes";
import { fail, json, readJson } from "@/lib/server/http";
import type { QuizPayload } from "@/lib/server/types";

export async function GET(request: Request) {
  try {
    await requireHost(request);
    return json({ quizzes: await listQuizzes() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to list quizzes";
    return fail(message, isAuthError(error) ? 401 : 500);
  }
}

export async function POST(request: Request) {
  try {
    await requireHost(request);
    const quiz = await createQuiz(await readJson<QuizPayload>(request));
    return json({ quiz }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to save quiz";
    return fail(message, isAuthError(error) ? 401 : 400);
  }
}
