import { AuthService } from "@/features/auth/server/auth-service";
import { Argon2PasswordHasher } from "@/features/auth/server/password";
import { PostgresAuthRepository } from "@/features/auth/server/postgres-auth-repository";
import type { AnalysisDispatcher } from "@/features/analysis/server/analysis-dispatcher";
import type { AnalysisRepository } from "@/features/analysis/server/analysis-repository";
import { PostgresAnalysisRepository } from "@/features/analysis/server/postgres-analysis-repository";
import {
  submitAnalysis,
  type SubmitAnalysisInput,
  type SubmitAnalysisResult,
} from "@/features/analysis/server/submit-analysis";
import { QueuedAnalysisDispatcher } from "@/server/adapters/tasks/queued-analysis-dispatcher";
import { loadServerEnv } from "./config/env";
import { createDb, type AppDb } from "./db/client";

export type ApplicationContainer = {
  db: AppDb;
  authService: AuthService;
  analysisRepository: AnalysisRepository;
  analysisDispatcher: AnalysisDispatcher;
  submitAnalysis(input: SubmitAnalysisInput): Promise<SubmitAnalysisResult>;
};

let container: ApplicationContainer | undefined;

export function getContainer(): ApplicationContainer {
  if (!container) {
    const env = loadServerEnv();
    const db = createDb(env.DATABASE_URL);
    const analysisRepository = new PostgresAnalysisRepository(db);
    const analysisDispatcher = new QueuedAnalysisDispatcher();
    container = {
      db,
      authService: new AuthService(
        new PostgresAuthRepository(db),
        new Argon2PasswordHasher(),
        env.AUTH_SECRET,
      ),
      analysisRepository,
      analysisDispatcher,
      submitAnalysis: (input) => submitAnalysis(input, analysisRepository, analysisDispatcher),
    };
  }
  return container;
}
