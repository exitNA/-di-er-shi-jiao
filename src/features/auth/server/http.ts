import { cookies } from "next/headers";
import { getLogger } from "@logtape/logtape";

import { loadServerEnv } from "@/server/config/env";
import { sessionCookieName } from "./current-user";

const logger = getLogger(["second-perspective", "auth"]);

export function assertTrustedMutation(request: Request): Response | null {
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
    return Response.json({ error: "请求格式不受支持" }, { status: 415 });
  }
  return assertTrustedOrigin(request);
}

export function assertTrustedOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  const expectedOrigin = new URL(loadServerEnv().APP_URL).origin;
  if (origin === expectedOrigin) return null;

  logger.warning("Rejected request with untrusted origin", {
    origin: origin ?? "missing",
    expectedOrigin,
  });
  return Response.json({ error: "请求来源无效" }, { status: 403 });
}

export function getClientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || "unknown";
}

export async function setSessionCookie(sessionToken: string): Promise<void> {
  const env = loadServerEnv();
  (await cookies()).set(sessionCookieName, sessionToken, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}
