import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { answers, participants, quizzes, roomQuestions, rooms } from "@/db/schema";
import { now, randomId, roomCode, sign } from "./crypto";
import { requireD1, requireSecret } from "./env";
import type { AnswerValue, Question, QuestionCategory } from "./types";
import { answerMatches, normalizeQuestionCategory, parseAnswerValue, publicQuestion, validateQuestion } from "./validation";

const MAX_PARTICIPANTS = 50;

type Role = "host" | "player" | "display";
type SelectionMode = "random" | "sequential";

type DbRoom = typeof rooms.$inferSelect;
type DbParticipant = typeof participants.$inferSelect;
type DbRoomQuestion = typeof roomQuestions.$inferSelect;
function parseQuestion(value: string): Question {
  return JSON.parse(value) as Question;
}

function parseAnswer(value: string): AnswerValue {
  return JSON.parse(value) as AnswerValue;
}

function parseStringArray(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function iso(value: number | null) {
  return value ? new Date(value).toISOString() : undefined;
}

function questionCategory(question: Question, row?: Pick<DbRoomQuestion, "category" | "isTiebreaker">): QuestionCategory {
  return normalizeQuestionCategory(question.category ?? row?.category, Boolean(question.isTiebreaker || row?.isTiebreaker));
}

function requestedCategory(value: unknown, fallback: QuestionCategory): QuestionCategory {
  if (value === "regular" || value === "revival" || value === "tiebreaker") {
    return value;
  }

  return fallback;
}

function normalizeSelectionMode(value: unknown, fallback: string): SelectionMode {
  if (value === "sequential" || value === "random") {
    return value;
  }

  return fallback === "sequential" ? "sequential" : "random";
}

function shuffle<T>(values: T[]) {
  const next = [...values];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function shuffledDifferent(values: string[]) {
  const shuffled = shuffle(values);
  if (values.length > 1 && shuffled.every((value, index) => value === values[index])) {
    [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
  }
  return shuffled;
}

function snapshotQuestion(question: Question) {
  const category = questionCategory(question);
  const normalized = {
    ...question,
    category,
    isTiebreaker: category === "tiebreaker",
  };

  if (normalized.kind === "order" && normalized.options?.length) {
    return {
      ...normalized,
      options: shuffledDifferent(normalized.options),
    };
  }

  return normalized;
}

function participantPublic(
  participant: DbParticipant,
  rank?: number,
  flags: { eligibleForRound?: boolean; canSubmit?: boolean } = {}
) {
  return {
    id: participant.id,
    nickname: participant.nickname,
    score: participant.score,
    correctCount: participant.correctCount,
    active: participant.status === "active" || participant.status === "winner",
    eliminated: participant.status === "eliminated",
    status: participant.status,
    eliminatedRound: participant.eliminatedRound,
    eligibleForRound: Boolean(flags.eligibleForRound),
    canSubmit: Boolean(flags.canSubmit),
    joinedAt: iso(participant.joinedAt),
    rank,
  };
}

function rankings(rows: DbParticipant[]) {
  const ordered = [...rows].sort((left, right) => {
    const leftRound = left.eliminatedRound ?? Number.MAX_SAFE_INTEGER;
    const rightRound = right.eliminatedRound ?? Number.MAX_SAFE_INTEGER;
    if (left.status === "winner" && right.status !== "winner") return -1;
    if (right.status === "winner" && left.status !== "winner") return 1;
    if (leftRound !== rightRound) return rightRound - leftRound;
    if (left.score !== right.score) return right.score - left.score;
    return left.joinedAt - right.joinedAt;
  });

  let rank = 0;
  let previousKey = "";
  return ordered.map((participant, index) => {
    const key = `${participant.status === "winner" ? "winner" : participant.eliminatedRound ?? "active"}`;
    if (key !== previousKey) {
      rank = index + 1;
      previousKey = key;
    }
    return participantPublic(participant, rank);
  });
}

async function tokenHash(token: string) {
  return sign(token, requireSecret("SESSION_SECRET"));
}

async function findParticipantByToken(roomCodeValue: string, token: string | null) {
  if (!token) {
    return null;
  }

  return getDb().query.participants.findFirst({
    where: and(
      eq(participants.roomCode, roomCodeValue),
      eq(participants.tokenHash, await tokenHash(token))
    ),
  });
}

export function playerTokenFrom(request: Request) {
  return request.headers.get("x-player-token");
}

export async function createRoom(ownerUsername: string, quizId: string) {
  const db = getDb();
  const quiz = await db.query.quizzes.findFirst({
    where: and(eq(quizzes.id, quizId), eq(quizzes.ownerUsername, ownerUsername), isNull(quizzes.deletedAt)),
  });
  if (!quiz) {
    throw new Error("퀴즈를 찾을 수 없습니다.");
  }

  const questions = (JSON.parse(quiz.questionsJson) as Question[])
    .map(snapshotQuestion)
    .sort((left, right) => {
      const order: Record<QuestionCategory, number> = { regular: 0, revival: 1, tiebreaker: 2 };
      return order[questionCategory(left)] - order[questionCategory(right)];
    });
  const timestamp = now();
  let code = roomCode();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await db.query.rooms.findFirst({ where: eq(rooms.code, code) });
    if (!existing) break;
    code = roomCode();
  }

  await db.insert(rooms).values({
    code,
    quizId,
    ownerUsername,
    status: "lobby",
    currentPosition: null,
    currentCategory: "regular",
    currentEligibleJson: "[]",
    selectionMode: "random",
    lastSurvivorIdsJson: "[]",
    roundNumber: 0,
    acceptingAnswers: false,
    scoredRound: null,
    title: quiz.title,
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: null,
    endedAt: null,
  });

  if (questions.length) {
    await db.insert(roomQuestions).values(
      questions.map((question, index) => ({
        id: randomId("rq_"),
        roomCode: code,
        position: index,
        questionJson: JSON.stringify(question),
        category: questionCategory(question),
        usedAt: null,
        isTiebreaker: questionCategory(question) === "tiebreaker",
        createdAt: timestamp,
      }))
    );
  }

  return code;
}

export async function listRooms(ownerUsername: string) {
  const rows = await getDb()
    .select({
      code: rooms.code,
      phase: rooms.status,
      title: rooms.title,
      quizTitle: quizzes.title,
      createdAt: rooms.createdAt,
      startedAt: rooms.startedAt,
      endedAt: rooms.endedAt,
    })
    .from(rooms)
    .leftJoin(quizzes, eq(rooms.quizId, quizzes.id))
    .where(and(eq(rooms.ownerUsername, ownerUsername), isNull(rooms.deletedAt)))
    .orderBy(desc(rooms.createdAt));
  return rows.map((room) => ({
    code: room.code,
    phase: room.phase,
    title: room.title,
    quizTitle: room.quizTitle ?? room.title,
    createdAt: iso(room.createdAt),
    startedAt: iso(room.startedAt),
    endedAt: iso(room.endedAt),
  }));
}

export async function listDeletedRooms(ownerUsername: string) {
  const rows = await getDb()
    .select({
      code: rooms.code,
      phase: rooms.status,
      title: rooms.title,
      quizTitle: quizzes.title,
      createdAt: rooms.createdAt,
      startedAt: rooms.startedAt,
      endedAt: rooms.endedAt,
      deletedAt: rooms.deletedAt,
    })
    .from(rooms)
    .leftJoin(quizzes, eq(rooms.quizId, quizzes.id))
    .where(and(eq(rooms.ownerUsername, ownerUsername), isNotNull(rooms.deletedAt)))
    .orderBy(desc(rooms.deletedAt));
  return rows.map((room) => ({
    code: room.code,
    phase: room.phase,
    title: room.title,
    quizTitle: room.quizTitle ?? room.title,
    createdAt: iso(room.createdAt),
    startedAt: iso(room.startedAt),
    endedAt: iso(room.endedAt),
    deletedAt: iso(room.deletedAt),
  }));
}

export async function deleteRoom(ownerUsername: string, code: string) {
  const room = await getDb().query.rooms.findFirst({
    where: and(eq(rooms.code, code), eq(rooms.ownerUsername, ownerUsername), isNull(rooms.deletedAt)),
  });
  if (!room) {
    return false;
  }
  if (room.status !== "finished") {
    throw new Error("완료된 방만 삭제할 수 있습니다.");
  }

  const timestamp = now();
  const deleted = await getDb()
    .update(rooms)
    .set({ deletedAt: timestamp, updatedAt: timestamp })
    .where(and(eq(rooms.code, code), eq(rooms.ownerUsername, ownerUsername), eq(rooms.status, "finished"), isNull(rooms.deletedAt)))
    .returning();
  return deleted.length > 0;
}

export async function restoreRoom(ownerUsername: string, code: string) {
  const restored = await getDb()
    .update(rooms)
    .set({ deletedAt: null, updatedAt: now() })
    .where(and(eq(rooms.code, code), eq(rooms.ownerUsername, ownerUsername), isNotNull(rooms.deletedAt)))
    .returning();
  return restored.length > 0;
}

export async function joinRoom(code: string, nicknameRaw: string, reconnectToken?: string | null) {
  const db = getDb();
  const room = await db.query.rooms.findFirst({
    where: and(eq(rooms.code, code), isNull(rooms.deletedAt)),
  });
  if (!room) {
    throw new Error("방을 찾을 수 없습니다.");
  }

  const existing = await findParticipantByToken(code, reconnectToken ?? null);
  if (existing) {
    await db.update(participants).set({ lastSeenAt: now() }).where(eq(participants.id, existing.id));
    return { participantId: existing.id, nickname: existing.nickname, token: reconnectToken as string };
  }

  if (room.status !== "lobby") {
    throw new Error("게임에 참여할 수 없습니다.");
  }

  const count = await db
    .select({ count: sql<number>`count(*)` })
    .from(participants)
    .where(eq(participants.roomCode, code));
  if ((count[0]?.count ?? 0) >= MAX_PARTICIPANTS) {
    throw new Error("참가 인원이 가득 찼습니다.");
  }

  const baseNickname = nicknameRaw.trim().slice(0, 20);
  if (!baseNickname) {
    throw new Error("닉네임을 입력해 주세요.");
  }

  const existingNames = await db
    .select({ nickname: participants.nickname })
    .from(participants)
    .where(eq(participants.roomCode, code));
  const names = new Set(existingNames.map((item) => item.nickname));
  let nickname = baseNickname;
  let suffix = 2;
  while (names.has(nickname)) {
    nickname = `${baseNickname} ${suffix}`;
    suffix += 1;
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const token = randomId("player_");
    const participantId = randomId("p_");
    const timestamp = now();
    const result = await requireD1()
      .prepare(
        `insert into participants (
          id, room_code, nickname, token_hash, status, score, correct_count, eliminated_round, joined_at, last_seen_at
        )
        select ?, r.code, ?, ?, 'active', 0, 0, null, ?, ?
        from rooms r
        where r.code = ?
          and r.status = 'lobby'
          and (select count(*) from participants where room_code = r.code) < ?`
      )
      .bind(participantId, nickname, await tokenHash(token), timestamp, timestamp, code, MAX_PARTICIPANTS)
      .run()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("UNIQUE")) {
          return null;
        }
        throw error;
      });

    if (result?.meta?.changes) {
      return { token, participantId, nickname };
    }

    if ((await getRoomOrThrow(code)).status !== "lobby") {
      throw new Error("게임에 참여할 수 없습니다.");
    }

    const nextSuffix = suffix + attempt;
    nickname = `${baseNickname} ${nextSuffix}`;
  }

  throw new Error("이미 사용 중인 닉네임입니다.");
}

