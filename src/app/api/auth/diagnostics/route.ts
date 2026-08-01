import { getLogger } from "@logtape/logtape";
import { z } from "zod";

import { assertTrustedMutation } from "@/features/auth/server/http";

const eventSchema = z.object({
  event: z.enum(["login_clicked", "dialog_opened", "dialog_closed", "mode_changed"]),
});
const logger = getLogger(["second-perspective", "auth"]);

export async function POST(request: Request) {
  const trustFailure = assertTrustedMutation(request);
  if (trustFailure) return trustFailure;

  const parsed = eventSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "请求无效" }, { status: 400 });

  logger.info("Auth dialog diagnostic", parsed.data);
  return new Response(null, { status: 204 });
}
