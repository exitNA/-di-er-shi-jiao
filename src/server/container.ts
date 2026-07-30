import { AuthService } from "@/features/auth/server/auth-service";
import { Argon2PasswordHasher } from "@/features/auth/server/password";
import { PostgresAuthRepository } from "@/features/auth/server/postgres-auth-repository";
import { loadServerEnv } from "./config/env";
import { createDb, type AppDb } from "./db/client";

export type ApplicationContainer = {
  db: AppDb;
  authService: AuthService;
};

let container: ApplicationContainer | undefined;

export function getContainer(): ApplicationContainer {
  if (!container) {
    const env = loadServerEnv();
    const db = createDb(env.DATABASE_URL);
    container = {
      db,
      authService: new AuthService(
        new PostgresAuthRepository(db),
        new Argon2PasswordHasher(),
        env.AUTH_SECRET,
      ),
    };
  }
  return container;
}
