import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { sessionCookieName } from "@/features/auth/server/current-user";
import { assertTrustedOrigin } from "@/features/auth/server/http";
import { getContainer } from "@/server/container";

export async function POST(request: Request) {
  const rejected = assertTrustedOrigin(request);
  if (rejected) return rejected;

  const cookieStore = await cookies();
  await getContainer().authService.logout(cookieStore.get(sessionCookieName)?.value);
  cookieStore.delete(sessionCookieName);
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
