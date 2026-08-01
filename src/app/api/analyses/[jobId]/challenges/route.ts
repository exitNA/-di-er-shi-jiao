import { z } from "zod";

import { reportItemTargetSchema } from "@/features/analysis/domain/contracts";
import { getCurrentUser } from "@/features/auth/server/current-user";
import { assertTrustedMutation } from "@/features/auth/server/http";
import { getContainer } from "@/server/container";

const requestSchema = z.object({
  jobId: z.string().uuid(),
  target: reportItemTargetSchema,
  content: z.string().trim().min(1).max(5_000),
  idempotencyKey: z.string().min(1).max(200),
}).strict();

type RouteContext = { params: Promise<{ jobId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const rejected = assertTrustedMutation(request);
  if (rejected) return rejected;

  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });

  const { jobId } = await context.params;
  const parsed = requestSchema.safeParse({
    jobId,
    ...await request.json().catch(() => null),
  });
  if (!parsed.success) {
    return Response.json({ error: "请求无效" }, { status: 400 });
  }

  const result = await getContainer().submitChallenge({
    ...parsed.data,
    userId: user.id,
  });
  if (!result.ok) {
    return Response.json({ error: "分析不存在" }, { status: 404 });
  }
  return Response.json(result, { status: result.created ? 201 : 200 });
}