async function currentRoomQuestion(room: DbRoom) {
  if (room.currentPosition === null) {
    return null;
  }

  return getDb().query.roomQuestions.findFirst({
    where: and(eq(roomQuestions.roomCode, room.code), eq(roomQuestions.position, room.currentPosition)),
  });
}

async function eligibleParticipantIds(roomCodeValue: string, category: QuestionCategory) {
  const rows = await getDb()
    .select()
    .from(participants)
    .where(eq(participants.roomCode, roomCodeValue));

  if (category === "revival") {
    return rows.filter((participant) => participant.status === "eliminated").map((participant) => participant.id);
  }

  return rows.filter((participant) => participant.status === "active").map((participant) => participant.id);
}

async function selectQuestion(
  room: DbRoom,
  category: QuestionCategory,
  questionId: string | undefined,
  mode: SelectionMode
) {
  const db = getDb();
  const candidates = await db
    .select()
    .from(roomQuestions)
    .where(and(eq(roomQuestions.roomCode, room.code), eq(roomQuestions.category, category), isNull(roomQuestions.usedAt)))
    .orderBy(asc(roomQuestions.position));

  if (!candidates.length) {
    throw new Error("사용 가능한 문제가 없습니다.");
  }

  if (questionId) {
    const selected = candidates.find((question) => question.id === questionId);
    if (!selected) {
      throw new Error("선택한 문제를 사용할 수 없습니다.");
    }
    return selected;
  }

  return mode === "sequential"
    ? candidates[0]
    : candidates[Math.floor(Math.random() * candidates.length)];
}

