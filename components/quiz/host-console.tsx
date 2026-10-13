"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  Copy,
  Eye,
  ImagePlus,
  LogOut,
  MonitorPlay,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BRAND_NAME } from "@/lib/client/brand";
import {
  ApiError,
  createBlankQuestion,
  normalizeQuizList,
  phaseLabel,
  questionNumberLabel,
  Participant,
  quizApi,
  QuizQuestion,
  QuizSet,
  RoomState,
  unwrapQuiz,
} from "@/lib/client/quiz-api";

const sampleQuiz: QuizSet = {
  title: "새 골든벨 문제 세트",
  description: "오프라인 행사에서 바로 사용할 수 있는 기본 세트",
  questions: [
    {
      kind: "ox",
      prompt: "골든벨 퀴즈는 진행자가 마감하기 전까지 답을 바꿀 수 있다.",
      options: ["O", "X"],
      correctAnswers: ["O"],
      explanation: "진행자가 마감 버튼을 누르기 전까지 마지막 제출 답안이 반영됩니다.",
      images: [],
    },
    {
      kind: "multiple",
      prompt: "행사장에서 참석자가 퀴즈에 참여하는 기본 장치는?",
      options: ["휴대폰", "종이 답안지", "무전기", "리모컨"],
      correctAnswers: ["휴대폰"],
      explanation: "QR 또는 링크로 접속해 휴대폰에서 답을 제출합니다.",
      images: [],
    },
  ],
};

function messageFrom(error: unknown) {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message;
  }

  return "요청을 처리하지 못했습니다.";
}

function normalizeCode(code: string) {
  return code.trim().toUpperCase();
}

function optionLabel(question: QuizQuestion, value: string) {
  const index = question.options?.indexOf(value) ?? -1;

  if (index < 0) {
    return value;
  }

  return `${index + 1}. ${value}`;
}

function aliveCount(participants: Participant[] = []) {
  return participants.filter((participant) => !participant.eliminated).length;
}

function cleanRuntimeQuestion(question: QuizQuestion): QuizQuestion {
  return {
    ...question,
    prompt: question.prompt.trim(),
    options:
      question.kind === "short"
        ? undefined
        : question.options?.map((option) => option.trim()).filter(Boolean),
    correctAnswers: question.correctAnswers.map((answer) => answer.trim()).filter(Boolean),
    explanation: question.explanation?.trim() || undefined,
    images: (question.images ?? []).slice(0, 4),
    isTiebreaker: true,
  };
}

function validateRuntimeQuestion(question: QuizQuestion): string {
  const cleaned = cleanRuntimeQuestion(question);

  if (!cleaned.prompt) {
    return "문제를 입력하세요.";
  }

  if (cleaned.correctAnswers.length === 0) {
    return "정답을 1개 이상 입력하세요.";
  }

  if (cleaned.kind !== "short") {
    const options = cleaned.options ?? [];

    if (options.length < 2) {
      return "보기는 2개 이상 필요합니다.";
    }

    if (!cleaned.correctAnswers.every((answer) => options.includes(answer))) {
      return "정답은 보기 중 하나로 선택하세요.";
    }
  }

  return "";
}

async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= 1_000_000) {
    return file;
  }

  const bitmap = await createImageBitmap(file);
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  if (!context) {
    return file;
  }

  context.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.82);
  });

  if (!blob || blob.size >= file.size) {
    return file;
  }

  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

