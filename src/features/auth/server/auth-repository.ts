export type AuthenticatedUser = { id: string; username: string };

export type AuthSession = AuthenticatedUser & {
  sessionId: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
};

export type AuthResult =
  | { ok: true; user: AuthenticatedUser; sessionToken: string }
  | { ok: false; code: "USERNAME_TAKEN" | "INVALID_CREDENTIALS" | "RATE_LIMITED" };

export interface AuthRepository {
  createUserWithCredential(input: {
    id: string;
    username: string;
    normalizedUsername: string;
    passwordHash: string;
    now: Date;
  }): Promise<AuthenticatedUser | null>;
  findCredential(
    normalizedUsername: string,
  ): Promise<(AuthenticatedUser & { passwordHash: string }) | null>;
  createSession(input: {
    id: string;
    userId: string;
    tokenHash: string;
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
    now: Date;
  }): Promise<void>;
  findActiveSession(tokenHash: string, now: Date): Promise<AuthSession | null>;
  touchSession(sessionId: string, idleExpiresAt: Date, now: Date): Promise<void>;
  revokeSession(tokenHash: string, now: Date): Promise<void>;
  consumeRateLimit(input: {
    key: string;
    action: "register" | "login";
    now: Date;
    limit: number;
    windowMs: number;
    blockMs: number;
  }): Promise<{ allowed: boolean; retryAt?: Date }>;
}