async function startQuestion(
  room: DbRoom,
  category: QuestionCategory,
  allowedStatus: DbRoom["status"][],
  options: { questionId?: string; selectionMode?: unknown } = {}
) {
  if (category === "regular") {
    const active = await eligibleParticipantIds(room.code, "regular");
    if (active.length === 0) {
      throw new Error("생존자가 없으면 일반 문제를 낼 수 없습니다.");
    }
  }

  const mode = normalizeSelectionMode(options.selectionMode, room.selectionMode);
  const question = await selectQuestion(room, category, options.questionId, mode);
  const eligibleIds = await eligibleParticipantIds(room.code, category);
  if (eligibleIds.length === 0) {
    throw new Error(category === "revival" ? "패자부활전에 참여할 탈락자가 없습니다." : "문제를 풀 참가자가 없습니다.");
  }

  const currentActiveIds = category === "revival"
    ? parseStringArray(room.lastSurvivorIdsJson)
    : await eligibleParticipantIds(room.code, "regular");
  const timestamp = now();
  const statusPlaceholders = allowedStatus.map(() => "?").join(", ");
  const results = await requireD1().batch([
    requireD1()
      .prepare(
        `update room_questions
        set used_at = ?
        where room_code = ?
          and id = ?
          and used_at is null
          and exists (
            select 1 from rooms
            where rooms.code = room_questions.room_code
              and rooms.status in (${statusPlaceholders})
          )`
      )
      .bind(timestamp, room.code, question.id, ...allowedStatus),
    requireD1()
      .prepare(
        `update rooms
        set status = 'question',
            current_position = ?,
            current_category = ?,
            current_eligible_json = ?,
            selection_mode = ?,
            last_survivor_ids_json = ?,
            accepting_answers = 1,
            round_number = round_number + 1,
            started_at = coalesce(started_at, ?),
            updated_at = ?
        where code = ?
          and status in (${statusPlaceholders})
          and exists (
            select 1 from room_questions
            where room_questions.room_code = rooms.code
              and room_questions.id = ?
              and room_questions.used_at = ?
          )`
      )
      .bind(
        question.position,
        category,
        JSON.stringify(eligibleIds),
        mode,
        JSON.stringify(currentActiveIds),
        timestamp,
        timestamp,
        room.code,
        ...allowedStatus,
        question.id,
        timestamp
      ),
  ]);

  if (!results[0]?.meta?.changes) {
    throw new Error("이미 사용된 문제입니다.");
  }
  if (!results[1]?.meta?.changes) {
    throw new Error("방 상태가 변경되었습니다.");
  }
}

