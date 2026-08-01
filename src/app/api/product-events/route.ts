import { z } from "zod";

import { moduleTypes } from "@/features/analysis/domain/contracts";
import { getCurrentUser } from "@/features/auth/server/current-user";
import { assertTrustedMutation } from "@/features/auth/server/http";
import { getContainer } from "@/server/container";
import {
  ProductEventJobNotOwnedError,
  recordProductEvent,
} from "@/server/observability/product-events";

// Browser-owned events only; challenge and revision events are recorded by server use cases.
const browserEventSchema = z
  .object({
    eventName: z.literal("first_module_shown"),
    jobId: z.string().uuid(),
    moduleType: z.enum(moduleTypes),
  })
  .strict();

export async function POST(request: Request) {
  const trustFailure = assertTrustedMutation(request);
  if (trustFailure) return trustFailure;

  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });

  const parsed = browserEventSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json({ error: "请求无效" }, { status: 400 });
  }

  try {
    const recorded = await recordProductEvent(getContainer().db, {
      ...parsed.data,
      userId: user.id,
    });
    return Response.json({ recorded }, { status: recorded ? 201 : 200 });
  } catch (error) {
    if (error instanceof ProductEventJobNotOwnedError) {
      return Response.json({ error: "任务不存在" }, { status: 404 });
    }
    throw error;
  }
}
