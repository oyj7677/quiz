import type { AnswerValue, Question, QuizPayload } from "./types";

const MAX_IMAGES = 4;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

function cleanString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function cleanStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("ko-KR");
}

export function normalizeAnswer(value: AnswerValue) {
  if (Array.isArray(value)) {
    return value.map(normalizeText).sort();
  }

  return normalizeText(value);
}

export function answerMatches(question: Question, value: AnswerValue) {
  const expected = normalizeAnswer(question.correctAnswers);
  const actual = normalizeAnswer(value);

  if (Array.isArray(actual)) {
    return Array.isArray(expected)
      ? actual.length === expected.length && actual.every((item, index) => item === expected[index])
      : false;
  }

  if (Array.isArray(expected)) {
    return expected.includes(actual);
  }

  return actual === expected;
}

export function parseAnswerValue(value: unknown): AnswerValue {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.map((item) => item.trim()).filter(Boolean);
  }

  throw new Error("답안을 입력해 주세요.");
}

export function validateQuestion(input: unknown, index = 0, forceTiebreaker = false): Question {
  if (!input || typeof input !== "object") {
    throw new Error(`question ${index + 1} is invalid`);
  }

  const record = input as Record<string, unknown>;
  const kind = record.kind;
  if (kind !== "ox" && kind !== "multiple" && kind !== "short") {
    throw new Error(`question ${index + 1} kind is invalid`);
  }

  const prompt = cleanString(record.prompt);
  if (!prompt) {
    throw new Error(`question ${index + 1} prompt is required`);
  }

  const images = cleanStringArray(record.images);
  if (images.length > MAX_IMAGES) {
    throw new Error(`question ${index + 1} can have up to ${MAX_IMAGES} images`);
  }

  const correctAnswers = cleanStringArray(record.correctAnswers);
  if (correctAnswers.length === 0) {
    throw new Error(`question ${index + 1} correctAnswers is required`);
  }

  const question: Question = {
    id: cleanString(record.id) || crypto.randomUUID(),
    kind,
    prompt,
    correctAnswers,
    explanation: cleanString(record.explanation),
    images,
    isTiebreaker: forceTiebreaker || Boolean(record.isTiebreaker),
  };

  if (kind === "ox") {
    const normalized = correctAnswers.map((answer) => answer.toLocaleUpperCase("ko-KR"));
    if (!normalized.every((answer) => answer === "O" || answer === "X")) {
      throw new Error(`question ${index + 1} O/X answer must be O or X`);
    }
    question.options = ["O", "X"];
    question.correctAnswers = normalized;
  }

  if (kind === "multiple") {
    const options = cleanStringArray(record.options);
    if (options.length < 2) {
      throw new Error(`question ${index + 1} options must have at least 2 items`);
    }
    if (options.length > 8) {
      throw new Error(`question ${index + 1} options can have up to 8 items`);
    }
    if (!correctAnswers.every((answer) => options.includes(answer))) {
      throw new Error(`question ${index + 1} correctAnswers must match options`);
    }
    question.options = options;
  }

  return question;
}

export function validateQuizPayload(payload: QuizPayload) {
  const title = cleanString(payload.title);
  if (!title) {
    throw new Error("제목을 입력해 주세요.");
  }

  const questions = Array.isArray(payload.questions) ? payload.questions : [];
  if (questions.length === 0) {
    throw new Error("문제를 1개 이상 추가해 주세요.");
  }

  return {
    title,
    description: cleanString(payload.description),
    questions: questions.map((question, index) => validateQuestion(question, index)),
  };
}

export async function assertImage(file: File) {
  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowed.has(file.type)) {
    throw new Error("JPEG, PNG, WebP 사진만 첨부할 수 있습니다.");
  }

  if (file.size > MAX_IMAGE_SIZE) {
    throw new Error("사진은 5MB 이하만 첨부할 수 있습니다.");
  }

  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const isPng =
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47 &&
    header[4] === 0x0d &&
    header[5] === 0x0a &&
    header[6] === 0x1a &&
    header[7] === 0x0a;
  const isWebp =
    header[0] === 0x52 &&
    header[1] === 0x49 &&
    header[2] === 0x46 &&
    header[3] === 0x46 &&
    header[8] === 0x57 &&
    header[9] === 0x45 &&
    header[10] === 0x42 &&
    header[11] === 0x50;

  if (
    (file.type === "image/jpeg" && !isJpeg) ||
    (file.type === "image/png" && !isPng) ||
    (file.type === "image/webp" && !isWebp)
  ) {
    throw new Error("사진 파일 형식이 올바르지 않습니다.");
  }
}

export function publicQuestion(question: Question, reveal = false) {
  const { correctAnswers, explanation, ...safeQuestion } = question;
  return reveal ? { ...safeQuestion, correctAnswers, explanation } : safeQuestion;
}