async function getRoomOrThrow(code: string, ownerUsername?: string) {
  const room = await getDb().query.rooms.findFirst({
    where: and(
      eq(rooms.code, code),
      isNull(rooms.deletedAt),
      ownerUsername !== undefined ? eq(rooms.ownerUsername, ownerUsername) : undefined
    ),
  });
  if (!room) {
    throw new Error("방을 찾을 수 없습니다.");
  }
  return room;
}

export async function isRoomOwnedBy(ownerUsername: string, code: string) {
  const room = await getDb().query.rooms.findFirst({
    columns: { code: true },
    where: and(eq(rooms.code, code), eq(rooms.ownerUsername, ownerUsername), isNull(rooms.deletedAt)),
  });
  return Boolean(room);
}

export async function startRoom(ownerUsername: string, code: string, options: { category?: QuestionCategory; questionId?: string; selectionMode?: unknown } = {}) {
  const room = await getRoomOrThrow(code, ownerUsername);
  if (room.status !== "lobby") {
    throw new Error("이미 시작된 게임입니다.");
  }
  const category = requestedCategory(options.category, "regular");
  if (category !== "regular") {
    throw new Error("처음 시작은 일반 문제만 가능합니다.");
  }
  await startQuestion(room, "regular", ["lobby"], options);
}

export async function submitAnswer(code: string, token: string | null, value: unknown) {
  const answer = parseAnswerValue(value);
  const tokenDigest = token ? await tokenHash(token) : "";
  const participant = await findParticipantByToken(code, token);
  if (!participant) {
    throw new Error("참가자 인증 정보가 올바르지 않습니다.");
  }

  const room = await getRoomOrThrow(code);
  if (room.status !== "question" || !room.acceptingAnswers || room.currentPosition === null) {
    throw new Error("정답 제출이 마감되었습니다.");
  }
  const eligibleIds = parseStringArray(room.currentEligibleJson);
  if (!eligibleIds.includes(participant.id)) {
    throw new Error("현재 문제에 답할 수 없습니다.");
  }

  const questionRow = await currentRoomQuestion(room);
  if (!questionRow) {
    throw new Error("문제를 찾을 수 없습니다.");
  }

  const correct = answerMatches(parseQuestion(questionRow.questionJson), answer);
  const timestamp = now();
  const result = await requireD1()
    .prepare(
      `insert into answers (
        id, room_code, participant_id, round_number, position, answer_json, is_correct, submitted_at, updated_at
      )
      select ?, r.code, p.id, r.round_number, r.current_position, ?, ?, ?, ?
      from rooms r
      join participants p on p.room_code = r.code
      where r.code = ?
        and r.status = 'question'
        and r.accepting_answers = 1
        and p.token_hash = ?
        and p.id in (select value from json_each(?))
      on conflict(room_code, round_number, participant_id) do update set
        answer_json = excluded.answer_json,
        is_correct = excluded.is_correct,
        updated_at = excluded.updated_at
      where (select status from rooms where code = excluded.room_code) = 'question'
        and (select accepting_answers from rooms where code = excluded.room_code) = 1`
    )
    .bind(
      randomId("ans_"),
      JSON.stringify(answer),
      correct ? 1 : 0,
      timestamp,
      timestamp,
      code,
      tokenDigest,
      JSON.stringify(eligibleIds)
    )
    .run();

  if (!result.meta?.changes) {
    throw new Error("정답 제출이 마감되었습니다.");
  }
}

