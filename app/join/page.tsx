import { Suspense } from "react";
import { PlayerApp } from "@/components/quiz/player-app";

export default function JoinPage() {
  return (
    <Suspense fallback={null}>
      <PlayerApp />
    </Suspense>
  );
}
