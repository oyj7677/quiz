import { DisplayBoard } from "@/components/quiz/display-board";

export default async function DisplayPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  return <DisplayBoard code={code} />;
}