export async function closeQuestion(ownerUsername: string, code: string) {
  const room = await getRoomOrThrow(code, ownerUsername);
  if (room.status !== "question") {
    throw new Error("현재 제출 중인 문제가 없습니다.");
  }

  const updated = await getDb()
    .update(rooms)
    .set({ status: "closed", acceptingAnswers: false, updatedAt: now() })
    .where(and(eq(rooms.code, code), eq(rooms.ownerUsername, ownerUsername), eq(rooms.status, "question"), eq(rooms.acceptingAnswers, true)))
    .returning();

  if (!updated.length) {
    throw new Error("이미 마감된 문제입니다.");
  }
}

export async function gradeAnswer(ownerUsername: string, code: string, participantId: string, correct: boolean) {
  const room = await getRoomOrThrow(code, ownerUsername);
  if (room.status !== "closed") {
    throw new Error("채점은 마감 후 공개 전까지만 가능합니다.");
  }

  const participant = await getDb().query.participants.findFirst({
    where: and(eq(participants.roomCode, code), eq(participants.id, participantId)),
  });
  if (!participant) {
    throw new Error("참가자를 찾을 수 없습니다.");
  }

  const existing = await getDb().query.answers.findFirst({
    where: and(
      eq(answers.roomCode, code),
      eq(answers.roundNumber, room.roundNumber),
      eq(answers.participantId, participantId)
    ),
  });
  const timestamp = now();
  if (!existing) {
    throw new Error("제출된 답안만 채점할 수 있습니다.");
  }

  const result = await requireD1()
    .prepare(
      `update answers
      set is_correct = ?, updated_at = ?
      where id = ?
        and exists (
          select 1 from rooms
          where rooms.code = answers.room_code
            and rooms.owner_username = ?
            and rooms.status = 'closed'
            and rooms.round_number = answers.round_number
        )`
    )
    .bind(correct ? 1 : 0, timestamp, existing.id, ownerUsername)
    .run();
  if (!result.meta?.changes) {
    throw new Error("채점 가능한 시간이 지났습니다.");
  }
}

export async function revealQuestion(ownerUsername: string, code: string) {
  const room = await getRoomOrThrow(code, ownerUsername);
  if (room.status !== "closed") {
    throw new Error("문제를 마감한 뒤 공개할 수 있습니다.");
  }

  const timestamp = now();
  if ((room.scoredRound ?? 0) >= room.roundNumber) {
    throw new Error("이미 공개된 문제입니다.");
  }

  const eligibleJson = JSON.stringify(parseStringArray(room.currentEligibleJson));
  if (room.currentCategory === "revival") {
    const results = await requireD1().batch([
      requireD1()
        .prepare(
          `update participants
        set status = 'active',
            eliminated_round = null,
            last_seen_at = ?
        where room_code = ?
          and status = 'eliminated'
          and participants.id in (select value from json_each(?))
          and exists (
            select 1 from rooms r
            where r.code = participants.room_code
              and r.status = 'closed'
              and coalesce(r.scored_round, 0) < r.round_number
          )
          and exists (
            select 1 from answers a
            where a.room_code = participants.room_code
              and a.participant_id = participants.id
              and a.round_number = ?
              and a.is_correct = 1
          )`
        )
        .bind(timestamp, code, eligibleJson, room.roundNumber),
      requireD1()
        .prepare(
          `update rooms
          set status = 'revealed',
              accepting_answers = 0,
              scored_round = round_number,
              updated_at = ?
          where code = ?
            and status = 'closed'
            and coalesce(scored_round, 0) < round_number`
        )
        .bind(timestamp, code),
    ]);
    if (!results.at(-1)?.meta?.changes) {
      throw new Error("이미 공개된 문제입니다.");
    }
    return;
  }

  const results = await requireD1().batch([
    requireD1()
      .prepare(
        `update participants
        set score = score + 1,
            correct_count = correct_count + 1
        where room_code = ?
          and status = 'active'
          and participants.id in (select value from json_each(?))
          and exists (
            select 1 from rooms r
            where r.code = participants.room_code
              and r.status = 'closed'
              and coalesce(r.scored_round, 0) < r.round_number
          )
          and exists (
            select 1 from answers a
            where a.room_code = participants.room_code
              and a.participant_id = participants.id
              and a.round_number = ?
              and a.is_correct = 1
          )`
      )
      .bind(code, eligibleJson, room.roundNumber),
    requireD1()
      .prepare(
        `update participants
        set status = 'eliminated',
            eliminated_round = ?,
            last_seen_at = ?
        where room_code = ?
          and status = 'active'
          and participants.id in (select value from json_each(?))
          and exists (
            select 1 from rooms r
            where r.code = participants.room_code
              and r.status = 'closed'
              and coalesce(r.scored_round, 0) < r.round_number
          )
          and not exists (
            select 1 from answers a
            where a.room_code = participants.room_code
              and a.participant_id = participants.id
              and a.round_number = ?
              and a.is_correct = 1
          )`
      )
      .bind(room.roundNumber, timestamp, code, eligibleJson, room.roundNumber),
    requireD1()
      .prepare(
        `update rooms
        set status = 'revealed',
            accepting_answers = 0,
            scored_round = round_number,
            updated_at = ?
        where code = ?
          and status = 'closed'
          and coalesce(scored_round, 0) < round_number`
      )
      .bind(timestamp, code),
  ]);
  if (!results.at(-1)?.meta?.changes) {
    throw new Error("이미 공개된 문제입니다.");
  }
}

