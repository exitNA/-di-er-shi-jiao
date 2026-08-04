import { createHmac, randomUUID } from "node:crypto";
import { loginSchema, normalizeUsername, registrationSchema } from "@/features/auth/domain/credentials";
import type { PasswordHasher } from "./password";
import type { AuthRepository, AuthResult, AuthSession, AuthenticatedUser } from "./auth-repository";
import { createSessionToken, hashSessionToken } from "./session-token";

const absoluteSessionMs = 7 * 24 * 60 * 60 * 1000;
const idleSessionMs = absoluteSessionMs;
const registrationWindowMs = 60 * 60 * 1000;
const loginWindowMs = 15 * 60 * 1000;

let dummyPasswordHash: Promise<string> | undefined;

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly authSecret: string,
  ) {}

  async register(input: {
    username: string;
    password: string;
    ip: string;
    now?: Date;
  }): Promise<AuthResult> {
    const credential = registrationSchema.parse(input);
    const now = input.now ?? new Date();
    const rateLimit = await this.repository.consumeRateLimit({
      key: this.rateLimitKey("register", input.ip),
      action: "register",
      now,
      limit: 5,
      windowMs: registrationWindowMs,
      blockMs: registrationWindowMs,
    });
    if (!rateLimit.allowed) return { ok: false, code: "RATE_LIMITED" };

    const user = await this.repository.createUserWithCredential({
      id: randomUUID(),
      username: credential.username,
      normalizedUsername: normalizeUsername(credential.username),
      passwordHash: await this.passwordHasher.hash(credential.password),
      now,
    });
    if (!user) return { ok: false, code: "USERNAME_TAKEN" };

    return this.createAuthenticatedResult(user, now);
  }

  async login(input: {
    username: string;
    password: string;
    ip: string;
    now?: Date;
  }): Promise<AuthResult> {
    const credential = loginSchema.parse(input);
    const now = input.now ?? new Date();
    const normalizedUsername = normalizeUsername(credential.username);
    const storedCredential = await this.repository.findCredential(normalizedUsername);
    const passwordHash = storedCredential?.passwordHash ?? (await this.getDummyPasswordHash());
    const passwordMatches = await this.passwordHasher.verify(passwordHash, credential.password);

    if (!storedCredential || !passwordMatches) {
      const rateLimit = await this.repository.consumeRateLimit({
        key: this.rateLimitKey("login", input.ip, normalizedUsername),
        action: "login",
        now,
        limit: 5,
        windowMs: loginWindowMs,
        blockMs: loginWindowMs,
      });
      return rateLimit.allowed
        ? { ok: false, code: "INVALID_CREDENTIALS" }
        : { ok: false, code: "RATE_LIMITED" };
    }

    return this.createAuthenticatedResult(storedCredential, now);
  }

  async authenticate(rawToken: string | undefined, now = new Date()): Promise<AuthSession | null> {
    if (!rawToken) return null;

    const session = await this.repository.findActiveSession(hashSessionToken(rawToken), now);
    if (!session) return null;

    await this.repository.touchSession(
      session.sessionId,
      new Date(Math.min(now.getTime() + idleSessionMs, session.absoluteExpiresAt.getTime())),
      now,
    );
    return session;
  }

  async logout(rawToken: string | undefined, now = new Date()): Promise<void> {
    if (rawToken) await this.repository.revokeSession(hashSessionToken(rawToken), now);
  }

  private async createAuthenticatedResult(
    user: AuthenticatedUser,
    now: Date,
  ): Promise<AuthResult> {
    const sessionToken = createSessionToken();
    await this.repository.createSession({
      id: randomUUID(),
      userId: user.id,
      tokenHash: hashSessionToken(sessionToken),
      idleExpiresAt: new Date(now.getTime() + idleSessionMs),
      absoluteExpiresAt: new Date(now.getTime() + absoluteSessionMs),
      now,
    });
    return { ok: true, user, sessionToken };
  }

  private getDummyPasswordHash(): Promise<string> {
    return (dummyPasswordHash ??= this.passwordHasher.hash("dummy-password-not-a-user"));
  }

  private rateLimitKey(action: "register" | "login", ...parts: string[]): string {
    return createHmac("sha256", this.authSecret)
      .update([action, ...parts].join("\u0000"))
      .digest("hex");
  }
}
