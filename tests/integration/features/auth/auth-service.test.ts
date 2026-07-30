import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthService } from "@/features/auth/server/auth-service";
import { PostgresAuthRepository } from "@/features/auth/server/postgres-auth-repository";
import { Argon2PasswordHasher } from "@/features/auth/server/password";
import { authRateLimits, sessions } from "@/server/db/schema/auth";
import { createTestDb, migrateTestDb, truncateTestDb } from "../../../helpers/database";

const authSecret = "test-auth-secret-that-is-at-least-32-bytes";
const initialTime = new Date("2026-07-30T00:00:00.000Z");
const db = createTestDb();
const service = new AuthService(
  new PostgresAuthRepository(db),
  new Argon2PasswordHasher(),
  authSecret,
);

const credentials = {
  username: "reader_1",
  password: "a long password",
  ip: "203.0.113.1",
};

describe("AuthService", () => {
  beforeAll(() => migrateTestDb());
  beforeEach(() => truncateTestDb());
  afterAll(() => db.$client.end());

  it("registers once and rejects the same normalized username", async () => {
    await expect(service.register({ ...credentials, now: initialTime })).resolves.toMatchObject({
      ok: true,
      user: { username: credentials.username },
    });
    await expect(
      service.register({ ...credentials, username: "READER_1", now: initialTime }),
    ).resolves.toEqual({ ok: false, code: "USERNAME_TAKEN" });
  });

  it("returns INVALID_CREDENTIALS for unknown username and wrong password", async () => {
    await expect(
      service.login({ ...credentials, username: "unknown_user", now: initialTime }),
    ).resolves.toEqual({ ok: false, code: "INVALID_CREDENTIALS" });

    await service.register({ ...credentials, now: initialTime });
    await expect(
      service.login({ ...credentials, password: "a wrong password", now: initialTime }),
    ).resolves.toEqual({ ok: false, code: "INVALID_CREDENTIALS" });
  });

  it("creates a session with 30-minute idle and 7-day absolute expiry", async () => {
    const result = await service.register({ ...credentials, now: initialTime });
    expect(result.ok).toBe(true);

    const [session] = await db.select().from(sessions);
    expect(session.idleExpiresAt).toEqual(new Date(initialTime.getTime() + 30 * 60 * 1000));
    expect(session.absoluteExpiresAt).toEqual(
      new Date(initialTime.getTime() + 7 * 24 * 60 * 60 * 1000),
    );
  });

  it("touches a valid session at most once every five minutes", async () => {
    const result = await service.register({ ...credentials, now: initialTime });
    if (!result.ok) throw new Error("registration failed");

    await service.authenticate(result.sessionToken, new Date(initialTime.getTime() + 60_000));
    let [session] = await db.select().from(sessions);
    expect(session.lastSeenAt).toEqual(initialTime);

    const touchedAt = new Date(initialTime.getTime() + 5 * 60_000);
    await service.authenticate(result.sessionToken, touchedAt);
    [session] = await db.select().from(sessions);
    expect(session.lastSeenAt).toEqual(touchedAt);
    expect(session.idleExpiresAt).toEqual(new Date(touchedAt.getTime() + 30 * 60_000));
  });

  it("revokes a session on logout", async () => {
    const result = await service.register({ ...credentials, now: initialTime });
    if (!result.ok) throw new Error("registration failed");

    await service.logout(result.sessionToken, new Date(initialTime.getTime() + 60_000));
    await expect(service.authenticate(result.sessionToken, initialTime)).resolves.toBeNull();
  });

  it("blocks the sixth failed login for fifteen minutes", async () => {
    await service.register({ ...credentials, now: initialTime });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        service.login({ ...credentials, password: "a wrong password", now: initialTime }),
      ).resolves.toEqual({ ok: false, code: "INVALID_CREDENTIALS" });
    }

    await expect(
      service.login({ ...credentials, password: "a wrong password", now: initialTime }),
    ).resolves.toEqual({ ok: false, code: "RATE_LIMITED" });

    const [rateLimit] = await db.select().from(authRateLimits);
    expect(rateLimit.key).not.toContain(credentials.ip);
    expect(rateLimit.key).not.toContain(credentials.username);
  });
});
