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

export async function listQuizzes(ownerUsername: string) {
  const rows = await getDb()
    .select()
    .from(quizzes)
    .where(and(eq(quizzes.ownerUsername, ownerUsername), isNull(quizzes.deletedAt)))
    .orderBy(desc(quizzes.updatedAt));
  return rows.map(toQuiz);
}

export async function listDeletedQuizzes(ownerUsername: string) {
  const rows = await getDb()
    .select()
    .from(quizzes)
    .where(and(eq(quizzes.ownerUsername, ownerUsername), isNotNull(quizzes.deletedAt)))
    .orderBy(desc(quizzes.deletedAt));
  return rows.map(toQuiz);
}

export async function createQuiz(ownerUsername: string, payload: QuizPayload) {
  const parsed = validateQuizPayload(payload);
  const timestamp = now();
  const [quiz] = await getDb()
    .insert(quizzes)
    .values({
      id: randomId("quiz_"),
      ownerUsername,
      title: parsed.title,
      description: parsed.description,
      questionsJson: JSON.stringify(parsed.questions),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();
  return toQuiz(quiz);
}

export async function getQuiz(ownerUsername: string, id: string) {
  const quiz = await getDb().query.quizzes.findFirst({
    where: and(eq(quizzes.id, id), eq(quizzes.ownerUsername, ownerUsername), isNull(quizzes.deletedAt)),
  });
  return quiz ? toQuiz(quiz) : null;
}

export async function updateQuiz(ownerUsername: string, id: string, payload: QuizPayload) {
  const parsed = validateQuizPayload(payload);
  const [quiz] = await getDb()
    .update(quizzes)
    .set({
      title: parsed.title,
      description: parsed.description,
      questionsJson: JSON.stringify(parsed.questions),
      updatedAt: now(),
    })
    .where(and(eq(quizzes.id, id), eq(quizzes.ownerUsername, ownerUsername), isNull(quizzes.deletedAt)))
    .returning();
  return quiz ? toQuiz(quiz) : null;
}

export async function deleteQuiz(ownerUsername: string, id: string) {
  const timestamp = now();
  const result = await getDb()
    .update(quizzes)
    .set({ deletedAt: timestamp, updatedAt: timestamp })
    .where(and(eq(quizzes.id, id), eq(quizzes.ownerUsername, ownerUsername), isNull(quizzes.deletedAt)))
    .returning();
  return result.length > 0;
}

export async function restoreQuiz(ownerUsername: string, id: string) {
  const result = await getDb()
    .update(quizzes)
    .set({ deletedAt: null, updatedAt: now() })
    .where(and(eq(quizzes.id, id), eq(quizzes.ownerUsername, ownerUsername), isNotNull(quizzes.deletedAt)))
    .returning();
  return result.length > 0;
}
