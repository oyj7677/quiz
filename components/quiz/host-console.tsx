"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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

type HostView = "home" | "quizzes" | "rooms" | "results" | "settings";

const hostNavigation: Array<{ view: HostView; href: string; label: string }> = [
  { view: "home", href: "/host", label: "홈" },
  { view: "quizzes", href: "/host/quizzes", label: "퀴즈 관리" },
  { view: "rooms", href: "/host/rooms", label: "진행 중인 방" },
  { view: "results", href: "/host/results", label: "결과" },
  { view: "settings", href: "/host/settings", label: "설정" },
];

export function HostConsole({ view = "home", roomCode = "" }: { view?: HostView; roomCode?: string }) {
  const [username, setUsername] = useState("ming");
  const [password, setPassword] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [checking, setChecking] = useState(true);
  const [quizzes, setQuizzes] = useState<QuizSet[]>([]);
  const [rooms, setRooms] = useState<Array<{ code: string; phase?: string; createdAt?: string }>>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [draft, setDraft] = useState<QuizSet>(sampleQuiz);
  const [activeCode, setActiveCode] = useState(() => normalizeCode(roomCode));
  const [state, setState] = useState<RoomState | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [origin, setOrigin] = useState("");

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

  async function loadQuizzes(preferredId?: string) {
    const result = await quizApi.listQuizzes();
    const list = normalizeQuizList(result);
    setQuizzes(list);

    const selected = list.find((quiz) => quiz.id === preferredId) ?? list[0];
    if (selected) {
      setSelectedId(selected.id ?? "");
      setDraft(structuredClone(selected));
    } else {
      setSelectedId("");
      setDraft(structuredClone(sampleQuiz));
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
    if (!loggedIn || !activeCode || (view !== "rooms" && view !== "results")) {
      return;
    }

    const firstLoad = window.setTimeout(() => {
      void refreshState(activeCode);
    }, 0);
    const id = view === "rooms" ? window.setInterval(() => {
      void refreshState(activeCode, true);
    }, 2000) : undefined;

    return () => {
      window.clearTimeout(firstLoad);
      if (id) window.clearInterval(id);
    };
  }, [activeCode, loggedIn, refreshState, view]);

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
      await loadQuizzes(saved.id);
    }
  }

  async function createRoom(quizId?: string) {
    const id = quizId ?? draft.id;

    if (!id) {
      setNotice("방을 만들기 전에 문제 세트를 먼저 저장하세요.");
      return;
    }

    const result = await run(() => quizApi.createRoom(id), "새 진행 방을 만들었습니다.");
    const code = result?.room?.code ?? result?.code;

    if (code) {
      window.location.assign(`/host/rooms/${normalizeCode(code)}`);
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
    } else {
      setDraft(structuredClone(sampleQuiz));
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
      if (view === "results" && normalizeCode(roomCode) === normalized) {
        window.location.assign("/host/results");
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
      setLoggedIn(false);
      setNotice("비밀번호가 변경되었습니다. 새 비밀번호로 다시 로그인하세요.");
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
          <a href="/" className="mb-8 text-sm font-black text-zinc-600">
            {BRAND_NAME}
          </a>
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

  const runningRooms = rooms.filter((room) => room.phase !== "finished");
  const finishedRooms = rooms.filter((room) => room.phase === "finished");

  return (
    <main className="min-h-screen bg-[#f7f2e8] text-zinc-950">
      <header className="border-b-2 border-zinc-950 bg-white px-4 pt-3 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 pb-3">
          <a href="/host" className="flex items-center gap-3 font-black">
            <span className="grid h-10 w-10 place-items-center rounded-md bg-zinc-950 text-white">벨</span>
            {BRAND_NAME} 진행자
          </a>
          <Button
            variant="outline"
            onClick={() => void quizApi.hostLogout().finally(() => setLoggedIn(false))}
          >
            <LogOut aria-hidden />
            로그아웃
          </Button>
        </div>
        <nav aria-label="진행자 메뉴" className="mx-auto flex max-w-7xl gap-1 overflow-x-auto pb-2">
          {hostNavigation.map((item) => (
            <a
              key={item.view}
              href={item.href}
              aria-current={view === item.view ? "page" : undefined}
              className={`shrink-0 rounded-md px-4 py-2 text-sm font-black transition-colors ${
                view === item.view ? "bg-zinc-950 text-white" : "text-zinc-600 hover:bg-[#fff0ba] hover:text-zinc-950"
              }`}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {notice ? <p role="status" className="mb-5 rounded-md border border-[#e8b835] bg-[#fff4d0] p-3 text-sm font-bold">{notice}</p> : null}

        {view === "home" ? (
          <div className="space-y-6">
            <section className="rounded-md border-2 border-zinc-950 bg-[#ffcf4a] p-6 shadow-[7px_7px_0_#18181b] sm:p-8">
              <p className="text-sm font-black">진행자 홈</p>
              <h1 className="mt-2 text-3xl font-black sm:text-4xl">오늘의 골든벨을 준비하세요</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6">문제를 준비하고 방을 만들면 참가자는 QR 코드로 입장할 수 있습니다.</p>
              <div className="mt-6 flex flex-wrap gap-2">
                <Button asChild className="bg-zinc-950 font-black text-white"><a href="/host/quizzes">퀴즈 관리로 이동</a></Button>
                <Button asChild variant="outline" className="border-zinc-950 bg-white font-black"><a href="/host/rooms">진행 중인 방 보기</a></Button>
              </div>
            </section>
            <div className="grid gap-3 sm:grid-cols-3">
              <DashboardMetric label="저장된 문제 세트" value={quizzes.length} href="/host/quizzes" />
              <DashboardMetric label="진행 중인 방" value={runningRooms.length} href="/host/rooms" />
              <DashboardMetric label="완료된 결과" value={finishedRooms.length} href="/host/results" />
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <section className="rounded-md border-2 border-zinc-950 bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-xl font-black">진행 중인 방</h2>
                  <a href="/host/rooms" className="text-sm font-bold underline">모두 보기</a>
                </div>
                <RoomLinks rooms={runningRooms.slice(0, 4)} empty="진행 중인 방이 없습니다." />
              </section>
              <section className="rounded-md border-2 border-zinc-950 bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-xl font-black">문제 세트로 방 만들기</h2>
                  <a href="/host/quizzes" className="text-sm font-bold underline">문제 편집</a>
                </div>
                <div className="mt-4 space-y-2">
                  {quizzes.slice(0, 5).map((quiz) => (
                    <div key={quiz.id} className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 p-3">
                      <div className="min-w-0"><p className="truncate font-black">{quiz.title}</p><p className="text-xs text-zinc-500">{quiz.questions.length}문제</p></div>
                      <Button size="sm" disabled={busy} onClick={() => void createRoom(quiz.id)}>방 만들기</Button>
                    </div>
                  ))}
                  {quizzes.length === 0 ? <p className="text-sm text-zinc-500">먼저 문제 세트를 만들어 주세요.</p> : null}
                </div>
              </section>
            </div>
          </div>
        ) : null}

        {view === "quizzes" ? (
          <div>
            <PageHeading title="퀴즈 관리" description="문제를 만들고 저장한 뒤 행사 방을 시작하세요." />
            <div className="grid items-start gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
              <section className="rounded-md border-2 border-zinc-950 bg-white p-4 shadow-[5px_5px_0_#18181b]">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-xl font-black">문제 세트</h2>
                  <Button size="sm" variant="outline" onClick={() => { setSelectedId(""); setDraft(structuredClone(sampleQuiz)); }}><Plus aria-hidden />새 세트</Button>
                </div>
                <select value={selectedId} onChange={(event) => selectQuiz(event.target.value)} className="mt-4 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 font-bold">
                  <option value="">새 문제 세트</option>
                  {quizzes.map((quiz) => <option key={quiz.id ?? quiz.title} value={quiz.id ?? ""}>{quiz.title}</option>)}
                </select>
                <label className="mt-4 block text-sm font-bold" htmlFor="quiz-title">제목</label>
                <input id="quiz-title" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} className="mt-2 h-11 w-full rounded-md border border-zinc-300 px-3 font-bold" />
                <label className="mt-4 block text-sm font-bold" htmlFor="quiz-desc">설명</label>
                <textarea id="quiz-desc" value={draft.description ?? ""} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} rows={3} className="mt-2 w-full rounded-md border border-zinc-300 px-3 py-2" />
                <div className="mt-4 flex gap-2">
                  <Button onClick={() => void saveDraft()} disabled={busy} className="flex-1 bg-zinc-950 font-black text-white"><Save aria-hidden />저장</Button>
                  <Button onClick={() => void createRoom()} disabled={busy || !draft.id} className="flex-1 bg-[#ffcf4a] font-black text-zinc-950 hover:bg-[#f2bd2f]"><MonitorPlay aria-hidden />방 만들기</Button>
                </div>
                {!draft.id ? <p className="mt-2 text-xs text-zinc-500">새 세트는 저장 후 방을 만들 수 있습니다.</p> : null}
                <Button variant="outline" className="mt-3 w-full" onClick={() => void deleteSelectedQuiz()} disabled={busy || !draft.id}><Trash2 aria-hidden />문제 세트 삭제</Button>
              </section>
              <QuizEditor draft={draft} busy={busy} onDraft={setDraft} onQuestion={updateQuestion} onKind={changeKind} onUpload={uploadImages} />
            </div>
          </div>
        ) : null}

        {view === "rooms" ? (
          <div>
            <PageHeading title={roomCode ? `진행 방 ${activeCode}` : "진행 중인 방"} description={roomCode ? "대기실과 문제 진행을 한곳에서 관리합니다." : "방을 선택해 참가 안내와 진행 콘솔을 엽니다."} />
            {roomCode && state?.phase === "finished" ? (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border-2 border-zinc-950 bg-[#ffcf4a] p-5">
                  <p className="font-black">이 방의 게임이 종료되었습니다.</p>
                  <Button asChild className="bg-zinc-950 text-white"><a href={`/host/results/${activeCode}`}>결과 화면 보기</a></Button>
                </div>
                <ResultDetail state={state} selected />
              </div>
            ) : roomCode ? (
              <div className="grid items-start gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
                <RoomCard activeCode={activeCode} joinUrl={joinUrl} qrUrl={qrUrl} state={state} onCopy={(text) => void navigator.clipboard?.writeText(text)} />
                <LiveControl code={activeCode} state={state} busy={busy} onAction={roomAction} onRefresh={() => refreshState()} />
              </div>
            ) : (
              <section className="rounded-md border-2 border-zinc-950 bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-black">열려 있는 방</h2><Button asChild variant="outline"><a href="/host/quizzes">새 방 만들기</a></Button></div>
                <RoomLinks rooms={runningRooms} empty="진행 중인 방이 없습니다. 퀴즈 관리에서 새 방을 만들어 주세요." />
              </section>
            )}
          </div>
        ) : null}

        {view === "results" ? (
          <div>
            <PageHeading title="결과" description="완료한 게임의 우승자와 순위를 확인하세요." />
            <div className="grid items-start gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
              <section className="rounded-md border-2 border-zinc-950 bg-white p-4">
                <h2 className="text-xl font-black">완료된 진행 기록</h2>
                <div className="mt-4 space-y-2">
                  {finishedRooms.map((room) => (
                    <div key={room.code} className="flex items-center gap-2 rounded-md border border-zinc-200 p-3">
                      <a href={`/host/results/${normalizeCode(room.code)}`} aria-current={normalizeCode(room.code) === normalizeCode(roomCode) ? "page" : undefined} className="min-w-0 flex-1">
                        <p className="font-black">{room.code}</p><p className="text-xs text-zinc-500">{room.createdAt ? new Date(room.createdAt).toLocaleString("ko-KR") : "완료"}</p>
                      </a>
                      <Button size="icon-sm" variant="outline" aria-label={`${room.code} 결과 삭제`} disabled={busy} onClick={() => void deleteActiveRoom(room.code)}><Trash2 aria-hidden /></Button>
                    </div>
                  ))}
                  {finishedRooms.length === 0 ? <p className="text-sm text-zinc-500">완료된 게임이 없습니다.</p> : null}
                </div>
              </section>
              <ResultDetail state={roomCode ? state : null} selected={Boolean(roomCode)} />
            </div>
          </div>
        ) : null}

        {view === "settings" ? (
          <div>
            <PageHeading title="설정" description="진행자 계정의 비밀번호를 관리합니다." />
            <div className="max-w-xl">
              <PasswordCard currentPassword={currentPassword} nextPassword={nextPassword} busy={busy} onCurrentPassword={setCurrentPassword} onNextPassword={setNextPassword} onSubmit={changePassword} />
            </div>
          </div>
        ) : null}
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
        <a href={activeCode ? `/display/${activeCode}` : "/host"} target="_blank" rel="noopener noreferrer">
          <MonitorPlay aria-hidden />
          발표 화면 열기
        </a>
      </Button>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Metric label="참가" value={participants.length} />
        <Metric label="생존" value={aliveCount(participants)} />
        <Metric label="단계" value={phaseLabel(state?.phase)} />
      </div>
    </section>
  );
}

function PageHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-3xl font-black">{title}</h1>
      <p className="mt-2 text-sm text-zinc-600">{description}</p>
    </div>
  );
}

function DashboardMetric({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <a href={href} className="rounded-md border-2 border-zinc-950 bg-white p-5 shadow-[5px_5px_0_#18181b] hover:bg-[#fff9e8]">
      <p className="text-sm font-bold text-zinc-600">{label}</p>
      <p className="mt-2 text-3xl font-black">{value}</p>
    </a>
  );
}

function RoomLinks({ rooms, empty }: { rooms: Array<{ code: string; phase?: string; createdAt?: string }>; empty: string }) {
  return (
    <div className="mt-4 space-y-2">
      {rooms.map((room) => (
        <a key={room.code} href={`/host/rooms/${normalizeCode(room.code)}`} className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 p-3 hover:bg-[#fff9e8]">
          <div>
            <p className="font-black">{room.code}</p>
            <p className="text-xs text-zinc-500">{room.createdAt ? new Date(room.createdAt).toLocaleString("ko-KR") : "진행 중"}</p>
          </div>
          <span className="rounded-md bg-[#ffcf4a] px-2 py-1 text-xs font-black">{phaseLabel(room.phase)}</span>
        </a>
      ))}
      {rooms.length === 0 ? <p className="text-sm text-zinc-500">{empty}</p> : null}
    </div>
  );
}

function ResultDetail({ state, selected }: { state: RoomState | null; selected: boolean }) {
  if (!selected || !state) {
    return (
      <section className="rounded-md border-2 border-zinc-950 bg-white p-6">
        <h2 className="text-xl font-black">상세 결과</h2>
        <p className="mt-3 text-sm text-zinc-500">{selected ? "결과를 불러오는 중입니다." : "왼쪽에서 완료된 기록을 선택하세요."}</p>
      </section>
    );
  }

  const ranking = state.ranking ?? [];
  const participants = state.participants ?? [];
  return (
    <section className="rounded-md border-2 border-zinc-950 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-zinc-500">방 {state.code}</p>
          <h2 className="mt-1 text-2xl font-black">{state.quiz?.title ?? "골든벨 결과"}</h2>
        </div>
        <Button asChild variant="outline"><a href={`/display/${state.code}`} target="_blank" rel="noopener noreferrer"><MonitorPlay aria-hidden />발표 화면</a></Button>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Metric label="참가자" value={participants.length} />
        <Metric label="문제" value={state.quiz?.questions.length ?? 0} />
        <Metric label="상태" value={phaseLabel(state.phase)} />
      </div>
      <div className="mt-5 rounded-md bg-[#ffcf4a] p-5">
        <p className="text-sm font-black">최종 우승자</p>
        <p className="mt-2 text-2xl font-black">{state.winner?.nickname ?? "우승자 없음"}</p>
      </div>
      <h3 className="mt-6 text-lg font-black">최종 순위</h3>
      <div className="mt-3 space-y-2">
        {ranking.map((row, index) => (
          <div key={row.id} className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 p-3">
            <span className="font-black">{row.rank ?? index + 1}위 · {row.nickname}</span>
            <span className="text-sm font-bold text-zinc-600">{row.correctCount ?? row.score ?? 0}점</span>
          </div>
        ))}
        {ranking.length === 0 ? <p className="text-sm text-zinc-500">표시할 순위가 없습니다.</p> : null}
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
          <Button disabled={!code || !state || busy || phase !== "lobby"} onClick={() => void onAction(() => quizApi.startRoom(code), "게임을 시작했습니다.")}>
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
