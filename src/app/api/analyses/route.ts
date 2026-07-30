import { getCurrentUser } from "@/features/auth/server/current-user";
import { getContainer } from "@/server/container";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });

  const body: unknown = await request.json().catch(() => null);
  if (!isSubmission(body)) return Response.json({ error: "请求无效" }, { status: 400 });

  const result = await getContainer().submitAnalysis({ ...body, userId: user.id });
  if (!result.ok) return Response.json(result, { status: 400 });

  return Response.json(result, { status: result.created ? 202 : 200 });
}

function isSubmission(value: unknown): value is { content: string; idempotencyKey: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "content" in value &&
    "idempotencyKey" in value &&
    typeof value.content === "string" &&
    typeof value.idempotencyKey === "string" &&
    value.idempotencyKey.length > 0 &&
    value.idempotencyKey.length <= 200
  );
}
