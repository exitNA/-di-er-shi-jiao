import { AuthService } from "@/features/auth/server/auth-service";
import { Argon2PasswordHasher } from "@/features/auth/server/password";
import { PostgresAuthRepository } from "@/features/auth/server/postgres-auth-repository";
import type { AnalysisRepository } from "@/features/analysis/server/analysis-repository";
import { PostgresAnalysisRepository } from "@/features/analysis/server/postgres-analysis-repository";
import { loadServerEnv } from "./config/env";
import { createDb, type AppDb } from "./db/client";

export type ApplicationContainer = {
  db: AppDb;
  authService: AuthService;
  analysisRepository: AnalysisRepository;
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
      analysisRepository: new PostgresAnalysisRepository(db),
    };
  }
  return container;
}
