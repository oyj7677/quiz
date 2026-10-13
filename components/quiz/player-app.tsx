"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Check, Loader2, Send, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  phaseLabel,
  questionNumberLabel,
  quizApi,
  QuizQuestion,
  RoomState,
} from "@/lib/client/quiz-api";
import { BRAND_NAME } from "@/lib/client/brand";

function normalizeCode(value: string) {
  return value.trim().toUpperCase();
}

function messageFrom(error: unknown) {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message;
  }

  return "요청을 처리하지 못했습니다.";
}

function tokenKey(code: string) {
  return `gb-player-${code}`;
}

function answerToText(answer: string | string[] | undefined) {
  if (Array.isArray(answer)) {
    return answer.join(", ");
  }

  return answer ?? "";
}

export function PlayerApp() {
  const searchParams = useSearchParams();
  const [code, setCode] = useState(normalizeCode(searchParams.get("code") ?? ""));
  const [nickname, setNickname] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<RoomState | null>(null);
  const [answer, setAnswer] = useState("");
  const [answerQuestionIndex, setAnswerQuestionIndex] = useState(-1);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const question = state?.currentQuestion ?? null;
  const currentQuestionIndex = state?.currentQuestionIndex ?? -1;
  const phase = state?.phase ?? "lobby";
  const me = state?.me ?? null;
  const isEliminated = Boolean(me?.eliminated);
  const isClosed = phase === "closed" || phase === "revealed" || phase === "finished";
  const displayedAnswer =
    answerQuestionIndex === currentQuestionIndex ? answer : answerToText(state?.myAnswer?.answer);
  const storedToken = useMemo(() => {
    if (!code || typeof window === "undefined") {
      return null;
    }

    return window.localStorage.getItem(tokenKey(code));
  }, [code]);

  useEffect(() => {
    if (storedToken && !token) {
      const id = window.setTimeout(() => setToken(storedToken), 0);
      return () => window.clearTimeout(id);
    }
  }, [storedToken, token]);

  const refreshState = useCallback(async (roomCode = code, playerToken = token, quiet = false) => {
    const normalized = normalizeCode(roomCode);

    if (!normalized || !playerToken) {
      return;
    }

    try {
      const nextState = await quizApi.roomState(normalized, playerToken);
      setState(nextState);
      setNotice("");
    } catch (error) {
      if (!quiet) {
        setNotice(messageFrom(error));
      }
    }
  }, [code, token]);

  useEffect(() => {
    const activeToken = token || storedToken;

    if (!code || !activeToken) {
      return;
    }

    const firstLoad = window.setTimeout(() => {
      void refreshState(code, activeToken);
    }, 0);
    const id = window.setInterval(() => {
      void refreshState(code, activeToken, true);
    }, 3000);

    return () => {
      window.clearTimeout(firstLoad);
      window.clearInterval(id);
    };
  }, [code, refreshState, storedToken, token]);

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeCode(code);

    if (!normalized || !nickname.trim()) {
      setNotice("참가 코드와 닉네임을 입력하세요.");
      return;
    }

    setBusy(true);
    setNotice("");

    try {
      const result = await quizApi.joinRoom(normalized, nickname.trim(), storedToken);
      window.localStorage.setItem(tokenKey(normalized), result.token);
      setCode(normalized);
      setToken(result.token);
      setNickname(result.nickname);
      await refreshState(normalized, result.token);
    } catch (error) {
      setNotice(messageFrom(error));
    } finally {
      setBusy(false);
    }
  }

  async function submitAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!code || !token || !displayedAnswer.trim()) {
      return;
    }

    setBusy(true);
    setNotice("");

    try {
      const nextState = await quizApi.submitAnswer(code, displayedAnswer.trim(), token);
      setState(nextState);
      setNotice(isClosed ? "제출 마감 이후에는 답을 바꿀 수 없습니다." : "답안을 제출했습니다.");
    } catch (error) {
      setNotice(messageFrom(error));
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <main className="min-h-screen bg-[#f7f2e8] px-5 py-6 text-zinc-950">
        <section className="mx-auto flex min-h-[calc(100vh-48px)] w-full max-w-md flex-col justify-center">
          <a href="/" className="mb-8 inline-flex items-center gap-2 text-sm font-black text-zinc-600">
            <ArrowLeft aria-hidden className="size-4" />
            {BRAND_NAME}
          </a>
          <form onSubmit={join} className="rounded-md border-2 border-zinc-950 bg-white p-6 shadow-[8px_8px_0_#18181b]">
            <h1 className="text-3xl font-black">참가하기</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              진행자가 화면에 띄운 참가 코드를 입력하고 닉네임으로 입장하세요.
            </p>
            <label className="mt-6 block text-sm font-bold" htmlFor="code">
              참가 코드
            </label>
            <input
              id="code"
              value={code}
              onChange={(event) => setCode(normalizeCode(event.target.value))}
              autoComplete="off"
              className="mt-2 h-14 w-full rounded-md border border-zinc-300 px-3 text-center text-3xl font-black uppercase outline-none focus:border-zinc-950 focus:ring-4 focus:ring-[#ffcf4a]/50"
            />
            <label className="mt-4 block text-sm font-bold" htmlFor="nickname">
              닉네임
            </label>
            <input
              id="nickname"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              maxLength={18}
              className="mt-2 h-12 w-full rounded-md border border-zinc-300 px-3 font-bold outline-none focus:border-zinc-950 focus:ring-4 focus:ring-[#ffcf4a]/50"
            />
            {notice ? <p className="mt-4 rounded-md bg-[#fff4d0] p-3 text-sm font-bold">{notice}</p> : null}
            <Button className="mt-6 h-12 w-full bg-zinc-950 font-black text-white hover:bg-black" disabled={busy}>
              {busy ? <Loader2 aria-hidden className="animate-spin" /> : <Send aria-hidden />}
              입장하기
            </Button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f2e8] text-zinc-950">
      <header className="sticky top-0 z-20 border-b-2 border-zinc-950 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-zinc-500">참가 코드</p>
            <p className="text-2xl font-black">{code}</p>
          </div>
          <div className="rounded-md bg-zinc-950 px-3 py-2 text-right text-white">
            <p className="text-xs font-bold text-zinc-300">내 닉네임</p>
            <p className="font-black">{me?.nickname || nickname || "참가자"}</p>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-3xl gap-4 px-4 py-5">
        <StatusPanel state={state} />
        {phase === "lobby" || !question ? (
          <WaitingPanel />
        ) : phase === "finished" ? (
          <ResultPanel state={state} />
        ) : isEliminated ? (
          <SpectatorPanel question={question} phase={phase} />
        ) : (
          <QuestionPanel
            question={question}
            answer={displayedAnswer}
            onAnswer={(value) => {
              setAnswerQuestionIndex(currentQuestionIndex);
              setAnswer(value);
            }}
            onSubmit={submitAnswer}
            disabled={busy || isClosed}
            phase={phase}
            lastAnswer={answerToText(state?.myAnswer?.answer)}
          />
        )}
        {notice ? <p className="rounded-md bg-white p-4 text-sm font-bold">{notice}</p> : null}
      </section>
    </main>
  );
}

