import { notFound, redirect } from "next/navigation";

import { AnalysisWorkspace } from "@/features/analysis/components/analysis-workspace";
import { getCurrentUser } from "@/features/auth/server/current-user";
import { getContainer } from "@/server/container";

export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { jobId } = await params;
  const snapshot =
    await getContainer().analysisRepository.getOwnedSnapshot(user.id, jobId);
  if (!snapshot) notFound();

  return <AnalysisWorkspace initialSnapshot={snapshot} />;
}
