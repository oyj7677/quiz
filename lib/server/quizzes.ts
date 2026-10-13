import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { quizzes } from "@/db/schema";
import { now, randomId } from "./crypto";
import type { Question, QuizPayload } from "./types";
import { validateQuizPayload } from "./validation";

export function parseQuestions(value: string): Question[] {
  return JSON.parse(value) as Question[];
}

export function toQuiz(row: typeof quizzes.$inferSelect) {
  const questions = parseQuestions(row.questionsJson);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    questions,
    questionCount: questions.length,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    deletedAt: row.deletedAt ? new Date(row.deletedAt).toISOString() : undefined,
  };
}

export async function listQuizzes() {
  const rows = await getDb()
    .select()
    .from(quizzes)
    .where(isNull(quizzes.deletedAt))
    .orderBy(desc(quizzes.updatedAt));
  return rows.map(toQuiz);
}

export async function listDeletedQuizzes() {
  const rows = await getDb()
    .select()
    .from(quizzes)
    .where(isNotNull(quizzes.deletedAt))
    .orderBy(desc(quizzes.deletedAt));
  return rows.map(toQuiz);
}

export async function createQuiz(payload: QuizPayload) {
  const parsed = validateQuizPayload(payload);
  const timestamp = now();
  const [quiz] = await getDb()
    .insert(quizzes)
    .values({
      id: randomId("quiz_"),
      title: parsed.title,
      description: parsed.description,
      questionsJson: JSON.stringify(parsed.questions),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();
  return toQuiz(quiz);
}

export async function getQuiz(id: string) {
  const quiz = await getDb().query.quizzes.findFirst({
    where: and(eq(quizzes.id, id), isNull(quizzes.deletedAt)),
  });
  return quiz ? toQuiz(quiz) : null;
}

export async function updateQuiz(id: string, payload: QuizPayload) {
  const parsed = validateQuizPayload(payload);
  const [quiz] = await getDb()
    .update(quizzes)
    .set({
      title: parsed.title,
      description: parsed.description,
      questionsJson: JSON.stringify(parsed.questions),
      updatedAt: now(),
    })
    .where(and(eq(quizzes.id, id), isNull(quizzes.deletedAt)))
    .returning();
  return quiz ? toQuiz(quiz) : null;
}

export async function deleteQuiz(id: string) {
  const timestamp = now();
  const result = await getDb()
    .update(quizzes)
    .set({ deletedAt: timestamp, updatedAt: timestamp })
    .where(and(eq(quizzes.id, id), isNull(quizzes.deletedAt)))
    .returning();
  return result.length > 0;
}

export async function restoreQuiz(id: string) {
  const result = await getDb()
    .update(quizzes)
    .set({ deletedAt: null, updatedAt: now() })
    .where(and(eq(quizzes.id, id), isNotNull(quizzes.deletedAt)))
    .returning();
  return result.length > 0;
}