function StatusPanel({ state }: { state: RoomState | null }) {
  const participant = state?.me ?? null;
  const survivorCount = (state?.participants ?? []).filter((item) => !item.eliminated).length;

  return (
    <section className="grid grid-cols-4 gap-2">
      <Metric label="단계" value={phaseLabel(state?.phase)} />
      <Metric label="문제" value={questionNumberLabel(state?.currentQuestionIndex)} />
      <Metric label="생존" value={`${survivorCount}명`} />
      <Metric label="상태" value={participant?.eliminated ? "탈락" : "생존"} />
    </section>
  );
}

function WaitingPanel() {
  return (
    <section className="rounded-md border-2 border-zinc-950 bg-white p-6 text-center shadow-[8px_8px_0_#18181b]">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-md bg-[#ffcf4a]">
        <Loader2 aria-hidden className="size-8 animate-spin" />
      </div>
      <h1 className="mt-5 text-3xl font-black">대기 중</h1>
      <p className="mt-2 text-zinc-600">진행자가 게임을 시작하면 문제가 표시됩니다.</p>
    </section>
  );
}

function SpectatorPanel({ question, phase }: { question: QuizQuestion; phase: string }) {
  const showAnswer = phase === "revealed";

  return (
    <section className="rounded-md border-2 border-zinc-950 bg-white p-5 text-center shadow-[8px_8px_0_#18181b]">
      <h1 className="text-3xl font-black">관전 중</h1>
      <p className="mt-2 text-zinc-600">탈락 이후에는 답을 제출할 수 없습니다.</p>
      <div className="mt-5 rounded-md bg-[#f7f2e8] p-4 text-left">
        <p className="text-sm font-bold text-zinc-500">현재 문제</p>
        <p className="mt-1 text-xl font-black">{question.prompt}</p>
        {showAnswer ? (
          <div className="mt-4 rounded-md bg-white p-3">
            <p className="text-sm font-bold text-zinc-500">정답</p>
            <p className="text-2xl font-black">{question.correctAnswers.join(", ")}</p>
            {question.explanation ? <p className="mt-2 text-sm leading-6">{question.explanation}</p> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function QuestionPanel({
  question,
  answer,
  onAnswer,
  onSubmit,
  disabled,
  phase,
  lastAnswer,
}: {
  question: QuizQuestion;
  answer: string;
  onAnswer: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  disabled: boolean;
  phase: string;
  lastAnswer: string;
}) {
  const closed = phase === "closed" || phase === "revealed";

  return (
    <form onSubmit={onSubmit} className="rounded-md border-2 border-zinc-950 bg-white p-5 shadow-[8px_8px_0_#ffcf4a]">
      <p className="text-sm font-bold text-zinc-500">
        {question.kind === "ox" ? "O/X" : question.kind === "multiple" ? "객관식" : "주관식"}
        {question.isTiebreaker ? " · 타이브레이커" : ""}
      </p>
      <h1 className="mt-2 text-3xl font-black leading-tight">{question.prompt}</h1>

      {question.images?.length ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {question.images.slice(0, 4).map((image) => (
            <div key={image} className="aspect-video overflow-hidden rounded-md border bg-[#f7f2e8]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt="" className="h-full w-full object-cover" />
            </div>
          ))}
        </div>
      ) : null}

      {question.kind === "short" ? (
        <textarea
          value={answer}
          onChange={(event) => onAnswer(event.target.value)}
          disabled={disabled}
          placeholder="답을 입력하세요"
          rows={4}
          className="mt-5 w-full rounded-md border-2 border-zinc-950 px-4 py-3 text-xl font-bold outline-none focus:ring-4 focus:ring-[#ffcf4a]/50 disabled:bg-zinc-100"
        />
      ) : (
        <div className="mt-5 grid gap-3">
          {(question.options ?? []).map((option) => (
            <button
              key={option}
              type="button"
              disabled={disabled}
              onClick={() => onAnswer(option)}
              className={`min-h-16 rounded-md border-2 px-4 text-left text-xl font-black transition ${
                answer === option
                  ? "border-zinc-950 bg-[#ffcf4a] shadow-[4px_4px_0_#18181b]"
                  : "border-zinc-200 bg-[#f7f2e8]"
              } disabled:opacity-70`}
            >
              {option}
            </button>
          ))}
        </div>
      )}

      {lastAnswer ? (
        <p className="mt-4 rounded-md bg-[#f7f2e8] p-3 text-sm font-bold">
          마지막 제출 답안: {lastAnswer}
        </p>
      ) : null}

      {phase === "revealed" ? (
        <div className="mt-4 rounded-md bg-zinc-950 p-4 text-white">
          <p className="text-sm font-bold text-zinc-300">정답</p>
          <p className="text-2xl font-black">{question.correctAnswers.join(", ")}</p>
          {question.explanation ? <p className="mt-3 text-sm leading-6 text-zinc-200">{question.explanation}</p> : null}
        </div>
      ) : null}

      <Button
        className="mt-5 h-14 w-full bg-zinc-950 text-lg font-black text-white hover:bg-black"
        disabled={disabled || !answer.trim()}
      >
        {closed ? <Check aria-hidden /> : <Send aria-hidden />}
        {closed ? "제출 마감" : "답안 제출"}
      </Button>
      {!closed ? (
        <p className="mt-3 text-center text-sm font-bold text-zinc-500">
          마감 전까지 다시 제출하면 답을 바꿀 수 있습니다.
        </p>
      ) : null}
    </form>
  );
}

function ResultPanel({ state }: { state: RoomState | null }) {
  const ranking = state?.ranking ?? [];
  const winner = state?.winner ?? ranking[0];

  return (
    <section className="rounded-md border-2 border-zinc-950 bg-white p-6 shadow-[8px_8px_0_#ffcf4a]">
      <div className="grid place-items-center text-center">
        <Trophy aria-hidden className="size-14 text-[#d08b00]" />
        <h1 className="mt-3 text-3xl font-black">최종 결과</h1>
        <p className="mt-2 text-zinc-600">
          {winner ? `1등은 ${winner.nickname}님입니다.` : "진행자가 결과를 정리하고 있습니다."}
        </p>
      </div>
      <div className="mt-5 space-y-2">
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
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-white p-3 text-center">
      <p className="text-xs font-bold text-zinc-500">{label}</p>
      <p className="mt-1 truncate text-lg font-black">{value}</p>
    </div>
  );
}
