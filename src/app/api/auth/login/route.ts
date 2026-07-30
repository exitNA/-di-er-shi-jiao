import { loginSchema } from "@/features/auth/domain/credentials";
import {
  assertTrustedMutation,
  getClientIp,
  setSessionCookie,
} from "@/features/auth/server/http";
import { getContainer } from "@/server/container";

export async function POST(request: Request) {
  const rejected = assertTrustedMutation(request);
  if (rejected) return rejected;

  const input = loginSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "用户名或密码不正确" }, { status: 401 });

  const result = await getContainer().authService.login({
    ...input.data,
    ip: getClientIp(request),
  });
  if (!result.ok) {
    const rateLimited = result.code === "RATE_LIMITED";
    return Response.json(
      { error: rateLimited ? "尝试次数过多，请稍后再试" : "用户名或密码不正确" },
      { status: rateLimited ? 429 : 401 },
    );
  }

  await setSessionCookie(result.sessionToken);
  return Response.json({ user: result.user });
}
