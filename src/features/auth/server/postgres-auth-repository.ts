import { and, eq, gt, isNull, lte } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { isPostgresUniqueViolation } from "@/server/db/postgres-errors";
import {
  authRateLimits,
  passwordCredentials,
  sessions,
  users,
} from "@/server/db/schema/auth";
import type {
  AuthRepository,
  AuthSession,
  AuthenticatedUser,
} from "./auth-repository";

const sessionTouchIntervalMs = 5 * 60 * 1000;

export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly db: AppDb) {}

  async createUserWithCredential(input: {
    id: string;
    username: string;
    normalizedUsername: string;
    passwordHash: string;
    now: Date;
  }): Promise<AuthenticatedUser | null> {
    try {
      return await this.db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({
            id: input.id,
            username: input.username,
            normalizedUsername: input.normalizedUsername,
            createdAt: input.now,
          })
          .returning({ id: users.id, username: users.username });

        await tx.insert(passwordCredentials).values({
          userId: user.id,
          passwordHash: input.passwordHash,
          updatedAt: input.now,
        });

        return user;
      });
    } catch (error) {
      if (isPostgresUniqueViolation(error)) return null;
      throw error;
    }
  }

  async findCredential(
    normalizedUsername: string,
  ): Promise<(AuthenticatedUser & { passwordHash: string }) | null> {
    const [credential] = await this.db
      .select({
        id: users.id,
        username: users.username,
        passwordHash: passwordCredentials.passwordHash,
      })
      .from(users)
      .innerJoin(passwordCredentials, eq(passwordCredentials.userId, users.id))
      .where(eq(users.normalizedUsername, normalizedUsername))
      .limit(1);

    return credential ?? null;
  }

  async createSession(input: {
    id: string;
    userId: string;
    tokenHash: string;
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
    now: Date;
  }): Promise<void> {
    await this.db.insert(sessions).values({
      id: input.id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      idleExpiresAt: input.idleExpiresAt,
      absoluteExpiresAt: input.absoluteExpiresAt,
      lastSeenAt: input.now,
      createdAt: input.now,
    });
  }

  async findActiveSession(tokenHash: string, now: Date): Promise<AuthSession | null> {
    const [session] = await this.db
      .select({
        id: users.id,
        username: users.username,
        sessionId: sessions.id,
        idleExpiresAt: sessions.idleExpiresAt,
        absoluteExpiresAt: sessions.absoluteExpiresAt,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.idleExpiresAt, now),
          gt(sessions.absoluteExpiresAt, now),
        ),
      )
      .limit(1);

    return session ?? null;
  }

  async touchSession(sessionId: string, idleExpiresAt: Date, now: Date): Promise<void> {
    await this.db
      .update(sessions)
      .set({ idleExpiresAt, lastSeenAt: now })
      .where(
        and(
          eq(sessions.id, sessionId),
          isNull(sessions.revokedAt),
          lte(sessions.lastSeenAt, new Date(now.getTime() - sessionTouchIntervalMs)),
        ),
      );
  }

  async revokeSession(tokenHash: string, now: Date): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
  }

  async consumeRateLimit(input: {
    key: string;
    action: "register" | "login";
    now: Date;
    limit: number;
    windowMs: number;
    blockMs: number;
  }): Promise<{ allowed: boolean; retryAt?: Date }> {
    return this.db.transaction(async (tx) => {
      await tx
        .insert(authRateLimits)
        .values({
          key: input.key,
          action: input.action,
          windowStartedAt: input.now,
          attemptCount: 0,
          updatedAt: input.now,
        })
        .onConflictDoNothing();

      const [current] = await tx
        .select()
        .from(authRateLimits)
        .where(eq(authRateLimits.key, input.key))
        .for("update");

      if (current.blockedUntil && current.blockedUntil > input.now) {
        return { allowed: false, retryAt: current.blockedUntil };
      }

      const windowExpired =
        input.now.getTime() - current.windowStartedAt.getTime() >= input.windowMs;
      const attemptCount = windowExpired ? 1 : current.attemptCount + 1;
      const blockedUntil =
        attemptCount > input.limit ? new Date(input.now.getTime() + input.blockMs) : null;

      await tx
        .update(authRateLimits)
        .set({
          action: input.action,
          windowStartedAt: windowExpired ? input.now : current.windowStartedAt,
          attemptCount,
          blockedUntil,
          updatedAt: input.now,
        })
        .where(eq(authRateLimits.key, input.key));

      return blockedUntil
        ? { allowed: false, retryAt: blockedUntil }
        : { allowed: true };
    });
  }
}
