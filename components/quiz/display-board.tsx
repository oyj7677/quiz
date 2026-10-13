"use client";

import { useEffect, useMemo, useState } from "react";
import { QrCode, Trophy, Users } from "lucide-react";
import { BRAND_NAME } from "@/lib/client/brand";
import { phaseLabel, questionNumberLabel, quizApi, RoomState } from "@/lib/client/quiz-api";

function aliveCount(state: RoomState | null) {
  return (state?.participants ?? []).filter((participant) => !participant.eliminated).length;
}

export function DisplayBoard({ code }: { code: string }) {
  const [state, setState] = useState<RoomState | null>(null);
  const [error, setError] = useState("");
  const [origin, setOrigin] = useState("");
  const normalizedCode = code.trim().toUpperCase();
  const phase = state?.phase ?? "lobby";
  const joinUrl = useMemo(() => {
    if (!origin) {
      return "";
    }

    return `${origin}/join?code=${normalizedCode}`;
  }, [normalizedCode, origin]);
  const qrUrl = joinUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(joinUrl)}`
    : "";

  useEffect(() => {
    const id = window.setTimeout(() => setOrigin(window.location.origin), 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    async function load(quiet = false) {
      try {
        const nextState = await quizApi.displayState(normalizedCode);
        setState(nextState);
        setError("");
      } catch (loadError) {
        if (!quiet) {
          setError(loadError instanceof Error ? loadError.message : "방 정보를 불러오지 못했습니다.");
        }
      }
    }

    void load();
    const id = window.setInterval(() => void load(true), 2000);

    return () => window.clearInterval(id);
  }, [normalizedCode]);

  return (
    <main className="min-h-screen overflow-hidden bg-[#f7f2e8] text-zinc-950">
      <header className="border-b-2 border-zinc-950 bg-white px-8 py-5">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6">
          <a href="/" className="flex items-center gap-4 text-3xl font-black">
            <span className="grid h-14 w-14 place-items-center rounded-md bg-zinc-950 text-xl text-white">
              벨
            </span>
            {BRAND_NAME}
          </a>
          <div className="rounded-md bg-zinc-950 px-6 py-3 text-right text-white">
            <p className="text-sm font-bold text-zinc-300">참가 코드</p>
            <p className="text-5xl font-black tracking-normal">{normalizedCode}</p>
          </div>
        </div>
      </header>

      <section className="mx-auto grid min-h-[calc(100vh-106px)] max-w-7xl gap-8 px-8 py-8">
        {error ? (
          <div className="grid place-items-center rounded-md border-2 border-zinc-950 bg-white p-10 text-center shadow-[10px_10px_0_#18181b]">
            <h1 className="text-5xl font-black">방을 확인해 주세요</h1>
            <p className="mt-4 text-xl text-zinc-600">{error}</p>
          </div>
        ) : phase === "lobby" ? (
          <LobbyScreen state={state} qrUrl={qrUrl} joinUrl={joinUrl} code={normalizedCode} />
        ) : phase === "finished" ? (
          <FinalScreen state={state} />
        ) : (
          <QuestionScreen state={state} />
        )}
      </section>
    </main>
  );
}

function LobbyScreen({
  state,
  qrUrl,
  joinUrl,
  code,
}: {
  state: RoomState | null;
  qrUrl: string;
  joinUrl: string;
  code: string;
}) {
  const participants = state?.participants ?? [];

  return (
    <div className="grid gap-8 lg:grid-cols-[420px_minmax(0,1fr)]">
      <div className="rounded-md border-2 border-zinc-950 bg-white p-8 shadow-[10px_10px_0_#ffcf4a]">
        <h1 className="text-5xl font-black">입장 대기</h1>
        <p className="mt-4 text-xl leading-8 text-zinc-700">
          휴대폰 카메라로 QR을 찍거나 참가 코드를 입력하세요.
        </p>
        <div className="mt-8 grid place-items-center rounded-md bg-[#f7f2e8] p-7">
          {qrUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrUrl} alt="참가 링크 QR 코드" className="h-64 w-64 rounded-md bg-white" />
          ) : (
            <QrCode aria-hidden className="size-48" />
          )}
        </div>
        <p className="mt-6 break-all rounded-md bg-zinc-950 p-4 text-center text-xl font-black text-white">
          {joinUrl || code}
        </p>
      </div>

      <div className="rounded-md border-2 border-zinc-950 bg-white p-8">
        <div className="flex items-center justify-between">
          <h2 className="text-4xl font-black">참가자</h2>
          <div className="flex items-center gap-3 rounded-md bg-[#f7f2e8] px-5 py-3 text-2xl font-black">
            <Users aria-hidden />
            {participants.length}명
          </div>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-3 xl:grid-cols-3">
          {participants.map((participant) => (
            <div key={participant.id} className="rounded-md bg-[#f7f2e8] p-4 text-2xl font-black">
              {participant.nickname}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function QuestionScreen({ state }: { state: RoomState | null }) {
  const question = state?.currentQuestion ?? null;
  const phase = state?.phase ?? "question";
  const showAnswer = phase === "revealed";
  const participants = state?.participants ?? [];
  const submitted =
    state?.room?.submittedCount ??
    new Set((state?.answers ?? []).map((answer) => answer.participantId)).size;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="rounded-md border-2 border-zinc-950 bg-white p-8 shadow-[10px_10px_0_#18181b]">
        <p className="text-xl font-black text-[#b27600]">
          문제 {questionNumberLabel(state?.currentQuestionIndex)}
          {question?.isTiebreaker ? " · 타이브레이커" : ""}
        </p>
        <h1 className="mt-4 text-6xl font-black leading-tight">
          {question?.prompt ?? "문제를 준비하고 있습니다."}
        </h1>

        {question?.images?.length ? (
          <div className="mt-8 grid grid-cols-2 gap-4">
            {question.images.slice(0, 4).map((image) => (
              <div key={image} className="aspect-video overflow-hidden rounded-md bg-[#f7f2e8]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt="" className="h-full w-full object-cover" />
              </div>
            ))}
          </div>
        ) : null}

        {question?.options?.length ? (
          <div className="mt-8 grid grid-cols-2 gap-4">
            {question.options.map((option, index) => (
              <div key={option} className="rounded-md border-2 border-zinc-950 p-6 text-3xl font-black">
                <span className="mr-4 text-[#b27600]">{index + 1}</span>
                {option}
              </div>
            ))}
          </div>
        ) : null}

        {showAnswer && question ? (
          <div className="mt-8 rounded-md bg-[#ffcf4a] p-6">
            <p className="text-lg font-black">정답</p>
            <p className="mt-1 text-5xl font-black">{question.correctAnswers.join(", ")}</p>
            {question.explanation ? <p className="mt-4 text-xl leading-8">{question.explanation}</p> : null}
          </div>
        ) : null}
      </section>

      <aside className="grid gap-4">
        <BigMetric label="단계" value={phaseLabel(phase)} />
        <BigMetric label="제출" value={`${submitted} / ${participants.length}`} />
        <BigMetric label="생존" value={`${aliveCount(state)}명`} />
      </aside>
    </div>
  );
}

function FinalScreen({ state }: { state: RoomState | null }) {
  const ranking = state?.ranking ?? [];
  const winner = state?.winner ?? ranking[0];

  return (
    <section className="rounded-md border-2 border-zinc-950 bg-white p-10 shadow-[10px_10px_0_#ffcf4a]">
      <div className="text-center">
        <Trophy aria-hidden className="mx-auto size-20 text-[#b27600]" />
        <h1 className="mt-5 text-7xl font-black">최종 1등</h1>
        <p className="mt-4 text-6xl font-black">{winner?.nickname ?? "집계 중"}</p>
      </div>
      <div className="mx-auto mt-10 max-w-3xl space-y-3">
        {ranking.slice(0, 10).map((row, index) => (
          <div key={row.id} className="flex items-center justify-between rounded-md bg-[#f7f2e8] p-5 text-3xl font-black">
            <span>
              {row.rank ?? index + 1}위 {row.nickname}
            </span>
            <span>{row.correctCount ?? row.score ?? 0}점</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function BigMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border-2 border-zinc-950 bg-white p-6">
      <p className="text-lg font-black text-zinc-500">{label}</p>
      <p className="mt-2 text-4xl font-black">{value}</p>
    </div>
  );
}