async function restoreAllWrongFinalists(room: DbRoom) {
  const active = await getDb()
    .select()
    .from(participants)
    .where(and(eq(participants.roomCode, room.code), eq(participants.status, "active")));
  if (active.length > 0) {
    return;
  }

  const lastSurvivorIds = parseStringArray(room.lastSurvivorIdsJson);
  if (lastSurvivorIds.length) {
    await getDb()
      .update(participants)
      .set({ status: "active", eliminatedRound: null })
      .where(and(eq(participants.roomCode, room.code), inArray(participants.id, lastSurvivorIds)));
    return;
  }

  await getDb()
    .update(participants)
    .set({ status: "active", eliminatedRound: null })
    .where(and(eq(participants.roomCode, room.code), eq(participants.eliminatedRound, room.roundNumber)));
}

export async function nextQuestion(
  ownerUsername: string,
  code: string,
  options: { category?: QuestionCategory; questionId?: string; selectionMode?: unknown } = {}
) {
  const room = await getRoomOrThrow(code, ownerUsername);
  if (room.status !== "revealed") {
    throw new Error("현재 문제의 정답을 먼저 공개해 주세요.");
  }

  const category = requestedCategory(options.category, "regular");
  const active = await getDb()
    .select()
    .from(participants)
    .where(and(eq(participants.roomCode, code), eq(participants.status, "active")));

  if (category === "regular" && active.length === 0) {
    throw new Error("생존자가 없으면 일반 문제를 낼 수 없습니다.");
  }

  if (category === "tiebreaker") {
    const finalistIds = active.length > 0 ? active.map((participant) => participant.id) : parseStringArray(room.lastSurvivorIdsJson);
    if (finalistIds.length < 2) {
      throw new Error("동점자 문제는 우승 후보가 2명 이상일 때 필요합니다.");
    }
    await selectQuestion(room, category, options.questionId, normalizeSelectionMode(options.selectionMode, room.selectionMode));
    if (active.length === 0) {
      await restoreAllWrongFinalists(room);
    }
  }

  await startQuestion(await getRoomOrThrow(code, ownerUsername), category, ["revealed"], options);
}

export async function startRevival(ownerUsername: string, code: string, options: { questionId?: string; selectionMode?: unknown } = {}) {
  const room = await getRoomOrThrow(code, ownerUsername);
  if (room.status !== "revealed") {
    throw new Error("정답 공개 후 패자부활전을 열 수 있습니다.");
  }

  await startQuestion(room, "revival", ["revealed"], options);
}

