import { HostConsole } from "@/components/quiz/host-console";

export default async function HostResultPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <HostConsole view="results" roomCode={code} />;
}
