"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Check,
  Copy,
  GripVertical,
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
  QuestionCategory,
  QuizQuestion,
  QuizSet,
  RoomState,
  unwrapQuiz,
} from "@/lib/client/quiz-api";

type QuestionPool = QuestionCategory;
type ExtendedRoomState = RoomState & {
  room?: NonNullable<RoomState["room"]> & {
    activeCount?: number;
    submittedCount?: number;
    needsTiebreaker?: boolean;
    currentPool?: QuestionPool;
    playMode?: "random" | "sequential";
    previewQuestion?: QuizQuestion | null;
  };
  availableQuestions?: Partial<Record<QuestionPool, QuizQuestion[]>>;
};

const poolLabels: Record<QuestionPool, string> = {
  regular: "일반 문제",
  revival: "패자부활 문제",
  tiebreaker: "동점자 문제",
};

const poolDescriptions: Record<QuestionPool, string> = {
  regular: "생존자가 답을 제출하고 탈락자는 관전합니다.",
  revival: "정답 공개 후 진행자가 열면 탈락자 전원이 참여합니다.",
  tiebreaker: "마무리 때 동점 우승 후보만 가리는 문제입니다.",
};

const sampleQuiz: QuizSet = {
  title: "새 골든벨 문제 세트",
  description: "오프라인 행사에서 바로 사용할 수 있는 기본 세트",
  questions: [
    {
      category: "regular",
      kind: "ox",
      prompt: "골든벨 퀴즈는 진행자가 마감하기 전까지 답을 바꿀 수 있다.",
      options: ["O", "X"],
      correctAnswers: ["O"],
      explanation: "진행자가 마감 버튼을 누르기 전까지 마지막 제출 답안이 반영됩니다.",
      images: [],
    },
    {
      category: "regular",
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

const questionCategories: Array<{ value: QuestionCategory; label: string; description: string }> = [
  { value: "regular", label: poolLabels.regular, description: poolDescriptions.regular },
  { value: "revival", label: poolLabels.revival, description: poolDescriptions.revival },
  { value: "tiebreaker", label: poolLabels.tiebreaker, description: poolDescriptions.tiebreaker },
];

function questionCategory(question: QuizQuestion): QuestionCategory {
  if (question.category === "revival" || question.category === "tiebreaker" || question.category === "regular") {
    return question.category;
  }

  return question.isTiebreaker ? "tiebreaker" : "regular";
}

function categoryLabel(category: QuestionCategory) {
  return questionCategories.find((item) => item.value === category)?.label ?? "일반 문제";
}

function questionKindLabel(kind: QuizQuestion["kind"]) {
  switch (kind) {
    case "ox":
      return "O/X";
    case "multiple":
      return "객관식";
    case "short":
      return "주관식";
    case "order":
      return "순서 나열";
    default:
      return String(kind);
  }
}

function uniqueTrimmedValues(values: string[] = []) {
  const trimmed = values.map((value) => value.trim()).filter(Boolean);
  return new Set(trimmed).size === trimmed.length;
}

function stableIndex(seed: string, length: number) {
  if (length <= 0) return 0;
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }

  return hash % length;
}

function cleanRuntimeQuestion(question: QuizQuestion): QuizQuestion {
  const options = question.kind === "short"
    ? undefined
    : question.options?.map((option) => option.trim()).filter(Boolean);

  return {
    ...question,
    prompt: question.prompt.trim(),
    options,
    correctAnswers: question.kind === "order" ? (options ?? []) : question.correctAnswers.map((answer) => answer.trim()).filter(Boolean),
    explanation: question.explanation?.trim() || undefined,
    images: (question.images ?? []).slice(0, 4),
    category: "tiebreaker",
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

  if (cleaned.kind === "order") {
    const options = cleaned.options ?? [];

    if (options.length < 3 || options.length > 6) {
      return "순서 나열 보기는 3~6개 필요합니다.";
    }

    if (!uniqueTrimmedValues(options)) {
      return "순서 나열 보기는 중복 없이 입력하세요.";
    }
  } else if (cleaned.kind !== "short") {
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

function validateQuizDraft(quiz: QuizSet): { index: number; message: string } | null {
  if (!quiz.title.trim()) return { index: -1, message: "제목을 입력하세요." };
  if (quiz.questions.length === 0) return { index: -1, message: "문제를 1개 이상 추가하세요." };
  for (let index = 0; index < quiz.questions.length; index += 1) {
    const question = quiz.questions[index];
    if (!question.prompt.trim()) return { index, message: "문제를 입력하세요." };
    if (!question.correctAnswers.some((answer) => answer.trim())) return { index, message: "정답을 입력하세요." };
    if (question.kind === "multiple") {
      const options = (question.options ?? []).map((option) => option.trim()).filter(Boolean);
      if (options.length < 2 || options.length > 8) return { index, message: "보기는 2~8개 필요합니다." };
      if (!question.correctAnswers.every((answer) => options.includes(answer.trim()))) {
        return { index, message: "정답은 보기 중에서 선택하세요." };
      }
    }
    if (question.kind === "order") {
      const options = (question.options ?? []).map((option) => option.trim()).filter(Boolean);
      if (options.length < 3 || options.length > 6) return { index, message: "순서 나열 보기는 3~6개 필요합니다." };
      if (!uniqueTrimmedValues(options)) return { index, message: "순서 나열 보기는 중복 없이 입력하세요." };
    }
  }
  return null;
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
  const [rooms, setRooms] = useState<Array<{ code: string; phase?: string; createdAt?: string; quizTitle?: string }>>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [draft, setDraft] = useState<QuizSet>(sampleQuiz);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(cleanQuiz(sampleQuiz)));
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [expandedQuestionIndex, setExpandedQuestionIndex] = useState<number | null>(0);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "quiz" | "room"; id: string; label: string } | null>(null);
  const [deletedQuizzes, setDeletedQuizzes] = useState<QuizSet[]>([]);
  const [deletedRooms, setDeletedRooms] = useState<Array<{ code: string; quizTitle?: string }>>([]);
  const allowNavigation = useRef(false);
  const cancelDeleteButton = useRef<HTMLButtonElement>(null);
  const confirmDeleteButton = useRef<HTMLButtonElement>(null);
  const [activeCode, setActiveCode] = useState(() => normalizeCode(roomCode));
  const [state, setState] = useState<RoomState | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [origin, setOrigin] = useState("");
  const dirty = view === "quizzes" && JSON.stringify(cleanQuiz(draft)) !== savedSnapshot;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (allowNavigation.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!deleteTarget) return;
    cancelDeleteButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDeleteTarget(null);
      if (event.key === "Tab") {
        if (event.shiftKey && document.activeElement === cancelDeleteButton.current) {
          event.preventDefault();
          confirmDeleteButton.current?.focus();
        } else if (!event.shiftKey && document.activeElement === confirmDeleteButton.current) {
          event.preventDefault();
          cancelDeleteButton.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteTarget]);

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
        return Promise.all([loadQuizzes(), loadRooms(), loadDeletedItems()]);
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
      setSavedSnapshot(JSON.stringify(cleanQuiz(selected)));
    } else {
      setSelectedId("");
      setDraft(structuredClone(sampleQuiz));
      setSavedSnapshot(JSON.stringify(cleanQuiz(sampleQuiz)));
    }
  }

  async function loadRooms() {
    const result = await quizApi.listRooms();
    setRooms(result.rooms ?? []);
  }

  async function loadDeletedItems() {
    const [quizResult, roomResult] = await Promise.all([quizApi.listDeletedQuizzes(), quizApi.listDeletedRooms()]);
    setDeletedQuizzes(quizResult.quizzes ?? []);
    setDeletedRooms(roomResult.rooms ?? []);
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
      await Promise.all([loadQuizzes(), loadRooms(), loadDeletedItems()]);
    }
  }

  async function saveDraft() {
    setValidationAttempt((current) => current + 1);
    const validation = validateQuizDraft(draft);
    if (validation) {
      setNotice(validation.index < 0 ? validation.message : `문제 ${validation.index + 1}: ${validation.message}`);
      if (validation.index >= 0) {
        setExpandedQuestionIndex(validation.index);
        window.setTimeout(() => document.getElementById(`quiz-question-${validation.index}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
      } else if (!draft.title.trim()) {
        document.getElementById("quiz-title")?.focus();
      }
      return null;
    }
    const cleaned = cleanQuiz(draft);
    const result = await run(
      () => (cleaned.id ? quizApi.updateQuiz(cleaned.id, cleaned) : quizApi.saveQuiz(cleaned)),
      "문제 세트를 저장했습니다.",
    );

    if (result) {
      const saved = unwrapQuiz(result);
      setDraft(saved);
      setSelectedId(saved.id ?? "");
      setSavedSnapshot(JSON.stringify(cleanQuiz(saved)));
      setQuizzes((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      return saved;
    }
    return null;
  }

  async function createRoom(quizId?: string) {
    const saved = !quizId && (dirty || !draft.id) ? await saveDraft() : null;
    const id = quizId ?? saved?.id ?? (dirty || !draft.id ? undefined : draft.id);

    if (!id) {
      return;
    }

    const result = await run(() => quizApi.createRoom(id), "새 진행 방을 만들었습니다.");
    const code = result?.room?.code ?? result?.code;

    if (code) {
      allowNavigation.current = true;
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
    if (id === selectedId) return;
    if (dirty && !window.confirm("저장되지 않은 변경사항이 있습니다. 저장하지 않고 다른 문제 세트로 이동할까요?")) return;
    const quiz = quizzes.find((item) => item.id === id);
    setSelectedId(id);

    if (quiz) {
      setDraft(structuredClone(quiz));
      setSavedSnapshot(JSON.stringify(cleanQuiz(quiz)));
    } else {
      setDraft(structuredClone(sampleQuiz));
      setSavedSnapshot(JSON.stringify(cleanQuiz(sampleQuiz)));
    }
    setExpandedQuestionIndex(0);
  }

  async function deleteSelectedQuiz(id: string) {
    const result = await run(() => quizApi.deleteQuiz(id), "문제 세트를 삭제했습니다. 최근 삭제됨에서 복구할 수 있습니다.");

    if (result) {
      await loadQuizzes();
      await loadDeletedItems();
    }
  }

  async function deleteActiveRoom(code: string) {
    const normalized = normalizeCode(code);

    if (!normalized) {
      return;
    }

    const result = await run(() => quizApi.deleteRoom(normalized), "진행 기록을 삭제했습니다. 최근 삭제됨에서 복구할 수 있습니다.");

    if (result) {
      setRooms((current) => current.filter((room) => normalizeCode(room.code) !== normalized));

      if (normalizeCode(activeCode) === normalized) {
        setActiveCode("");
        setState(null);
      }
      await loadDeletedItems();
      if (view === "results" && normalizeCode(roomCode) === normalized) {
        window.location.assign("/host/results");
      }
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    if (target.type === "quiz") await deleteSelectedQuiz(target.id);
    else await deleteActiveRoom(target.id);
  }

  async function restoreDeletedQuiz(id: string) {
    const restored = await run(() => quizApi.restoreQuiz(id), "문제 세트를 복구했습니다.");
    if (restored) {
      const result = await quizApi.listQuizzes();
      setQuizzes(normalizeQuizList(result));
      await loadDeletedItems();
    }
  }

  async function restoreDeletedRoom(code: string) {
    const restored = await run(() => quizApi.restoreRoom(code), "진행 결과를 복구했습니다.");
    if (restored) await Promise.all([loadRooms(), loadDeletedItems()]);
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
    const category = questionCategory(existing);
    updateQuestion(index, {
      ...createBlankQuestion(kind),
      id: existing.id,
      prompt: existing.prompt,
      explanation: existing.explanation,
      images: existing.images ?? [],
      category,
      isTiebreaker: category === "tiebreaker",
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
            onClick={() => {
              if (dirty && !window.confirm("저장되지 않은 변경사항이 있습니다. 저장하지 않고 로그아웃할까요?")) return;
              void quizApi.hostLogout().finally(() => setLoggedIn(false));
            }}
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
                  <Button size="sm" variant="outline" onClick={() => selectQuiz("")}><Plus aria-hidden />새 세트</Button>
                </div>
                <select value={selectedId} onChange={(event) => selectQuiz(event.target.value)} className="mt-4 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 font-bold">
                  <option value="">새 문제 세트</option>
                  {quizzes.map((quiz) => <option key={quiz.id ?? quiz.title} value={quiz.id ?? ""}>{quiz.title}</option>)}
                </select>
                <label className="mt-4 block text-sm font-bold" htmlFor="quiz-title">제목</label>
                <input id="quiz-title" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} className="mt-2 h-11 w-full rounded-md border border-zinc-300 px-3 font-bold" />
                <label className="mt-4 block text-sm font-bold" htmlFor="quiz-desc">설명</label>
                <textarea id="quiz-desc" value={draft.description ?? ""} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} rows={3} className="mt-2 w-full rounded-md border border-zinc-300 px-3 py-2" />
                <p role="status" className={`mt-3 rounded-md px-3 py-2 text-sm font-bold ${dirty || !draft.id ? "bg-[#fff4d0] text-[#8a6100]" : "bg-emerald-50 text-emerald-800"}`}>
                  {!draft.id ? "● 새 문제 세트 · 아직 저장 전" : dirty ? "● 저장되지 않은 변경사항" : "✓ 모든 변경사항 저장됨"}
                </p>
                <div className="mt-4 flex gap-2">
                  <Button onClick={() => void saveDraft()} disabled={busy} className="flex-1 bg-zinc-950 font-black text-white"><Save aria-hidden />저장</Button>
                  <Button onClick={() => void createRoom()} disabled={busy} className="flex-1 bg-[#ffcf4a] font-black text-zinc-950 hover:bg-[#f2bd2f]"><MonitorPlay aria-hidden />저장하고 방 만들기</Button>
                </div>
                <Button variant="outline" className="mt-3 w-full" onClick={() => setDeleteTarget({ type: "quiz", id: draft.id!, label: quizzes.find((quiz) => quiz.id === draft.id)?.title ?? draft.title })} disabled={busy || !draft.id}><Trash2 aria-hidden />문제 세트 삭제</Button>
              </section>
              <QuizEditor draft={draft} busy={busy} validationAttempt={validationAttempt} expandedIndex={expandedQuestionIndex} onExpanded={setExpandedQuestionIndex} onDraft={setDraft} onQuestion={updateQuestion} onKind={changeKind} onUpload={uploadImages} />
            </div>
            {deletedQuizzes.length ? (
              <details className="mt-5 rounded-md border border-zinc-300 bg-white p-4">
                <summary className="cursor-pointer font-black">최근 삭제된 문제 세트 ({deletedQuizzes.length})</summary>
                <ul className="mt-3 space-y-2">
                  {deletedQuizzes.map((quiz) => <li key={quiz.id} className="flex items-center justify-between gap-3 rounded-md bg-[#f7f2e8] p-3"><span className="min-w-0 truncate font-bold">{quiz.title}</span><Button size="sm" variant="outline" disabled={busy} onClick={() => void restoreDeletedQuiz(quiz.id!)}>복구</Button></li>)}
                </ul>
              </details>
            ) : null}
            <div className="sticky bottom-0 z-20 mt-5 flex items-center justify-between gap-3 rounded-md border-2 border-zinc-950 bg-white/95 p-3 shadow-[0_-4px_20px_#0002] backdrop-blur">
              <span className="text-sm font-bold">{!draft.id ? "새 문제 세트 · 저장 전" : dirty ? "저장되지 않은 변경사항" : "저장 완료"}</span>
              <Button onClick={() => void saveDraft()} disabled={busy || (!dirty && !!draft.id)} className="bg-zinc-950 font-black text-white"><Save aria-hidden />변경사항 저장</Button>
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
              <div>
                <RoomActionBar code={activeCode} state={state} busy={busy} onAction={roomAction} />
                <div className="mt-5 grid items-start gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
                  <RoomCard key={!state || state.phase === "lobby" ? "lobby" : "started"} activeCode={activeCode} joinUrl={joinUrl} qrUrl={qrUrl} state={state} onCopy={(text) => void navigator.clipboard?.writeText(text)} />
                  <LiveControl code={activeCode} state={state} busy={busy} onAction={roomAction} onRefresh={() => refreshState()} />
                </div>
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
                      <Button size="icon-sm" variant="outline" aria-label={`${room.code} 결과 삭제`} disabled={busy} onClick={() => setDeleteTarget({ type: "room", id: room.code, label: room.quizTitle || room.code })}><Trash2 aria-hidden /></Button>
                    </div>
                  ))}
                  {finishedRooms.length === 0 ? <p className="text-sm text-zinc-500">완료된 게임이 없습니다.</p> : null}
                </div>
              </section>
              <ResultDetail state={roomCode ? state : null} selected={Boolean(roomCode)} />
            </div>
            {deletedRooms.length ? (
              <details className="mt-5 rounded-md border border-zinc-300 bg-white p-4">
                <summary className="cursor-pointer font-black">최근 삭제된 진행 결과 ({deletedRooms.length})</summary>
                <ul className="mt-3 space-y-2">
                  {deletedRooms.map((room) => <li key={room.code} className="flex items-center justify-between gap-3 rounded-md bg-[#f7f2e8] p-3"><span className="min-w-0 truncate font-bold">{room.quizTitle || "진행 결과"} · {room.code}</span><Button size="sm" variant="outline" disabled={busy} onClick={() => void restoreDeletedRoom(room.code)}>복구</Button></li>)}
                </ul>
              </details>
            ) : null}
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
      {deleteTarget ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/60 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteTarget(null); }}>
          <section role="alertdialog" aria-modal="true" aria-labelledby="delete-heading" aria-describedby="delete-description" className="w-full max-w-md rounded-md border-2 border-zinc-950 bg-white p-6 shadow-[8px_8px_0_#ffcf4a]">
            <h2 id="delete-heading" className="text-xl font-black">{deleteTarget.type === "quiz" ? "문제 세트를 삭제할까요?" : "진행 결과를 삭제할까요?"}</h2>
            <p id="delete-description" className="mt-3 break-words text-sm leading-6">대상: <strong>{deleteTarget.label}</strong>{deleteTarget.type === "room" && deleteTarget.label !== deleteTarget.id ? ` · 방 코드 ${deleteTarget.id}` : ""}<br />삭제 후 최근 삭제됨에서 복구할 수 있습니다.{deleteTarget.type === "quiz" && dirty ? " 저장하지 않은 수정 내용은 사라집니다." : ""}</p>
            <div className="mt-6 flex justify-end gap-2">
              <Button ref={cancelDeleteButton} variant="outline" onClick={() => setDeleteTarget(null)}>취소</Button>
              <Button ref={confirmDeleteButton} className="bg-[#b42318] font-black text-white hover:bg-[#901c14]" disabled={busy} onClick={() => void confirmDelete()}>삭제</Button>
            </div>
          </section>
        </div>
      ) : null}
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

function RoomActionBar({ code, state, busy, onAction }: {
  code: string;
  state: ExtendedRoomState | null;
  busy: boolean;
  onAction: (action: () => Promise<RoomState>, success: string) => Promise<void>;
}) {
  const phase = state?.phase ?? "lobby";
  const eligible = (state?.participants ?? []).filter((participant) =>
    phase === "lobby" ? !participant.eliminated : participant.eligibleForRound,
  );
  const submitted = new Set((state?.answers ?? []).map((answer) => answer.participantId));
  const submittedCount = state?.room?.submittedCount ?? eligible.filter((participant) => submitted.has(participant.id)).length;
  const activeCount = state?.room?.activeCount ?? (state?.participants ?? []).filter((participant) => !participant.eliminated).length;
  const action = phase === "question"
      ? { label: "제출 마감", success: "제출을 마감했습니다.", run: () => quizApi.closeQuestion(code) }
      : phase === "closed"
        ? { label: "정답 공개", success: "정답을 공개했습니다.", run: () => quizApi.revealQuestion(code) }
        : null;
  const revealChoice = phase === "revealed" && activeCount <= 1
    ? activeCount === 1
      ? "생존자 1명 · 일반 계속, 패자부활, 우승 확정 중 선택하세요"
      : state?.room?.needsTiebreaker
        ? "생존자 0명 · 패자부활 또는 동점자 문제를 선택하세요"
        : "생존자 0명 · 패자부활 또는 마무리를 선택하세요"
    : "";

  return (
    <section className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-md border-2 border-zinc-950 bg-[#ffcf4a]/95 p-3 shadow-[0_5px_15px_#0002] backdrop-blur sm:p-4" aria-label="현재 진행 단계">
      <div>
        <p className="text-xs font-black">현재 단계 · {phaseLabel(phase)} · 문제 {questionNumberLabel(state?.currentQuestionIndex)}</p>
        <p className="mt-1 text-lg font-black">{revealChoice || (phase === "lobby" ? `참가자 ${eligible.length}명 대기 중` : `제출 ${submittedCount}/${eligible.length}명`)}</p>
      </div>
      {action ? (
        <Button
          className="min-w-36 bg-zinc-950 font-black text-white hover:bg-zinc-800"
          disabled={!state || !code || busy}
          onClick={() => void onAction(action.run, action.success)}
        >
          {action.label}
        </Button>
      ) : phase === "lobby" || phase === "revealed" ? (
        <Button
          className="min-w-36 bg-zinc-950 font-black text-white hover:bg-zinc-800"
          onClick={() => document.getElementById("question-launch-panel")?.scrollIntoView({ behavior: "smooth", block: "start" })}
        >
          다음 문제 선택
        </Button>
      ) : null}
    </section>
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
  const [qrExpanded, setQrExpanded] = useState(!state || state.phase === "lobby");

  return (
    <section className="rounded-md border-2 border-zinc-950 bg-white p-4">
      <h2 className="text-xl font-black">참가 안내</h2>
      <details className="mt-3" open={qrExpanded} onToggle={(event) => setQrExpanded(event.currentTarget.open)}>
        <summary className="cursor-pointer rounded-md bg-[#f7f2e8] px-3 py-2 font-bold">참가 QR 코드 {state?.phase === "lobby" ? "" : "보기"}</summary>
        <div className="mt-2 grid place-items-center rounded-md border border-zinc-200 bg-[#f7f2e8] p-4">
          {qrUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrUrl} alt="참가 링크 QR 코드" className="h-44 w-44 rounded-md bg-white" />
          ) : (
            <div className="grid h-44 w-44 place-items-center rounded-md bg-white text-center text-sm font-bold text-zinc-500">방을 만들면 QR이 표시됩니다.</div>
          )}
        </div>
      </details>
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
  validationAttempt,
  expandedIndex,
  onExpanded,
  onDraft,
  onQuestion,
  onKind,
  onUpload,
}: {
  draft: QuizSet;
  busy: boolean;
  validationAttempt: number;
  expandedIndex: number | null;
  onExpanded: (index: number | null) => void;
  onDraft: (quiz: QuizSet) => void;
  onQuestion: (index: number, patch: Partial<QuizQuestion>) => void;
  onKind: (index: number, kind: QuizQuestion["kind"]) => void;
  onUpload: (index: number, event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const [draggingQuestion, setDraggingQuestion] = useState<{ category: QuestionCategory; index: number } | null>(null);

  function questionItemsFor(category: QuestionCategory) {
    return draft.questions
      .map((question, index) => ({ question, index }))
      .filter((item) => questionCategory(item.question) === category);
  }

  function questionIndexesFor(category: QuestionCategory) {
    return questionItemsFor(category).map((item) => item.index);
  }

  function moveQuestionToCategoryPosition(category: QuestionCategory, index: number, targetPosition: number) {
    const items = questionItemsFor(category);
    const categoryPosition = items.findIndex((item) => item.index === index);

    if (categoryPosition < 0 || targetPosition < 0 || targetPosition >= items.length || categoryPosition === targetPosition) {
      return;
    }

    const categoryQuestions = items.map((item) => item.question);
    const [moved] = categoryQuestions.splice(categoryPosition, 1);
    categoryQuestions.splice(targetPosition, 0, moved);

    const questions = questionCategories.flatMap((item) =>
      item.value === category
        ? categoryQuestions
        : draft.questions.filter((question) => questionCategory(question) === item.value),
    );

    onDraft({ ...draft, questions });
    onExpanded(questions.indexOf(moved));
  }

  function moveQuestionWithinCategory(category: QuestionCategory, index: number, direction: -1 | 1) {
    const indexes = questionIndexesFor(category);
    const categoryPosition = indexes.indexOf(index);
    moveQuestionToCategoryPosition(category, index, categoryPosition + direction);
  }

  function addQuestion(category: QuestionCategory) {
    const question = {
      ...createBlankQuestion(category === "tiebreaker" ? "short" : "multiple"),
      category,
      isTiebreaker: category === "tiebreaker",
    };
    onDraft({
      ...draft,
      questions: [...draft.questions, question],
    });
    onExpanded(draft.questions.length);
  }

  return (
    <section className="rounded-md border-2 border-zinc-950 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black">문제 편집</h2>
          <p className="mt-1 text-sm text-zinc-600">일반·패자부활·동점자 문제와 출제 순서를 따로 관리합니다.</p>
        </div>
      </div>

      <nav aria-label="문제 목록" className="mt-4 flex flex-wrap gap-2">
        {draft.questions.map((question, index) => (
          <button key={question.id ?? index} type="button" onClick={() => { onExpanded(index); document.getElementById(`quiz-question-${index}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }} className={`rounded-md border px-3 py-2 text-sm font-bold ${expandedIndex === index ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-300 bg-white"}`}>
            {categoryLabel(questionCategory(question)).replace(" 문제", "")} {index + 1}. {question.prompt.trim().slice(0, 14) || "새 문제"}
          </button>
        ))}
      </nav>

      <div className="mt-4 space-y-4">
        {questionCategories.map((category) => {
          const indexes = questionIndexesFor(category.value);
          return (
            <section key={category.value} className="rounded-md border border-zinc-200 bg-[#fbfaf7] p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-black">{category.label}</h3>
                  <p className="mt-1 text-xs font-bold text-zinc-500">{category.description} · {indexes.length}개</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => addQuestion(category.value)}>
                  <Plus aria-hidden />
                  추가
                </Button>
              </div>
              <div className="mt-3 space-y-3">
                {indexes.length === 0 ? (
                  <p className="rounded-md border border-dashed border-zinc-300 bg-white p-4 text-sm font-bold text-zinc-500">아직 문제가 없습니다.</p>
                ) : null}
                {indexes.map((index, categoryPosition) => {
          const question = draft.questions[index];
          const validation = validationAttempt ? validateQuizDraft({ ...draft, title: draft.title || "문제", questions: [question] }) : null;
          const error = validation?.index === 0 ? validation.message : "";
          return (
          <article
            id={`quiz-question-${index}`}
            key={question.id ?? index}
            draggable
            onDragStart={() => setDraggingQuestion({ category: category.value, index })}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (draggingQuestion?.category === category.value) {
                moveQuestionToCategoryPosition(category.value, draggingQuestion.index, categoryPosition);
              }
              setDraggingQuestion(null);
            }}
            onDragEnd={() => setDraggingQuestion(null)}
            className={`scroll-mt-24 rounded-md border bg-[#fbfaf7] p-4 ${error ? "border-[#b42318]" : "border-zinc-200"} ${draggingQuestion?.index === index ? "opacity-60" : ""}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button type="button" className="flex min-w-0 items-center gap-2 text-left font-black" aria-expanded={expandedIndex === index} onClick={() => onExpanded(expandedIndex === index ? null : index)}>
                <GripVertical aria-hidden className="size-4 shrink-0 text-zinc-400" />
                {expandedIndex === index ? <ChevronUp aria-hidden className="size-4 shrink-0" /> : <ChevronDown aria-hidden className="size-4 shrink-0" />}
                <span className="truncate">{category.label} {categoryPosition + 1} · {questionKindLabel(question.kind)} · {question.prompt.trim().slice(0, 36) || "내용 없음"}</span>
              </button>
              <div className="flex flex-wrap gap-2">
                <Button size="icon-sm" variant="outline" aria-label={`${category.label} ${categoryPosition + 1} 위로 이동`} disabled={categoryPosition === 0} onClick={() => moveQuestionWithinCategory(category.value, index, -1)}><ChevronUp aria-hidden /></Button>
                <Button size="icon-sm" variant="outline" aria-label={`${category.label} ${categoryPosition + 1} 아래로 이동`} disabled={categoryPosition === indexes.length - 1} onClick={() => moveQuestionWithinCategory(category.value, index, 1)}><ChevronDown aria-hidden /></Button>
                {expandedIndex === index ? (["ox", "multiple", "short", "order"] as const).map((kind) => (
                  <Button
                    key={kind}
                    size="sm"
                    variant={question.kind === kind ? "default" : "outline"}
                    onClick={() => onKind(index, kind)}
                    className={question.kind === kind ? "bg-zinc-950 text-white" : ""}
                  >
                    {questionKindLabel(kind)}
                  </Button>
                )) : null}
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="문제 삭제"
                  onClick={() => {
                    onDraft({
                      ...draft,
                      questions: draft.questions.filter((_, questionIndex) => questionIndex !== index),
                    });
                    onExpanded(expandedIndex === null ? null : Math.max(0, Math.min(expandedIndex, draft.questions.length - 2)));
                  }}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </div>

            {error ? <p role="alert" className="mt-2 text-sm font-bold text-[#b42318]">{error}</p> : null}
            {expandedIndex === index ? <div>

            <textarea
              value={question.prompt}
              onChange={(event) => onQuestion(index, { prompt: event.target.value })}
              placeholder="문제를 입력하세요"
              rows={3}
              className="mt-3 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-lg font-bold"
            />

            <label className="mt-3 block text-sm font-bold">
              문제 묶음
              <select
                value={questionCategory(question)}
                onChange={(event) => {
                  const nextCategory = event.target.value as QuestionCategory;
                  onQuestion(index, {
                    category: nextCategory,
                    isTiebreaker: nextCategory === "tiebreaker",
                  });
                }}
                className="mt-2 h-10 w-full rounded-md border border-zinc-300 bg-white px-3"
              >
                {questionCategories.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>

            {question.kind !== "short" ? (
              <div className="mt-3">
                {question.kind === "order" ? (
                  <div>
                    <p className="text-sm font-bold text-zinc-600">참가자가 맞춰야 하는 정답 순서대로 3~6개를 입력하세요.</p>
                    <div className="mt-2 grid gap-2">
                      {(question.options ?? []).map((option, optionIndex) => (
                        <div key={optionIndex} className="flex items-center gap-2 rounded-md bg-white p-2">
                          <GripVertical aria-hidden className="size-4 shrink-0 text-zinc-400" />
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#ffcf4a] text-sm font-black">{optionIndex + 1}</span>
                          <input
                            value={option}
                            onChange={(event) => {
                              const nextOptions = [...(question.options ?? [])];
                              nextOptions[optionIndex] = event.target.value;
                              onQuestion(index, {
                                options: nextOptions,
                                correctAnswers: nextOptions,
                              });
                            }}
                            placeholder={`순서 ${optionIndex + 1}`}
                            className="h-10 min-w-0 flex-1 rounded-md border border-zinc-200 px-3"
                          />
                          <Button
                            size="icon-sm"
                            variant="outline"
                            aria-label={`순서 ${optionIndex + 1} 위로 이동`}
                            disabled={optionIndex === 0}
                            onClick={() => {
                              const nextOptions = [...(question.options ?? [])];
                              [nextOptions[optionIndex - 1], nextOptions[optionIndex]] = [nextOptions[optionIndex], nextOptions[optionIndex - 1]];
                              onQuestion(index, { options: nextOptions, correctAnswers: nextOptions });
                            }}
                          >
                            <ChevronUp aria-hidden />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="outline"
                            aria-label={`순서 ${optionIndex + 1} 아래로 이동`}
                            disabled={optionIndex === (question.options?.length ?? 0) - 1}
                            onClick={() => {
                              const nextOptions = [...(question.options ?? [])];
                              [nextOptions[optionIndex], nextOptions[optionIndex + 1]] = [nextOptions[optionIndex + 1], nextOptions[optionIndex]];
                              onQuestion(index, { options: nextOptions, correctAnswers: nextOptions });
                            }}
                          >
                            <ChevronDown aria-hidden />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="outline"
                            aria-label={`순서 ${optionIndex + 1} 삭제`}
                            disabled={(question.options?.length ?? 0) <= 3}
                            onClick={() => {
                              const nextOptions = (question.options ?? []).filter((_, itemIndex) => itemIndex !== optionIndex);
                              onQuestion(index, { options: nextOptions, correctAnswers: nextOptions });
                            }}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      disabled={(question.options?.length ?? 0) >= 6}
                      onClick={() => {
                        const nextOptions = [...(question.options ?? []), ""];
                        onQuestion(index, { options: nextOptions, correctAnswers: nextOptions });
                      }}
                    >
                      <Plus aria-hidden />
                      순서 추가
                    </Button>
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
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
                )}
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
            </div> : null}
          </article>
        );})}
              </div>
            </section>
          );
        })}
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
    category: "tiebreaker",
    isTiebreaker: true,
  }));
  const [tiebreakNotice, setTiebreakNotice] = useState("");
  const [uploadingTiebreakImages, setUploadingTiebreakImages] = useState(false);
  const [launchCategory, setLaunchCategory] = useState<QuestionCategory>("regular");
  const [launchMode, setLaunchMode] = useState<"random" | "sequential">("random");
  const [selectedQuestionId, setSelectedQuestionId] = useState("");
  const initializedModeRoom = useRef("");
  const question = state?.currentQuestion ?? null;
  const answers = state?.answers ?? [];
  const participants = state?.participants ?? [];
  const ranking = state?.ranking ?? participants;
  const submittedIds = new Set(answers.map((answer) => answer.participantId));
  const tiebreakError = validateRuntimeQuestion(tiebreakQuestion);
  const extendedState = state as ExtendedRoomState | null;
  useEffect(() => {
    if (code && extendedState?.room && initializedModeRoom.current !== code) {
      initializedModeRoom.current = code;
      setLaunchMode(extendedState.room.playMode ?? "random");
    }
  }, [code, extendedState?.room]);
  const activeCount = extendedState?.room?.activeCount ?? aliveCount(participants);
  const eliminatedCount = participants.filter((participant) => participant.eliminated).length;
  const availablePools = extendedState?.availableQuestions;
  const availableQuestions = useMemo(
    () => availablePools
      ? (availablePools[launchCategory] ?? [])
      : (state?.quiz?.questions?.filter((item) => questionCategory(item) === launchCategory) ?? []),
    [availablePools, launchCategory, state?.quiz?.questions],
  );
  const availableQuestionKey = availableQuestions.map((item) => item.id ?? item.prompt).join("|");
  const selectedQuestion = availableQuestions.find((item) => (item.id ?? item.prompt) === selectedQuestionId) ?? null;
  const autoPreviewQuestionId = useMemo(() => {
    if (selectedQuestion || availableQuestions.length === 0) return "";
    const ids = availableQuestions.map((item) => item.id ?? item.prompt);
    if (launchMode === "sequential") return ids[0] ?? "";
    const seed = `${state?.code ?? code}:${state?.phase ?? "unknown"}:${launchCategory}:${availableQuestionKey}`;
    return ids[stableIndex(seed, ids.length)] ?? "";
  }, [availableQuestionKey, availableQuestions, code, launchCategory, launchMode, selectedQuestion, state?.code, state?.phase]);
  const autoPreviewQuestion = availableQuestions.find((item) => (item.id ?? item.prompt) === autoPreviewQuestionId) ?? null;
  const previewQuestion = selectedQuestion ?? autoPreviewQuestion ?? availableQuestions[0] ?? null;
  const previewQuestionId = previewQuestion?.id ?? "";
  const canPickNext = state?.phase === "lobby" || state?.phase === "revealed";
  const lobbyCategoryBlocked = state?.phase === "lobby" && launchCategory !== "regular";
  const regularBlocked = state?.phase === "revealed" && activeCount === 0;
  const revivalBlocked = state?.phase !== "revealed" || eliminatedCount === 0;
  const tiebreakerBlocked = state?.phase !== "revealed" || activeCount === 1 ||
    (activeCount === 0 && !extendedState?.room?.needsTiebreaker);
  const finishAvailable = state?.phase === "revealed" && activeCount <= 1;
  const launchBlocked =
    !code ||
    busy ||
    !canPickNext ||
    lobbyCategoryBlocked ||
    (launchCategory === "regular" && regularBlocked) ||
    (launchCategory === "revival" && revivalBlocked) ||
    (launchCategory === "tiebreaker" && tiebreakerBlocked) ||
    !previewQuestion;

  function updateTiebreakQuestion(patch: Partial<QuizQuestion>) {
    setTiebreakQuestion((current) => ({ ...current, ...patch, isTiebreaker: true }));
  }

  function changeTiebreakKind(kind: QuizQuestion["kind"]) {
    setTiebreakQuestion((current) => ({
      ...createBlankQuestion(kind),
      prompt: current.prompt,
      explanation: current.explanation,
      category: "tiebreaker",
      isTiebreaker: true,
    }));
  }

  function launchLabel() {
    if (state?.phase === "lobby") return "선택한 문제로 시작";
    if (launchCategory === "revival") return "패자부활전 열기";
    if (launchCategory === "tiebreaker") return "동점자 문제 시작";
    return "다음 일반 문제 시작";
  }

  function launchQuestion() {
    if (state?.phase === "lobby") {
      return quizApi.startRoom(code, {
        category: launchCategory,
        playMode: launchMode,
        questionId: previewQuestionId,
      });
    }

    if (launchCategory === "revival") {
      return quizApi.startRevival(code, {
        playMode: launchMode,
        questionId: previewQuestionId,
      });
    }

    return quizApi.nextQuestion(code, {
      category: launchCategory,
      playMode: launchMode,
      questionId: previewQuestionId,
    });
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

        {canPickNext ? (
          <div id="question-launch-panel" className="mt-5 scroll-mt-28 rounded-md border border-zinc-200 bg-[#fff9e8] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-black">다음 출제 선택</h3>
                <p className="mt-1 text-sm text-zinc-600">무작위가 기본이며, 특정 미사용 문제를 고르면 진행자만 먼저 확인합니다.</p>
              </div>
              {finishAvailable ? (
                <Button
                  variant="outline"
                  disabled={!code || busy}
                  onClick={() => {
                    if (extendedState?.room?.needsTiebreaker) {
                      setLaunchCategory("tiebreaker");
                      setSelectedQuestionId("");
                      document.getElementById("question-launch-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    } else {
                      void onAction(() => quizApi.finishRoom(code), "게임을 마무리했습니다.");
                    }
                  }}
                >
                  {extendedState?.room?.needsTiebreaker ? "동점자 문제 선택" : "우승 확정/마무리"}
                </Button>
              ) : null}
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(220px,320px)]">
              <div>
                <div className="flex flex-wrap gap-2">
                  {questionCategories.map((category) => {
                    const disabled =
                      (state?.phase === "lobby" && category.value !== "regular") ||
                      (category.value === "regular" && regularBlocked) ||
                      (category.value === "revival" && revivalBlocked) ||
                      (category.value === "tiebreaker" && tiebreakerBlocked);
                    return (
                      <Button
                        key={category.value}
                        type="button"
                        size="sm"
                        variant={launchCategory === category.value ? "default" : "outline"}
                        disabled={disabled}
                        onClick={() => {
                          setLaunchCategory(category.value);
                          setSelectedQuestionId("");
                        }}
                        className={launchCategory === category.value ? "bg-zinc-950 text-white" : "bg-white"}
                      >
                        {category.label}
                      </Button>
                    );
                  })}
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-bold">
                    출제 방식
                    <select
                      value={launchMode}
                      onChange={(event) => {
                        setLaunchMode(event.target.value as "random" | "sequential");
                        setSelectedQuestionId("");
                      }}
                      className="mt-2 h-10 w-full rounded-md border border-zinc-300 bg-white px-3"
                    >
                      <option value="random">무작위</option>
                      <option value="sequential">순차</option>
                    </select>
                  </label>

                  <label className="block text-sm font-bold">
                    특정 문제 선택
                    <select
                      value={selectedQuestionId}
                      onChange={(event) => setSelectedQuestionId(event.target.value)}
                      className="mt-2 h-10 w-full rounded-md border border-zinc-300 bg-white px-3"
                    >
                      <option value="">자동 선택</option>
                      {availableQuestions.map((item, index) => (
                        <option key={item.id ?? `${launchCategory}-${index}`} value={item.id ?? item.prompt}>
                          {index + 1}. {item.prompt.trim() || "내용 없음"}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <Button
                  className="mt-3 bg-zinc-950 font-black text-white"
                  disabled={launchBlocked}
                  onClick={() => void onAction(launchQuestion, `${launchLabel()} 완료`)}
                >
                  {launchLabel()}
                </Button>
                {launchCategory === "regular" && regularBlocked ? (
                  <p className="mt-2 text-sm font-bold text-[#b42318]">생존자가 0명이면 일반 문제를 더 낼 수 없습니다.</p>
                ) : null}
                {launchCategory === "revival" && revivalBlocked ? (
                  <p className="mt-2 text-sm font-bold text-[#8a6100]">패자부활전은 정답 공개 후 탈락자가 있을 때 열 수 있습니다.</p>
                ) : null}
              </div>

              <div className="rounded-md border border-zinc-200 bg-white p-3">
                <p className="text-xs font-black text-zinc-500">진행자 미리보기</p>
                {previewQuestion ? (
                  <div className="mt-2">
                    <p className="text-sm font-black">{selectedQuestion ? "직접 선택" : launchMode === "random" ? "무작위 후보" : "순차 후보"} · {questionKindLabel(previewQuestion.kind)} · {categoryLabel(questionCategory(previewQuestion))}</p>
                    <p className="mt-2 text-lg font-black leading-snug">{previewQuestion.prompt || "내용 없음"}</p>
                    {previewQuestion.options?.length ? (
                      <div className="mt-2 space-y-1">
                        {previewQuestion.options.map((option, index) => (
                          <p key={`${option}-${index}`} className="rounded-md bg-[#f7f2e8] px-2 py-1 text-sm font-bold">{index + 1}. {option || "빈 보기"}</p>
                        ))}
                      </div>
                    ) : null}
                    {previewQuestion.images?.length ? (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {previewQuestion.images.slice(0, 4).map((image) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={image} src={image} alt="문제 미리보기" className="aspect-video w-full rounded-md object-cover" />
                        ))}
                      </div>
                    ) : null}
                    <p className="mt-3 text-sm font-bold">정답: {previewQuestion.correctAnswers.join(previewQuestion.kind === "order" ? " → " : ", ")}</p>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-zinc-500">특정 문제를 고르면 이곳에서 먼저 확인합니다.</p>
                )}
              </div>
            </div>
          </div>
        ) : null}

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
          {(["ox", "multiple", "short", "order"] as const).map((kind) => (
            <Button
              key={kind}
              type="button"
              size="sm"
              variant={tiebreakQuestion.kind === kind ? "default" : "outline"}
              onClick={() => changeTiebreakKind(kind)}
              className={tiebreakQuestion.kind === kind ? "bg-zinc-950 text-white" : ""}
            >
              {questionKindLabel(kind)}
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

        {tiebreakQuestion.kind === "order" ? (
          <div className="mt-3 space-y-2">
            <p className="text-sm font-bold text-zinc-600">정답 순서대로 3~6개를 입력하세요.</p>
            {(tiebreakQuestion.options ?? []).map((option, optionIndex) => (
              <div key={optionIndex} className="flex items-center gap-2 rounded-md bg-[#f7f2e8] p-2">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#ffcf4a] text-sm font-black">{optionIndex + 1}</span>
                <input
                  value={option}
                  onChange={(event) => {
                    const nextOptions = [...(tiebreakQuestion.options ?? [])];
                    nextOptions[optionIndex] = event.target.value;
                    updateTiebreakQuestion({ options: nextOptions, correctAnswers: nextOptions });
                  }}
                  placeholder={`순서 ${optionIndex + 1}`}
                  className="h-10 min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3"
                />
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label={`순서 ${optionIndex + 1} 위로 이동`}
                  disabled={optionIndex === 0}
                  onClick={() => {
                    const nextOptions = [...(tiebreakQuestion.options ?? [])];
                    [nextOptions[optionIndex - 1], nextOptions[optionIndex]] = [nextOptions[optionIndex], nextOptions[optionIndex - 1]];
                    updateTiebreakQuestion({ options: nextOptions, correctAnswers: nextOptions });
                  }}
                >
                  <ChevronUp aria-hidden />
                </Button>
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label={`순서 ${optionIndex + 1} 아래로 이동`}
                  disabled={optionIndex === (tiebreakQuestion.options?.length ?? 0) - 1}
                  onClick={() => {
                    const nextOptions = [...(tiebreakQuestion.options ?? [])];
                    [nextOptions[optionIndex], nextOptions[optionIndex + 1]] = [nextOptions[optionIndex + 1], nextOptions[optionIndex]];
                    updateTiebreakQuestion({ options: nextOptions, correctAnswers: nextOptions });
                  }}
                >
                  <ChevronDown aria-hidden />
                </Button>
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label={`순서 ${optionIndex + 1} 삭제`}
                  disabled={(tiebreakQuestion.options?.length ?? 0) <= 3}
                  onClick={() => {
                    const nextOptions = (tiebreakQuestion.options ?? []).filter((_, itemIndex) => itemIndex !== optionIndex);
                    updateTiebreakQuestion({ options: nextOptions, correctAnswers: nextOptions });
                  }}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={(tiebreakQuestion.options?.length ?? 0) >= 6}
              onClick={() => {
                const nextOptions = [...(tiebreakQuestion.options ?? []), ""];
                updateTiebreakQuestion({ options: nextOptions, correctAnswers: nextOptions });
              }}
            >
              <Plus aria-hidden />
              순서 추가
            </Button>
          </div>
        ) : tiebreakQuestion.kind !== "short" ? (
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
          disabled={!code || busy || uploadingTiebreakImages || Boolean(tiebreakError) || tiebreakerBlocked}
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
    questions: quiz.questions.map((question) => {
      const category = questionCategory(question);
      const options = question.kind === "short" ? undefined : question.options?.map((option) => option.trim()).filter(Boolean);

      return {
        ...question,
        prompt: question.prompt.trim(),
        options,
        correctAnswers: question.kind === "order" ? (options ?? []) : question.correctAnswers.map((answer) => answer.trim()).filter(Boolean),
        explanation: question.explanation?.trim() || undefined,
        images: (question.images ?? []).slice(0, 4),
        category,
        isTiebreaker: category === "tiebreaker",
      };
    }),
  };
}