export async function createTiebreaker(ownerUsername: string, code: string, input: unknown) {
  const db = getDb();
  const room = await getRoomOrThrow(code, ownerUsername);
  if (room.status !== "revealed") {
    throw new Error("정답 공개 후 동점자 문제를 추가할 수 있습니다.");
  }

  const active = await db
    .select()
    .from(participants)
    .where(and(eq(participants.roomCode, code), eq(participants.status, "active")));
  const finalistIds = active.length > 0 ? active.map((participant) => participant.id) : parseStringArray(room.lastSurvivorIdsJson);
  if (finalistIds.length < 2) {
    throw new Error("동점자 문제는 남은 참가자가 2명 이상일 때 필요합니다.");
  }

  const question = snapshotQuestion(validateQuestion(input, 0, true));
  if (active.length === 0) {
    await restoreAllWrongFinalists(room);
  }
  const maxPosition = await db
    .select({ value: sql<number>`coalesce(max(${roomQuestions.position}), -1)` })
    .from(roomQuestions)
    .where(eq(roomQuestions.roomCode, code));
  const position = (maxPosition[0]?.value ?? -1) + 1;
  await db.insert(roomQuestions).values({
    id: randomId("rq_"),
    roomCode: code,
    position,
    questionJson: JSON.stringify({ ...question, category: "tiebreaker", isTiebreaker: true }),
    category: "tiebreaker",
    usedAt: null,
    isTiebreaker: true,
    createdAt: now(),
  });
  const inserted = await db.query.roomQuestions.findFirst({
    where: and(eq(roomQuestions.roomCode, code), eq(roomQuestions.position, position)),
  });
  await startQuestion(room, "tiebreaker", ["revealed"], { questionId: inserted?.id });
}

export async function finishRoom(ownerUsername: string, code: string) {
  const room = await getRoomOrThrow(code, ownerUsername);
  if (room.status !== "revealed" && room.status !== "question" && room.status !== "closed") {
    throw new Error("정답 공개 후 게임을 마무리할 수 있습니다.");
  }
  if (room.status !== "revealed") {
    throw new Error("현재 문제를 공개한 뒤 마무리할 수 있습니다.");
  }

  const timestamp = now();
  const active = await getDb()
    .select()
    .from(participants)
    .where(and(eq(participants.roomCode, code), eq(participants.status, "active")));

  if (active.length === 1) {
    await getDb()
      .update(participants)
      .set({ status: "winner" })
      .where(eq(participants.id, active[0].id));
  } else if (active.length > 1) {
    throw new Error("우승자를 가리려면 동점자 문제가 필요합니다.");
  } else {
    const lastSurvivorIds = parseStringArray(room.lastSurvivorIdsJson);
    if (lastSurvivorIds.length === 1) {
      await getDb()
        .update(participants)
        .set({ status: "winner", eliminatedRound: null })
        .where(and(eq(participants.roomCode, code), eq(participants.id, lastSurvivorIds[0])));
    } else if (lastSurvivorIds.length > 1) {
      throw new Error("우승자를 가리려면 동점자 문제가 필요합니다.");
    } else {
      throw new Error("우승자를 정할 수 없습니다.");
    }
  }

  await getDb()
    .update(rooms)
    .set({ status: "finished", acceptingAnswers: false, endedAt: timestamp, updatedAt: timestamp })
    .where(and(eq(rooms.code, code), eq(rooms.ownerUsername, ownerUsername)));
}

