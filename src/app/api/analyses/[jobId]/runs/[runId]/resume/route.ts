import { getCurrentUser } from "@/features/auth/server/current-user";
import { assertTrustedMutation } from "@/features/auth/server/http";
import { resumeAgentRun } from "@/features/analysis/server/resume-agent-run";
import { getContainer } from "@/server/container";

type RouteContext = {
  params: Promise<{ jobId: string; runId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const rejected = assertTrustedMutation(request);
  if (rejected) return rejected;

  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });

  const { jobId, runId } = await context.params;
  const container = getContainer();
  const result = await resumeAgentRun(
    { userId: user.id, workspaceId: jobId, agentRunId: runId },
    container.analysisRepository,
    container.analysisDispatcher,
  );
  if (result.ok) return Response.json(result.snapshot);
  switch (result.code) {
    case "NOT_FOUND":
      return Response.json({ error: "分析不存在" }, { status: 404 });
    case "RUN_NOT_RESUMABLE":
      return Response.json({ error: "当前运行不能继续" }, { status: 409 });
    case "DISPATCH_FAILED":
      return Response.json({ error: "继续任务暂时无法启动" }, { status: 503 });
  }
}
