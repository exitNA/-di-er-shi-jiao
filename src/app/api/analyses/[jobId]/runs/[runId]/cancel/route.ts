import { getCurrentUser } from "@/features/auth/server/current-user";
import { assertTrustedMutation } from "@/features/auth/server/http";
import { cancelAgentRun } from "@/features/analysis/server/cancel-agent-run";
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
  const result = await cancelAgentRun(
    { userId: user.id, workspaceId: jobId, agentRunId: runId },
    container.analysisRepository,
    container.analysisDispatcher,
  );
  if (result.ok) return Response.json(result.snapshot);
  return result.code === "NOT_FOUND"
    ? Response.json({ error: "分析不存在" }, { status: 404 })
    : Response.json({ error: "当前运行不能终止" }, { status: 409 });
}
