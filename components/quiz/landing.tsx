"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, Laptop, QrCode, Smartphone, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BRAND_NAME } from "@/lib/client/brand";

export function Landing() {
  const [code, setCode] = useState("");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();

    if (normalized) {
      window.location.assign(`/join?code=${encodeURIComponent(normalized)}`);
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f2e8] text-[#18181b]">
      <section className="mx-auto grid min-h-screen w-full max-w-7xl gap-10 px-5 py-6 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:px-10">
        <div className="flex flex-col justify-between gap-10">
          <header className="flex items-center justify-between gap-4">
            <a href="/" className="flex items-center gap-3 font-black">
              <span className="grid h-11 w-11 place-items-center rounded-md bg-[#18181b] text-lg text-white">
                벨
              </span>
              <span className="text-xl">{BRAND_NAME}</span>
            </a>
            <Button asChild variant="outline" className="border-[#18181b]/20 bg-white/80">
              <a href="/host">진행자 입장</a>
            </Button>
          </header>

          <div className="max-w-3xl py-8 lg:py-16">
            <p className="mb-5 inline-flex items-center rounded-md bg-[#ffcf4a] px-3 py-1 text-sm font-bold">
              오프라인 행사용 실시간 퀴즈
            </p>
            <h1 className="text-5xl font-black leading-[1.02] tracking-normal sm:text-7xl lg:text-8xl">
              모두의 휴대폰이
              <br />
              답안지가 됩니다
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-700">
              진행자는 노트북을 화면에 띄우고, 참석자는 QR 또는 링크로 입장합니다.
              O/X, 객관식, 주관식 문제를 풀며 마지막 1등을 가리는 골든벨 방식입니다.
            </p>

            <form
              onSubmit={onSubmit}
              className="mt-9 flex max-w-xl flex-col gap-3 rounded-md border-2 border-[#18181b] bg-white p-3 shadow-[8px_8px_0_#18181b] sm:flex-row"
            >
              <label className="sr-only" htmlFor="room-code">
                참가 코드
              </label>
              <input
                id="room-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="참가 코드 입력"
                autoComplete="off"
                className="min-h-12 flex-1 rounded-md border border-zinc-200 px-4 text-xl font-black uppercase outline-none focus:border-[#18181b] focus:ring-4 focus:ring-[#ffcf4a]/50"
              />
              <Button className="min-h-12 bg-[#18181b] px-5 text-base font-bold text-white hover:bg-black">
                입장하기
                <ArrowRight aria-hidden className="size-4" />
              </Button>
            </form>
          </div>

          <div className="grid gap-3 pb-4 sm:grid-cols-3">
            {[
              ["진행자 링크", "문제 세트 작성, 방 생성, 마감과 공개를 조작합니다.", Laptop],
              ["참석자 링크", "휴대폰에서 닉네임으로 입장하고 답을 바꿀 수 있습니다.", Smartphone],
              ["최종 1등", "오답자는 탈락하고 동점은 타이브레이커로 정리합니다.", Trophy],
            ].map(([title, body, Icon]) => (
              <article key={String(title)} className="rounded-md border border-[#18181b]/15 bg-white/80 p-4">
                <Icon aria-hidden className="mb-4 size-6 text-[#d08b00]" />
                <h2 className="font-black">{title as string}</h2>
                <p className="mt-2 text-sm leading-6 text-zinc-600">{body as string}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="relative hidden min-h-[680px] items-center lg:flex">
          <div className="absolute right-0 top-16 h-[82%] w-[84%] rounded-md bg-[#18181b]" />
          <div className="relative ml-auto w-[90%] rounded-md border-2 border-[#18181b] bg-white p-6 shadow-[14px_14px_0_#ffcf4a]">
            <div className="flex items-center justify-between border-b-2 border-[#18181b] pb-5">
              <div>
                <p className="text-sm font-bold text-zinc-500">LIVE ROOM</p>
                <p className="text-4xl font-black">A7K9</p>
              </div>
              <div className="grid h-24 w-24 place-items-center rounded-md border-2 border-[#18181b] bg-[#f7f2e8]">
                <QrCode aria-hidden className="size-16" />
              </div>
            </div>
            <div className="py-8">
              <p className="text-sm font-bold text-zinc-500">문제 4 / 12</p>
              <h2 className="mt-2 text-4xl font-black leading-tight">
                조선 시대 과거 시험에서 최종 합격자를 부르는 말은?
              </h2>
              <div className="mt-8 grid grid-cols-2 gap-4">
                {["장원", "생원", "진사", "급제"].map((answer, index) => (
                  <div
                    key={answer}
                    className="rounded-md border-2 border-[#18181b] p-5 text-xl font-black"
                  >
                    <span className="mr-3 text-[#d08b00]">{index + 1}</span>
                    {answer}
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 border-t-2 border-[#18181b] pt-5">
              {["참가 38명", "제출 31명", "생존 12명"].map((item) => (
                <div key={item} className="rounded-md bg-[#f7f2e8] p-4 text-center font-black">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
