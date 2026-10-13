import { HostConsole } from "@/components/quiz/host-console";

export default async function HostRoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <HostConsole view="rooms" roomCode={code} />;
}
