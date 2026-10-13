import { relations } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const hostAuth = sqliteTable("host_auth", {
  username: text("username").primaryKey(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const hostSessions = sqliteTable("host_sessions", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const quizzes = sqliteTable("quizzes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  questionsJson: text("questions_json").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  deletedAt: integer("deleted_at"),
});

export const rooms = sqliteTable("rooms", {
  code: text("code").primaryKey(),
  quizId: text("quiz_id").references(() => quizzes.id, { onDelete: "set null" }),
  status: text("status", {
    enum: ["lobby", "question", "closed", "revealed", "finished"],
  }).notNull(),
  currentPosition: integer("current_position"),
  roundNumber: integer("round_number").notNull().default(0),
  scoredRound: integer("scored_round"),
  acceptingAnswers: integer("accepting_answers", { mode: "boolean" }).notNull().default(false),
  title: text("title").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  startedAt: integer("started_at"),
  endedAt: integer("ended_at"),
  deletedAt: integer("deleted_at"),
});

export const roomQuestions = sqliteTable(
  "room_questions",
  {
    id: text("id").primaryKey(),
    roomCode: text("room_code")
      .notNull()
      .references(() => rooms.code, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    questionJson: text("question_json").notNull(),
    isTiebreaker: integer("is_tiebreaker", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    roomPosition: uniqueIndex("room_questions_room_position_idx").on(
      table.roomCode,
      table.position
    ),
  })
);

export const participants = sqliteTable(
  "participants",
  {
    id: text("id").primaryKey(),
    roomCode: text("room_code")
      .notNull()
      .references(() => rooms.code, { onDelete: "cascade" }),
    nickname: text("nickname").notNull(),
    tokenHash: text("token_hash").notNull(),
    status: text("status", {
      enum: ["active", "eliminated", "spectator", "winner"],
    }).notNull(),
    score: integer("score").notNull().default(0),
    correctCount: integer("correct_count").notNull().default(0),
    eliminatedRound: integer("eliminated_round"),
    joinedAt: integer("joined_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (table) => ({
    roomIdx: index("participants_room_idx").on(table.roomCode),
    tokenHashIdx: uniqueIndex("participants_token_hash_idx").on(table.tokenHash),
    roomNicknameIdx: uniqueIndex("participants_room_nickname_idx").on(table.roomCode, table.nickname),
  })
);

export const answers = sqliteTable(
  "answers",
  {
    id: text("id").primaryKey(),
    roomCode: text("room_code")
      .notNull()
      .references(() => rooms.code, { onDelete: "cascade" }),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    roundNumber: integer("round_number").notNull(),
    position: integer("position").notNull(),
    answerJson: text("answer_json").notNull(),
    isCorrect: integer("is_correct", { mode: "boolean" }),
    submittedAt: integer("submitted_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    roomRoundParticipantIdx: uniqueIndex("answers_room_round_participant_idx").on(
      table.roomCode,
      table.roundNumber,
      table.participantId
    ),
    roomRoundIdx: index("answers_room_round_idx").on(table.roomCode, table.roundNumber),
  })
);

export const roomsRelations = relations(rooms, ({ many, one }) => ({
  quiz: one(quizzes, {
    fields: [rooms.quizId],
    references: [quizzes.id],
  }),
  questions: many(roomQuestions),
  participants: many(participants),
  answers: many(answers),
}));
