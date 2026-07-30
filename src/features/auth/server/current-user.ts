import { cookies } from "next/headers";

import type { AuthenticatedUser } from "./auth-repository";
import { getContainer } from "@/server/container";

export const sessionCookieName = "sp_session";

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const session = await getContainer().authService.authenticate(
    (await cookies()).get(sessionCookieName)?.value,
  );
  return session ? { id: session.id, username: session.username } : null;
}
