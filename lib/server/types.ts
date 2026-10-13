export type QuestionKind = "ox" | "multiple" | "short";

export type Question = {
  id?: string;
  kind: QuestionKind;
  prompt: string;
  options?: string[];
  correctAnswers: string[];
  explanation?: string;
  images?: string[];
  isTiebreaker?: boolean;
};

export type QuizPayload = {
  title?: string;
  description?: string;
  questions?: Question[];
};

export type RoomStatus = "lobby" | "question" | "closed" | "revealed" | "finished";
export type ParticipantStatus = "active" | "eliminated" | "spectator" | "winner";

export type AnswerValue = string | string[];
