import { getCurrentUser } from "@/features/auth/server/current-user";
import { assertTrustedMutation } from "@/features/auth/server/http";
import { retryAnalysisModule } from "@/features/analysis/server/retry-analysis-module";
import { getContainer } from "@/server/container";

type RouteContext = {
  params: Promise<{ jobId: string; moduleType: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const rejected = assertTrustedMutation(request);
  if (rejected) return rejected;

  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });

  const { jobId, moduleType } = await context.params;
  const container = getContainer();
  const result = await retryAnalysisModule(
    { userId: user.id, jobId, moduleType },
    container.analysisRepository,
    container.analysisDispatcher,
  );

  if (result.ok) {
    return Response.json(
      { jobId: result.jobId, moduleType: result.moduleType },
      { status: 202 },
    );
  }

  switch (result.code) {
    case "NOT_FOUND":
      return Response.json({ error: "分析不存在" }, { status: 404 });
    case "MODULE_NOT_RETRYABLE":
      return Response.json({ error: "该模块不支持单独重试" }, { status: 400 });
    case "MODULE_NOT_FAILED":
    case "JOB_NOT_RETRYABLE":
      return Response.json({ error: "当前状态不能重试" }, { status: 409 });
    case "DISPATCH_FAILED":
      return Response.json({ error: "重试任务暂时无法启动" }, { status: 503 });
  }
}