export function HostConsole() {
  const [username, setUsername] = useState("ming");
  const [password, setPassword] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [checking, setChecking] = useState(true);
  const [quizzes, setQuizzes] = useState<QuizSet[]>([]);
  const [rooms, setRooms] = useState<Array<{ code: string; phase?: string; createdAt?: string }>>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [draft, setDraft] = useState<QuizSet>(sampleQuiz);
  const [activeCode, setActiveCode] = useState("");
  const [state, setState] = useState<RoomState | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [origin, setOrigin] = useState("");

  const selectedQuiz = useMemo(
    () => quizzes.find((quiz) => quiz.id === selectedId) ?? draft,
    [draft, quizzes, selectedId],
  );

  useEffect(() => {
    const id = window.setTimeout(() => setOrigin(window.location.origin), 0);
    return () => window.clearTimeout(id);
  }, []);

  const joinUrl = useMemo(() => {
    if (!activeCode || !origin) {
      return "";
    }

    return `${origin}/join?code=${activeCode}`;
  }, [activeCode, origin]);

  const qrUrl = joinUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(joinUrl)}`
    : "";

  useEffect(() => {
    quizApi
      .getHost()
      .then(() => {
        setLoggedIn(true);
        return Promise.all([loadQuizzes(), loadRooms()]);
      })
      .catch(() => undefined)
      .finally(() => setChecking(false));
  }, []);

  async function run<T>(action: () => Promise<T>, success?: string) {
    setBusy(true);
    setNotice("");

    try {
      const result = await action();

      if (success) {
        setNotice(success);
      }

      return result;
    } catch (error) {
      setNotice(messageFrom(error));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function loadQuizzes() {
    const result = await quizApi.listQuizzes();
    const list = normalizeQuizList(result);
    setQuizzes(list);

    if (list[0]) {
      setSelectedId(list[0].id ?? "");
      setDraft(list[0]);
    }
  }

  async function loadRooms() {
    const result = await quizApi.listRooms();
    setRooms(result.rooms ?? []);
  }

  const refreshState = useCallback(async (code = activeCode, quiet = false) => {
    const normalized = normalizeCode(code);

    if (!normalized) {
      return null;
    }

    try {
      const nextState = await quizApi.roomState(normalized);
      setState(nextState);
      setActiveCode(nextState.code ?? normalized);
      return nextState;
    } catch (error) {
      if (!quiet) {
        setNotice(messageFrom(error));
      }

      return null;
    }
  }, [activeCode]);

  useEffect(() => {
    if (!loggedIn || !activeCode) {
      return;
    }

    const firstLoad = window.setTimeout(() => {
      void refreshState(activeCode);
    }, 0);
    const id = window.setInterval(() => {
      void refreshState(activeCode, true);
    }, 2000);

    return () => {
      window.clearTimeout(firstLoad);
      window.clearInterval(id);
    };
  }, [activeCode, loggedIn, refreshState]);

  async function onLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await run(() => quizApi.hostLogin(username, password), "진행자 로그인이 완료되었습니다.");

    if (result) {
      setPassword("");
      setLoggedIn(true);
      await Promise.all([loadQuizzes(), loadRooms()]);
    }
  }

  async function saveDraft() {
    const cleaned = cleanQuiz(draft);
    const result = await run(
      () => (cleaned.id ? quizApi.updateQuiz(cleaned.id, cleaned) : quizApi.saveQuiz(cleaned)),
      "문제 세트를 저장했습니다.",
    );

    if (result) {
      const saved = unwrapQuiz(result);
      setDraft(saved);
      setSelectedId(saved.id ?? "");
      await loadQuizzes();
    }
  }

  async function createRoom() {
    const id = selectedQuiz.id ?? draft.id;

    if (!id) {
      setNotice("방을 만들기 전에 문제 세트를 먼저 저장하세요.");
      return;
    }

    const result = await run(() => quizApi.createRoom(id), "새 진행 방을 만들었습니다.");
    const code = result?.room?.code ?? result?.code;

    if (code) {
      setActiveCode(normalizeCode(code));
      await refreshState(code);
      await loadRooms();
    }
  }

  async function roomAction(action: () => Promise<RoomState>, success: string) {
    const result = await run(action, success);

    if (result) {
      setState(result);
    } else {
      await refreshState();
    }
  }

  function selectQuiz(id: string) {
    const quiz = quizzes.find((item) => item.id === id);
    setSelectedId(id);

    if (quiz) {
      setDraft(structuredClone(quiz));
    }
  }

  async function deleteSelectedQuiz() {
    if (!draft.id) {
      setSelectedId("");
      setDraft(structuredClone(sampleQuiz));
      return;
    }

    const result = await run(() => quizApi.deleteQuiz(draft.id!), "문제 세트를 삭제했습니다.");

    if (result) {
      setSelectedId("");
      setDraft(structuredClone(sampleQuiz));
      await loadQuizzes();
    }
  }

  async function deleteActiveRoom(code: string) {
    const normalized = normalizeCode(code);

    if (!normalized) {
      return;
    }

    const result = await run(() => quizApi.deleteRoom(normalized), "진행 기록을 삭제했습니다.");

    if (result) {
      setRooms((current) => current.filter((room) => normalizeCode(room.code) !== normalized));

      if (normalizeCode(activeCode) === normalized) {
        setActiveCode("");
        setState(null);
      }
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!currentPassword || !nextPassword) {
      setNotice("현재 비밀번호와 새 비밀번호를 입력하세요.");
      return;
    }

    const result = await run(
      () => quizApi.changePassword(currentPassword, nextPassword),
      "진행자 비밀번호를 변경했습니다.",
    );

    if (result) {
      setCurrentPassword("");
      setNextPassword("");
    }
  }

  function updateQuestion(index: number, patch: Partial<QuizQuestion>) {
    setDraft((current) => ({
      ...current,
      questions: current.questions.map((question, questionIndex) =>
        questionIndex === index ? { ...question, ...patch } : question,
      ),
    }));
  }

  function changeKind(index: number, kind: QuizQuestion["kind"]) {
    const existing = draft.questions[index];
    updateQuestion(index, {
      ...createBlankQuestion(kind),
      id: existing.id,
      prompt: existing.prompt,
      explanation: existing.explanation,
      images: existing.images ?? [],
      isTiebreaker: existing.isTiebreaker,
    });
  }

  async function uploadImages(questionIndex: number, event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).slice(0, 4);

    if (files.length === 0) {
      return;
    }

    const currentImages = draft.questions[questionIndex]?.images ?? [];

    if (currentImages.length >= 4) {
      setNotice("이미지는 문제당 최대 4장까지 첨부할 수 있습니다.");
      return;
    }

    const uploaded = await run(async () => {
      const results = [];

      for (const file of files.slice(0, 4 - currentImages.length)) {
        results.push(await quizApi.uploadImage(await compressImage(file)));
      }

      return results;
    }, "이미지를 첨부했습니다.");

    if (uploaded) {
      updateQuestion(questionIndex, {
        images: [...currentImages, ...uploaded.map((image) => image.url)].slice(0, 4),
      });
    }

    event.target.value = "";
  }

  if (checking) {
    return <ShellCenter title="진행자 상태 확인 중" body="잠시만 기다려 주세요." />;
  }

  if (!loggedIn) {
    return (
      <main className="min-h-screen bg-[#f7f2e8] px-5 py-6 text-zinc-950">
        <section className="mx-auto flex min-h-[calc(100vh-48px)] w-full max-w-md flex-col justify-center">
          <Link href="/" className="mb-8 text-sm font-black text-zinc-600">
            {BRAND_NAME}
          </Link>
          <form onSubmit={onLogin} className="rounded-md border-2 border-zinc-950 bg-white p-6 shadow-[8px_8px_0_#18181b]">
            <h1 className="text-3xl font-black">진행자 로그인</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              문제 세트와 진행 방은 진행자만 관리할 수 있습니다.
            </p>
            <label className="mt-6 block text-sm font-bold" htmlFor="username">
              ID
            </label>
            <input
              id="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-2 h-12 w-full rounded-md border border-zinc-300 px-3 font-bold outline-none focus:border-zinc-950 focus:ring-4 focus:ring-[#ffcf4a]/50"
            />
            <label className="mt-4 block text-sm font-bold" htmlFor="password">
              비밀번호
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 h-12 w-full rounded-md border border-zinc-300 px-3 font-bold outline-none focus:border-zinc-950 focus:ring-4 focus:ring-[#ffcf4a]/50"
            />
            {notice ? <p className="mt-4 text-sm font-bold text-[#b42318]">{notice}</p> : null}
            <Button className="mt-6 h-12 w-full bg-zinc-950 font-black text-white hover:bg-black" disabled={busy}>
              로그인
            </Button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f2e8] text-zinc-950">
      <header className="sticky top-0 z-20 border-b-2 border-zinc-950 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-3 font-black">
            <span className="grid h-10 w-10 place-items-center rounded-md bg-zinc-950 text-white">벨</span>
            {BRAND_NAME} 진행자
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={activeCode}
              onChange={(event) => setActiveCode(normalizeCode(event.target.value))}
              placeholder="방 코드"
              className="h-10 w-28 rounded-md border border-zinc-300 px-3 text-center font-black uppercase"
            />
            <Button variant="outline" onClick={() => void refreshState()} disabled={busy || !activeCode}>
              <RefreshCw aria-hidden />
              새로고침
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void quizApi.hostLogout().finally(() => setLoggedIn(false));
              }}
            >
              <LogOut aria-hidden />
              로그아웃
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-5 lg:grid-cols-[380px_minmax(0,1fr)] lg:px-6">
        <aside className="space-y-5">
          <section className="rounded-md border-2 border-zinc-950 bg-white p-4 shadow-[6px_6px_0_#18181b]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-black">문제 세트</h1>
                <p className="mt-1 text-sm text-zinc-600">저장한 세트를 선택해 방을 만듭니다.</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSelectedId("");
                  setDraft(structuredClone(sampleQuiz));
                }}
              >
                <Plus aria-hidden />
                새 세트
              </Button>
            </div>

            <select
              value={selectedId}
              onChange={(event) => selectQuiz(event.target.value)}
              className="mt-4 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 font-bold"
            >
              <option value="">새 문제 세트</option>
              {quizzes.map((quiz) => (
                <option key={quiz.id ?? quiz.title} value={quiz.id ?? ""}>
                  {quiz.title}
                </option>
              ))}
            </select>

            <label className="mt-4 block text-sm font-bold" htmlFor="quiz-title">
              제목
            </label>
            <input
              id="quiz-title"
              value={draft.title}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              className="mt-2 h-11 w-full rounded-md border border-zinc-300 px-3 font-bold"
            />
            <label className="mt-4 block text-sm font-bold" htmlFor="quiz-desc">
              설명
            </label>
            <textarea
              id="quiz-desc"
              value={draft.description ?? ""}
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
              rows={3}
              className="mt-2 w-full rounded-md border border-zinc-300 px-3 py-2"
            />
            <div className="mt-4 flex gap-2">
              <Button onClick={() => void saveDraft()} disabled={busy} className="flex-1 bg-zinc-950 font-black text-white">
                <Save aria-hidden />
                저장
              </Button>
              <Button onClick={() => void createRoom()} disabled={busy} className="flex-1 bg-[#ffcf4a] font-black text-zinc-950 hover:bg-[#f2bd2f]">
                <MonitorPlay aria-hidden />
                방 만들기
              </Button>
            </div>
            <Button
              variant="outline"
              className="mt-2 w-full"
              onClick={() => void deleteSelectedQuiz()}
              disabled={busy}
            >
              <Trash2 aria-hidden />
              문제 세트 삭제
            </Button>
            {notice ? <p className="mt-4 rounded-md bg-[#fff4d0] p-3 text-sm font-bold">{notice}</p> : null}
          </section>

          <RoomCard
            activeCode={activeCode}
            joinUrl={joinUrl}
            qrUrl={qrUrl}
            state={state}
            onCopy={(text) => void navigator.clipboard?.writeText(text)}
          />
          <RoomHistory
            rooms={rooms}
            activeCode={activeCode}
            busy={busy}
            onOpen={(code) => {
              setActiveCode(normalizeCode(code));
              void refreshState(code);
            }}
            onDelete={(code) => void deleteActiveRoom(code)}
          />
          <PasswordCard
            currentPassword={currentPassword}
            nextPassword={nextPassword}
            busy={busy}
            onCurrentPassword={setCurrentPassword}
            onNextPassword={setNextPassword}
            onSubmit={changePassword}
          />
        </aside>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)]">
          <QuizEditor
            draft={draft}
            busy={busy}
            onDraft={setDraft}
            onQuestion={updateQuestion}
            onKind={changeKind}
            onUpload={uploadImages}
          />
          <LiveControl
            code={activeCode}
            state={state}
            busy={busy}
            onAction={roomAction}
            onRefresh={() => refreshState()}
          />
        </section>
      </div>
    </main>
  );
}

function ShellCenter({ title, body }: { title: string; body: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f2e8] px-5 text-zinc-950">
      <div className="rounded-md border-2 border-zinc-950 bg-white p-6 text-center shadow-[8px_8px_0_#18181b]">
        <h1 className="text-2xl font-black">{title}</h1>
        <p className="mt-2 text-zinc-600">{body}</p>
      </div>
    </main>
  );
}

function RoomCard({
  activeCode,
  joinUrl,
  qrUrl,
  state,
  onCopy,
}: {
  activeCode: string;
  joinUrl: string;
  qrUrl: string;
  state: RoomState | null;
  onCopy: (text: string) => void;
}) {
  const participants = state?.participants ?? [];

  return (
    <section className="rounded-md border-2 border-zinc-950 bg-white p-4">
      <h2 className="text-xl font-black">참가 안내</h2>
      <div className="mt-4 grid place-items-center rounded-md border border-zinc-200 bg-[#f7f2e8] p-4">
        {qrUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrUrl} alt="참가 링크 QR 코드" className="h-44 w-44 rounded-md bg-white" />
        ) : (
          <div className="grid h-44 w-44 place-items-center rounded-md bg-white text-center text-sm font-bold text-zinc-500">
            방을 만들면 QR이 표시됩니다.
          </div>
        )}
      </div>
      <div className="mt-4 rounded-md bg-zinc-950 p-4 text-center text-white">
        <p className="text-xs font-bold text-zinc-300">참가 코드</p>
        <p className="text-5xl font-black tracking-normal">{activeCode || "----"}</p>
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          disabled={!joinUrl}
          onClick={() => onCopy(joinUrl)}
        >
          <Copy aria-hidden />
          링크 복사
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          disabled={!activeCode}
          onClick={() => onCopy(activeCode)}
        >
          <Copy aria-hidden />
          코드 복사
        </Button>
      </div>
      <Button asChild variant="outline" className="mt-2 w-full" disabled={!activeCode}>
        <Link href={activeCode ? `/display/${activeCode}` : "/host"} target="_blank">
          <MonitorPlay aria-hidden />
          발표 화면 열기
        </Link>
      </Button>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Metric label="참가" value={participants.length} />
        <Metric label="생존" value={aliveCount(participants)} />
        <Metric label="단계" value={phaseLabel(state?.phase)} />
      </div>
    </section>
  );
}

function RoomHistory({
  rooms,
  activeCode,
  busy,
  onOpen,
  onDelete,
}: {
  rooms: Array<{ code: string; phase?: string; createdAt?: string }>;
  activeCode: string;
  busy: boolean;
  onOpen: (code: string) => void;
  onDelete: (code: string) => void;
}) {
  return (
    <section className="rounded-md border-2 border-zinc-950 bg-white p-4">
      <h2 className="text-xl font-black">진행 기록</h2>
      <p className="mt-1 text-sm text-zinc-600">완료된 방의 결과를 다시 열어볼 수 있습니다.</p>
      <div className="mt-4 space-y-2">
        {rooms.map((room) => (
          <div key={room.code} className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 p-3">
            <button
              type="button"
              onClick={() => onOpen(room.code)}
              className="min-w-0 flex-1 text-left"
            >
              <p className="truncate font-black">
                {room.code}
                {normalizeCode(room.code) === normalizeCode(activeCode) ? (
                  <span className="ml-2 text-xs text-[#d08b00]">열림</span>
                ) : null}
              </p>
              <p className="text-xs text-zinc-500">
                {phaseLabel(room.phase)} {room.createdAt ? `· ${new Date(room.createdAt).toLocaleString("ko-KR")}` : ""}
              </p>
            </button>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label="진행 기록 삭제"
              disabled={busy}
              onClick={() => onDelete(room.code)}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        {rooms.length === 0 ? <p className="text-sm text-zinc-500">저장된 진행 기록이 없습니다.</p> : null}
      </div>
    </section>
  );
}

function PasswordCard({
  currentPassword,
  nextPassword,
  busy,
  onCurrentPassword,
  onNextPassword,
  onSubmit,
}: {
  currentPassword: string;
  nextPassword: string;
  busy: boolean;
  onCurrentPassword: (value: string) => void;
  onNextPassword: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="rounded-md border-2 border-zinc-950 bg-white p-4">
      <h2 className="text-xl font-black">비밀번호 변경</h2>
      <label className="mt-4 block text-sm font-bold" htmlFor="current-password">
        현재 비밀번호
      </label>
      <input
        id="current-password"
        type="password"
        value={currentPassword}
        onChange={(event) => onCurrentPassword(event.target.value)}
        className="mt-2 h-10 w-full rounded-md border border-zinc-300 px-3"
      />
      <label className="mt-3 block text-sm font-bold" htmlFor="next-password">
        새 비밀번호
      </label>
      <input
        id="next-password"
        type="password"
        value={nextPassword}
        onChange={(event) => onNextPassword(event.target.value)}
        className="mt-2 h-10 w-full rounded-md border border-zinc-300 px-3"
      />
      <Button className="mt-4 w-full bg-zinc-950 font-black text-white" disabled={busy}>
        변경하기
      </Button>
    </form>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-[#f7f2e8] p-3">
      <p className="text-xs font-bold text-zinc-500">{label}</p>
      <p className="mt-1 truncate text-lg font-black">{value}</p>
    </div>
  );
}

function QuizEditor({
  draft,
  busy,
  onDraft,
  onQuestion,
  onKind,
  onUpload,
}: {
  draft: QuizSet;
  busy: boolean;
  onDraft: (quiz: QuizSet) => void;
  onQuestion: (index: number, patch: Partial<QuizQuestion>) => void;
  onKind: (index: number, kind: QuizQuestion["kind"]) => void;
  onUpload: (index: number, event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <section className="rounded-md border-2 border-zinc-950 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black">문제 편집</h2>
          <p className="mt-1 text-sm text-zinc-600">O/X, 객관식, 주관식과 이미지 4장을 지원합니다.</p>
        </div>
        <Button
          variant="outline"
          onClick={() =>
            onDraft({
              ...draft,
              questions: [...draft.questions, createBlankQuestion("multiple")],
            })
          }
        >
          <Plus aria-hidden />
          문제 추가
        </Button>
      </div>

      <div className="mt-4 space-y-4">
        {draft.questions.map((question, index) => (
          <article key={question.id ?? index} className="rounded-md border border-zinc-200 bg-[#fbfaf7] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-black">문제 {index + 1}</h3>
              <div className="flex flex-wrap gap-2">
                {(["ox", "multiple", "short"] as const).map((kind) => (
                  <Button
                    key={kind}
                    size="sm"
                    variant={question.kind === kind ? "default" : "outline"}
                    onClick={() => onKind(index, kind)}
                    className={question.kind === kind ? "bg-zinc-950 text-white" : ""}
                  >
                    {kind === "ox" ? "O/X" : kind === "multiple" ? "객관식" : "주관식"}
                  </Button>
                ))}
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="문제 삭제"
                  onClick={() =>
                    onDraft({
                      ...draft,
                      questions: draft.questions.filter((_, questionIndex) => questionIndex !== index),
                    })
                  }
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </div>

            <textarea
              value={question.prompt}
              onChange={(event) => onQuestion(index, { prompt: event.target.value })}
              placeholder="문제를 입력하세요"
              rows={3}
              className="mt-3 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-lg font-bold"
            />

            {question.kind !== "short" ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {(question.options ?? []).map((option, optionIndex) => (
                  <label key={optionIndex} className="flex items-center gap-2 rounded-md bg-white p-2">
                    <input
                      type="radio"
                      name={`correct-${index}`}
                      checked={question.correctAnswers.includes(option)}
                      onChange={() => onQuestion(index, { correctAnswers: [option] })}
                    />
                    <input
                      value={option}
                      disabled={question.kind === "ox"}
                      onChange={(event) => {
                        const nextOptions = [...(question.options ?? [])];
                        const previous = nextOptions[optionIndex];
                        nextOptions[optionIndex] = event.target.value;
                        onQuestion(index, {
                          options: nextOptions,
                          correctAnswers: question.correctAnswers.includes(previous)
                            ? [event.target.value]
                            : question.correctAnswers,
                        });
                      }}
                      placeholder={`보기 ${optionIndex + 1}`}
                      className="h-10 min-w-0 flex-1 rounded-md border border-zinc-200 px-3"
                    />
                  </label>
                ))}
              </div>
            ) : (
              <input
                value={question.correctAnswers.join(", ")}
                onChange={(event) =>
                  onQuestion(index, {
                    correctAnswers: event.target.value
                      .split(",")
                      .map((answer) => answer.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="정답을 쉼표로 구분해 입력"
                className="mt-3 h-11 w-full rounded-md border border-zinc-300 bg-white px-3"
              />
            )}

            <textarea
              value={question.explanation ?? ""}
              onChange={(event) => onQuestion(index, { explanation: event.target.value })}
              placeholder="해설 또는 진행자 메모"
              rows={2}
              className="mt-3 w-full rounded-md border border-zinc-300 bg-white px-3 py-2"
            />

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-bold">
                <ImagePlus aria-hidden className="size-4" />
                이미지 첨부
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="sr-only"
                  disabled={busy}
                  onChange={(event) => onUpload(index, event)}
                />
              </label>
              <label className="inline-flex items-center gap-2 text-sm font-bold">
                <input
                  type="checkbox"
                  checked={Boolean(question.isTiebreaker)}
                  onChange={(event) => onQuestion(index, { isTiebreaker: event.target.checked })}
                />
                타이브레이커
              </label>
              <span className="text-sm text-zinc-500">{question.images?.length ?? 0} / 4장</span>
            </div>

            {question.images?.length ? (
              <div className="mt-3 grid grid-cols-4 gap-2">
                {question.images.map((image) => (
                  <div key={image} className="relative aspect-square overflow-hidden rounded-md border bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      aria-label="이미지 삭제"
                      onClick={() =>
                        onQuestion(index, {
                          images: question.images?.filter((item) => item !== image) ?? [],
                        })
                      }
                      className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-md bg-zinc-950 text-white"
                    >
                      <X aria-hidden className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function LiveControl({
  code,
  state,
  busy,
  onAction,
  onRefresh,
}: {
  code: string;
  state: RoomState | null;
  busy: boolean;
  onAction: (action: () => Promise<RoomState>, success: string) => Promise<void>;
  onRefresh: () => Promise<RoomState | null>;
}) {
  const [tiebreakQuestion, setTiebreakQuestion] = useState<QuizQuestion>(() => ({
    ...createBlankQuestion("short"),
    isTiebreaker: true,
  }));
  const [tiebreakNotice, setTiebreakNotice] = useState("");
  const [uploadingTiebreakImages, setUploadingTiebreakImages] = useState(false);
  const question = state?.currentQuestion ?? null;
  const answers = state?.answers ?? [];
  const participants = state?.participants ?? [];
  const ranking = state?.ranking ?? participants;
  const submittedIds = new Set(answers.map((answer) => answer.participantId));
  const phase = state?.phase ?? "lobby";
  const tiebreakError = validateRuntimeQuestion(tiebreakQuestion);

  function updateTiebreakQuestion(patch: Partial<QuizQuestion>) {
    setTiebreakQuestion((current) => ({ ...current, ...patch, isTiebreaker: true }));
  }

  function changeTiebreakKind(kind: QuizQuestion["kind"]) {
    setTiebreakQuestion((current) => ({
      ...createBlankQuestion(kind),
      prompt: current.prompt,
      explanation: current.explanation,
      isTiebreaker: true,
    }));
  }

  async function uploadTiebreakImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).slice(0, 4);

    if (files.length === 0) {
      return;
    }

    const currentImages = tiebreakQuestion.images ?? [];

    if (currentImages.length >= 4) {
      setTiebreakNotice("이미지는 문제당 최대 4장까지 첨부할 수 있습니다.");
      event.target.value = "";
      return;
    }

    setUploadingTiebreakImages(true);
    setTiebreakNotice("");

    try {
      const uploaded = [];

      for (const file of files.slice(0, 4 - currentImages.length)) {
        uploaded.push(await quizApi.uploadImage(await compressImage(file)));
      }

      updateTiebreakQuestion({
        images: [...currentImages, ...uploaded.map((image) => image.url)].slice(0, 4),
      });
      setTiebreakNotice("이미지를 첨부했습니다.");
    } catch (error) {
      setTiebreakNotice(messageFrom(error));
    } finally {
      setUploadingTiebreakImages(false);
      event.target.value = "";
    }
  }

  return (
    <section className="space-y-5">
      <div className="rounded-md border-2 border-zinc-950 bg-white p-4 shadow-[6px_6px_0_#ffcf4a]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-black">진행 콘솔</h2>
            <p className="mt-1 text-sm text-zinc-600">
              시작하면 새 참가자는 게임에 참여할 수 없습니다.
            </p>
          </div>
          <Button variant="outline" onClick={() => void onRefresh()} disabled={!code || busy}>
            <RefreshCw aria-hidden />
            동기화
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Button disabled={!code || busy || phase !== "lobby"} onClick={() => void onAction(() => quizApi.startRoom(code), "게임을 시작했습니다.")}>
            시작
          </Button>
          <Button disabled={!code || busy || phase !== "question"} variant="outline" onClick={() => void onAction(() => quizApi.closeQuestion(code), "제출을 마감했습니다.")}>
            <X aria-hidden />
            마감
          </Button>
          <Button disabled={!code || busy || phase !== "closed"} variant="outline" onClick={() => void onAction(() => quizApi.revealQuestion(code), "정답을 공개했습니다.")}>
            <Eye aria-hidden />
            공개
          </Button>
          <Button disabled={!code || busy || phase !== "revealed"} className="bg-[#ffcf4a] text-zinc-950 hover:bg-[#f2bd2f]" onClick={() => void onAction(() => quizApi.nextQuestion(code), "다음 문제로 이동했습니다.")}>
            다음
          </Button>
        </div>

        <div className="mt-5 rounded-md bg-[#f7f2e8] p-4">
          <p className="text-sm font-bold text-zinc-500">
            현재 단계 {phaseLabel(state?.phase)} · 문제 {questionNumberLabel(state?.currentQuestionIndex)}
          </p>
          <h3 className="mt-2 text-2xl font-black leading-tight">
            {question?.prompt || "방을 만들고 시작하면 현재 문제가 표시됩니다."}
          </h3>
          {question?.images?.length ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {question.images.slice(0, 4).map((image) => (
                <div key={image} className="aspect-video overflow-hidden rounded-md bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image} alt="" className="h-full w-full object-cover" />
                </div>
              ))}
            </div>
          ) : null}
          {question?.options?.length ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {question.options.map((option) => (
                <div key={option} className="rounded-md bg-white p-3 font-black">
                  {optionLabel(question, option)}
                </div>
              ))}
            </div>
          ) : null}
          {question?.explanation ? (
            <p className="mt-4 rounded-md bg-white p-3 text-sm leading-6 text-zinc-700">
              {question.explanation}
            </p>
          ) : null}
        </div>
      </div>

      <div className="rounded-md border-2 border-zinc-950 bg-white p-4">
        <h2 className="text-xl font-black">제출 현황</h2>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Metric label="참가자" value={participants.length} />
          <Metric label="제출" value={submittedIds.size} />
          <Metric label="생존" value={aliveCount(participants)} />
        </div>
        <div className="mt-4 max-h-80 space-y-2 overflow-auto pr-1">
          {participants.map((participant) => {
            const answer = answers.find((item) => item.participantId === participant.id);

            return (
              <div key={participant.id} className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 p-3">
                <div className="min-w-0">
                  <p className="truncate font-black">
                    {participant.nickname}
                    {participant.eliminated ? <span className="ml-2 text-xs text-[#b42318]">탈락</span> : null}
                  </p>
                  <p className="truncate text-sm text-zinc-600">
                    {answer ? `답: ${Array.isArray(answer.answer) ? answer.answer.join(", ") : answer.answer}` : "미제출"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="icon-sm"
                    variant="outline"
                    aria-label="정답 처리"
                    onClick={() => void onAction(() => quizApi.gradeAnswer(code, participant.id, true), "정답으로 처리했습니다.")}
                    disabled={!code || busy}
                  >
                    <Check aria-hidden />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="outline"
                    aria-label="오답 처리"
                    onClick={() => void onAction(() => quizApi.gradeAnswer(code, participant.id, false), "오답으로 처리했습니다.")}
                    disabled={!code || busy}
                  >
                    <X aria-hidden />
                  </Button>
                </div>
              </div>
            );
          })}
          {participants.length === 0 ? <p className="text-sm text-zinc-500">아직 참가자가 없습니다.</p> : null}
        </div>
      </div>

      <div className="rounded-md border-2 border-zinc-950 bg-white p-4">
        <h2 className="text-xl font-black">타이브레이커</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["ox", "multiple", "short"] as const).map((kind) => (
            <Button
              key={kind}
              type="button"
              size="sm"
              variant={tiebreakQuestion.kind === kind ? "default" : "outline"}
              onClick={() => changeTiebreakKind(kind)}
              className={tiebreakQuestion.kind === kind ? "bg-zinc-950 text-white" : ""}
            >
              {kind === "ox" ? "O/X" : kind === "multiple" ? "객관식" : "주관식"}
            </Button>
          ))}
        </div>
        <textarea
          value={tiebreakQuestion.prompt}
          onChange={(event) => updateTiebreakQuestion({ prompt: event.target.value })}
          placeholder="동점자에게 낼 문제"
          rows={3}
          className="mt-3 w-full rounded-md border border-zinc-300 px-3 py-2"
        />

        {tiebreakQuestion.kind !== "short" ? (
          <div className="mt-3 grid gap-2">
            {(tiebreakQuestion.options ?? []).map((option, optionIndex) => (
              <label key={optionIndex} className="flex items-center gap-2 rounded-md bg-[#f7f2e8] p-2">
                <input
                  type="radio"
                  name="runtime-tiebreak-correct"
                  checked={tiebreakQuestion.correctAnswers.includes(option)}
                  onChange={() => updateTiebreakQuestion({ correctAnswers: [option] })}
                />
                <input
                  value={option}
                  disabled={tiebreakQuestion.kind === "ox"}
                  onChange={(event) => {
                    const nextOptions = [...(tiebreakQuestion.options ?? [])];
                    const previous = nextOptions[optionIndex];
                    nextOptions[optionIndex] = event.target.value;
                    updateTiebreakQuestion({
                      options: nextOptions,
                      correctAnswers: tiebreakQuestion.correctAnswers.includes(previous)
                        ? [event.target.value]
                        : tiebreakQuestion.correctAnswers,
                    });
                  }}
                  placeholder={`보기 ${optionIndex + 1}`}
                  className="h-10 min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3"
                />
              </label>
            ))}
          </div>
        ) : (
          <input
            value={tiebreakQuestion.correctAnswers.join(", ")}
            onChange={(event) =>
              updateTiebreakQuestion({
                correctAnswers: event.target.value
                  .split(",")
                  .map((answer) => answer.trim())
                  .filter(Boolean),
              })
            }
            placeholder="정답을 쉼표로 구분해 입력"
            className="mt-3 h-11 w-full rounded-md border border-zinc-300 px-3"
          />
        )}

        <textarea
          value={tiebreakQuestion.explanation ?? ""}
          onChange={(event) => updateTiebreakQuestion({ explanation: event.target.value })}
          placeholder="정답 공개 후 보여줄 해설"
          rows={2}
          className="mt-3 w-full rounded-md border border-zinc-300 px-3 py-2"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-bold">
            <ImagePlus aria-hidden className="size-4" />
            이미지 첨부
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="sr-only"
              disabled={busy || uploadingTiebreakImages}
              onChange={(event) => void uploadTiebreakImages(event)}
            />
          </label>
          <span className="text-sm text-zinc-500">{tiebreakQuestion.images?.length ?? 0} / 4장</span>
        </div>

        {tiebreakQuestion.images?.length ? (
          <div className="mt-3 grid grid-cols-4 gap-2">
            {tiebreakQuestion.images.map((image) => (
              <div key={image} className="relative aspect-square overflow-hidden rounded-md border bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  aria-label="이미지 삭제"
                  onClick={() =>
                    updateTiebreakQuestion({
                      images: tiebreakQuestion.images?.filter((item) => item !== image) ?? [],
                    })
                  }
                  className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-md bg-zinc-950 text-white"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {tiebreakError ? (
          <p className="mt-2 rounded-md bg-[#fff4d0] p-2 text-sm font-bold text-[#8a6100]">
            {tiebreakError}
          </p>
        ) : null}
        {tiebreakNotice ? (
          <p className="mt-2 rounded-md bg-[#f7f2e8] p-2 text-sm font-bold">
            {tiebreakNotice}
          </p>
        ) : null}
        <Button
          className="mt-3 w-full bg-zinc-950 font-black text-white"
          disabled={!code || busy || uploadingTiebreakImages || Boolean(tiebreakError)}
          onClick={() =>
            void onAction(
              () =>
                quizApi.createTiebreaker(code, cleanRuntimeQuestion(tiebreakQuestion)),
              "타이브레이커 문제를 시작했습니다.",
            )
          }
        >
          타이브레이커 시작
        </Button>
      </div>

      <div className="rounded-md border-2 border-zinc-950 bg-white p-4">
        <h2 className="text-xl font-black">순위</h2>
        <div className="mt-3 space-y-2">
          {ranking.slice(0, 10).map((row, index) => (
            <div key={row.id} className="flex items-center justify-between rounded-md bg-[#f7f2e8] p-3">
              <span className="font-black">
                {row.rank ?? index + 1}위 {row.nickname}
              </span>
              <span className="text-sm font-bold text-zinc-600">
                {row.correctCount ?? row.score ?? 0}점
              </span>
            </div>
          ))}
          {ranking.length === 0 ? <p className="text-sm text-zinc-500">순위는 게임 시작 후 표시됩니다.</p> : null}
        </div>
      </div>
    </section>
  );
}

function cleanQuiz(quiz: QuizSet): QuizSet {
  return {
    ...quiz,
    title: quiz.title.trim() || "제목 없는 문제 세트",
    questions: quiz.questions.map((question) => ({
      ...question,
      prompt: question.prompt.trim(),
      options: question.kind === "short" ? undefined : question.options?.map((option) => option.trim()).filter(Boolean),
      correctAnswers: question.correctAnswers.map((answer) => answer.trim()).filter(Boolean),
      explanation: question.explanation?.trim() || undefined,
      images: (question.images ?? []).slice(0, 4),
    })),
  };
}
