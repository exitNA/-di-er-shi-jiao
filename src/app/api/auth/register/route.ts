import { registrationSchema } from "@/features/auth/domain/credentials";
import {
  assertTrustedMutation,
  getClientIp,
  setSessionCookie,
} from "@/features/auth/server/http";
import { getContainer } from "@/server/container";

export async function POST(request: Request) {
  const rejected = assertTrustedMutation(request);
  if (rejected) return rejected;

  const input = registrationSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "请检查用户名和密码" }, { status: 400 });

  const result = await getContainer().authService.register({
    ...input.data,
    ip: getClientIp(request),
  });
  if (!result.ok) {
    const rateLimited = result.code === "RATE_LIMITED";
    return Response.json(
      { error: rateLimited ? "尝试次数过多，请稍后再试" : "该用户名不可用" },
      { status: rateLimited ? 429 : 409 },
    );
  }

  await setSessionCookie(result.sessionToken);
  return Response.json({ user: result.user }, { status: 201 });
}
