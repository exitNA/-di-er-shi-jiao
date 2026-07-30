import { getCurrentUser } from "@/features/auth/server/current-user";
import { getContainer } from "@/server/container";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });

  const { jobId } = await context.params;
  const snapshot = await getContainer().analysisRepository.getOwnedSnapshot(user.id, jobId);
  if (!snapshot) return Response.json({ error: "分析不存在" }, { status: 404 });

  return Response.json(snapshot);
}