export async function getRoomState(code: string, role: Role, playerToken?: string | null, ownerUsername?: string) {
  if (role === "host" && !ownerUsername) {
    throw new Error("방을 찾을 수 없습니다.");
  }
  const db = getDb();
  const room = await getRoomOrThrow(code, role === "host" ? ownerUsername : undefined);
  const [participantRows, answerRows, questionRow, quizRow, me] = await Promise.all([
    db.select().from(participants).where(eq(participants.roomCode, code)).orderBy(asc(participants.joinedAt)),
    db
      .select()
      .from(answers)
      .where(and(eq(answers.roomCode, code), eq(answers.roundNumber, room.roundNumber))),
    currentRoomQuestion(room),
    room.quizId ? db.query.quizzes.findFirst({ where: eq(quizzes.id, room.quizId) }) : Promise.resolve(null),
    role === "player" ? findParticipantByToken(code, playerToken ?? null) : Promise.resolve(null),
  ]);

  if (role === "player" && !me) {
    throw new Error("참가자 인증 정보가 올바르지 않습니다.");
  }

  const question = questionRow ? parseQuestion(questionRow.questionJson) : null;
  const reveal = room.status === "revealed" || room.status === "finished";
  const host = role === "host";
  const ranking = rankings(participantRows);
  const participantMap = new Map(participantRows.map((participant) => [participant.id, participant]));
  const activeCount = participantRows.filter((participant) => participant.status === "active").length;
  const eligibleIds = parseStringArray(room.currentEligibleJson);
  const eligibleSet = new Set(eligibleIds);
  const lastSurvivorIds = parseStringArray(room.lastSurvivorIdsJson);
  const zeroSurvivorAfterReveal = room.status === "revealed" && activeCount === 0;
  const winner = ranking.find((participant) => participant.status === "winner") ?? null;
  const playerEligible = me ? eligibleSet.has(me.id) : false;
  const playerCanSubmit = Boolean(me && playerEligible && room.status === "question" && room.acceptingAnswers);
  const allRoomQuestions = host
    ? await db.select().from(roomQuestions).where(eq(roomQuestions.roomCode, code)).orderBy(asc(roomQuestions.position))
    : [];
  const availableQuestions = host
    ? allRoomQuestions.filter((row) => row.usedAt === null).reduce<Partial<Record<QuestionCategory, Array<Question & { used: boolean; usedAt?: string; position: number }>>>>(
        (groups, row) => {
          const parsed = parseQuestion(row.questionJson);
          const category = questionCategory(parsed, row);
          const current = groups[category] ?? [];
          current.push({
            ...parsed,
            id: row.id,
            category,
            isTiebreaker: category === "tiebreaker",
            used: Boolean(row.usedAt),
            usedAt: iso(row.usedAt),
            position: row.position,
          });
          groups[category] = current;
          return groups;
        },
        {}
      )
    : undefined;

  const visibleAnswers =
    host
      ? answerRows.map((answer) => ({
          participantId: answer.participantId,
          nickname: participantMap.get(answer.participantId)?.nickname,
          answer: parseAnswer(answer.answerJson),
          correct: answer.isCorrect,
          submittedAt: iso(answer.submittedAt),
        }))
      : role === "player" && me
        ? answerRows
            .filter((answer) => answer.participantId === me.id)
            .map((answer) => ({
              participantId: answer.participantId,
              nickname: me.nickname,
              answer: parseAnswer(answer.answerJson),
              correct: reveal ? answer.isCorrect : null,
              submittedAt: iso(answer.submittedAt),
            }))
        : [];

  const myAnswer =
    me && answerRows.find((answer) => answer.participantId === me.id)
      ? {
          participantId: me.id,
          nickname: me.nickname,
          answer: parseAnswer(answerRows.find((answer) => answer.participantId === me.id)!.answerJson),
          correct: reveal ? answerRows.find((answer) => answer.participantId === me.id)!.isCorrect : null,
          submittedAt: iso(answerRows.find((answer) => answer.participantId === me.id)!.submittedAt),
        }
      : null;

  const quiz = {
    id: quizRow?.id ?? room.quizId ?? undefined,
    title: quizRow?.title ?? room.title,
    description: quizRow?.description ?? "",
    questions: host && quizRow ? (JSON.parse(quizRow.questionsJson) as Question[]) : [],
    createdAt: quizRow ? iso(quizRow.createdAt) : undefined,
    updatedAt: quizRow ? iso(quizRow.updatedAt) : undefined,
  };

  return {
    code: room.code,
    phase: room.status,
    room: {
      id: room.code,
      code: room.code,
      phase: room.status,
      joinLocked: room.status !== "lobby",
      currentQuestionIndex: room.roundNumber > 0 ? room.roundNumber - 1 : undefined,
      currentPosition: room.currentPosition ?? undefined,
      currentPool: room.currentCategory,
      selectionMode: room.selectionMode,
      playMode: room.selectionMode,
      acceptingAnswers: room.acceptingAnswers,
      roundNumber: room.roundNumber,
      maxParticipants: MAX_PARTICIPANTS,
      participantCount: participantRows.length,
      activeCount,
      submittedCount: answerRows.filter((answer) => eligibleSet.has(answer.participantId)).length,
      needsTiebreaker: zeroSurvivorAfterReveal && lastSurvivorIds.length > 1,
    },
    quiz,
    participants: participantRows.map((participant) =>
      participantPublic(participant, undefined, {
        eligibleForRound: eligibleSet.has(participant.id),
        canSubmit: eligibleSet.has(participant.id) && room.status === "question" && room.acceptingAnswers,
      })
    ),
    availableQuestions,
    currentQuestion: question
      ? (host
          ? { ...question, id: questionRow?.id, category: questionCategory(question, questionRow ?? undefined) }
          : publicQuestion({ ...question, id: questionRow?.id, category: questionCategory(question, questionRow ?? undefined) }, reveal))
      : null,
    currentQuestionIndex: room.roundNumber > 0 ? room.roundNumber - 1 : undefined,
    answers: visibleAnswers,
    ranking,
    me: me
      ? participantPublic(me, undefined, {
          eligibleForRound: playerEligible,
          canSubmit: playerCanSubmit,
        })
      : undefined,
    myAnswer,
    winner,
    message:
      zeroSurvivorAfterReveal
        ? "생존자가 없습니다. 패자부활전을 열거나 게임을 마무리하세요."
        : undefined,
  };
}
