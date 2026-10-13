"use client";

export type QuestionKind = "ox" | "multiple" | "short";
export type RoomPhase =
  | "lobby"
  | "question"
  | "closed"
  | "revealed"
  | "finished"
  | string;

export type QuizQuestion = {
  id?: string;
  kind: QuestionKind;
  prompt: string;
  options?: string[];
  correctAnswers: string[];
  explanation?: string;
  images?: string[];
  isTiebreaker?: boolean;
};

export type QuizSet = {
  id?: string;
  title: string;
  description?: string;
  questions: QuizQuestion[];
  createdAt?: string;
  updatedAt?: string;
};

export type Participant = {
  id: string;
  nickname: string;
  rank?: number;
  score?: number;
  correctCount?: number;
  eliminated?: boolean;
  active?: boolean;
  joinedAt?: string;
};

export type AnswerRecord = {
  participantId: string;
  nickname?: string;
  answer?: string | string[];
  correct?: boolean | null;
  submittedAt?: string;
};

export type RankingRow = Participant & {
  rank?: number;
};

export type RoomState = {
  code: string;
  phase: RoomPhase;
  room?: {
    id?: string;
    code?: string;
    phase?: RoomPhase;
    joinLocked?: boolean;
    currentQuestionIndex?: number;
    submittedCount?: number;
  };
  quiz?: QuizSet;
  participants?: Participant[];
  me?: Participant | null;
  currentQuestion?: QuizQuestion | null;
  currentQuestionIndex?: number;
  answers?: AnswerRecord[];
  ranking?: RankingRow[];
  myAnswer?: AnswerRecord | null;
  winner?: RankingRow | null;
  message?: string;
};

type ApiOptions = RequestInit & {
  playerToken?: string | null;
};

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = text ? safeJson(text) : null;

  if (!response.ok) {
    const message =
      (isRecord(payload) && stringValue(payload.error)) ||
      (isRecord(payload) && stringValue(payload.message)) ||
      `요청을 처리하지 못했습니다. (${response.status})`;
    throw new ApiError(response.status, message);
  }

  return (payload ?? {}) as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const hasBody = options.body !== undefined;

  if (hasBody && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (options.playerToken) {
    headers.set("X-Player-Token", options.playerToken);
  }

  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "include",
  });

  return parseResponse<T>(response);
}

export const quizApi = {
  hostLogin(username: string, password: string) {
    return apiFetch<{ ok?: boolean; host?: { username: string } }>("/api/host/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },
  hostLogout() {
    return apiFetch<{ ok?: boolean }>("/api/host/logout", { method: "POST" });
  },
  getHost() {
    return apiFetch<{ host?: { username: string } }>("/api/host/me");
  },
  changePassword(currentPassword: string, nextPassword: string) {
    return apiFetch<{ ok?: boolean }>("/api/host/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, nextPassword }),
    });
  },
  listQuizzes() {
    return apiFetch<{ quizzes?: QuizSet[] } | QuizSet[]>("/api/quizzes");
  },
  saveQuiz(quiz: QuizSet) {
    return apiFetch<{ quiz?: QuizSet } | QuizSet>("/api/quizzes", {
      method: "POST",
      body: JSON.stringify(quiz),
    });
  },
  updateQuiz(id: string, quiz: QuizSet) {
    return apiFetch<{ quiz?: QuizSet } | QuizSet>(`/api/quizzes/${id}`, {
      method: "PUT",
      body: JSON.stringify(quiz),
    });
  },
  deleteQuiz(id: string) {
    return apiFetch<{ ok?: boolean }>(`/api/quizzes/${id}`, { method: "DELETE" });
  },
  uploadImage(file: File) {
    const form = new FormData();
    form.set("file", file);
    return apiFetch<{ url: string; key?: string }>("/api/images", {
      method: "POST",
      body: form,
    });
  },
  createRoom(quizId: string) {
    return apiFetch<{ room?: { code: string }; code?: string }>("/api/rooms", {
      method: "POST",
      body: JSON.stringify({ quizId }),
    });
  },
  listRooms() {
    return apiFetch<{ rooms?: Array<{ code: string; phase?: RoomPhase; createdAt?: string }> }>("/api/rooms");
  },
  deleteRoom(code: string) {
    return apiFetch<{ ok?: boolean }>(`/api/rooms/${code}`, { method: "DELETE" });
  },
  roomState(code: string, playerToken?: string | null) {
    return apiFetch<RoomState>(`/api/rooms/${code}/state`, { playerToken });
  },
  displayState(code: string) {
    return apiFetch<RoomState>(`/api/rooms/${code}/state?view=display`);
  },
  joinRoom(code: string, nickname: string, token?: string | null) {
    return apiFetch<{ token: string; participantId: string; nickname: string }>(
      `/api/rooms/${code}/join`,
      {
        method: "POST",
        body: JSON.stringify({ nickname, token }),
      },
    );
  },
  startRoom(code: string) {
    return apiFetch<RoomState>(`/api/rooms/${code}/start`, { method: "POST" });
  },
  submitAnswer(code: string, answer: string | string[], playerToken: string) {
    return apiFetch<RoomState>(`/api/rooms/${code}/answer`, {
      method: "POST",
      playerToken,
      body: JSON.stringify({ answer }),
    });
  },
  closeQuestion(code: string) {
    return apiFetch<RoomState>(`/api/rooms/${code}/close`, { method: "POST" });
  },
  gradeAnswer(code: string, participantId: string, correct: boolean) {
    return apiFetch<RoomState>(`/api/rooms/${code}/grade`, {
      method: "POST",
      body: JSON.stringify({ participantId, correct }),
    });
  },
  revealQuestion(code: string) {
    return apiFetch<RoomState>(`/api/rooms/${code}/reveal`, { method: "POST" });
  },
  nextQuestion(code: string) {
    return apiFetch<RoomState>(`/api/rooms/${code}/next`, { method: "POST" });
  },
  createTiebreaker(code: string, question: QuizQuestion) {
    return apiFetch<RoomState>(`/api/rooms/${code}/tiebreaker`, {
      method: "POST",
      body: JSON.stringify({ question }),
    });
  },
};

export function normalizeQuizList(value: { quizzes?: QuizSet[] } | QuizSet[]): QuizSet[] {
  if (Array.isArray(value)) {
    return value;
  }

  return value.quizzes ?? [];
}

export function unwrapQuiz(value: { quiz?: QuizSet } | QuizSet): QuizSet {
  if ("quiz" in value && value.quiz) {
    return value.quiz;
  }

  return value as QuizSet;
}

export function createBlankQuestion(kind: QuestionKind = "multiple"): QuizQuestion {
  if (kind === "ox") {
    return {
      kind,
      prompt: "",
      options: ["O", "X"],
      correctAnswers: ["O"],
      images: [],
    };
  }

  if (kind === "short") {
    return {
      kind,
      prompt: "",
      correctAnswers: [""],
      images: [],
    };
  }

  return {
    kind,
    prompt: "",
    options: ["", "", "", ""],
    correctAnswers: [""],
    images: [],
  };
}

export function phaseLabel(phase?: RoomPhase | null): string {
  switch (phase) {
    case "lobby":
      return "대기";
    case "question":
      return "답안 제출 중";
    case "closed":
      return "마감";
    case "revealed":
      return "정답 공개";
    case "finished":
      return "종료";
    default:
      return phase ? String(phase) : "-";
  }
}

export function questionNumberLabel(index?: number | null): string {
  return typeof index === "number" && index >= 0 ? String(index + 1) : "-";
}
