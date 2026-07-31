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
import { OpenAICompatibleGenerator } from "@/server/adapters/ai/openai-compatible-generator";
import { TavilySearchClient } from "@/server/adapters/search/tavily-search-client";
import { InProcessAnalysisDispatcher } from "@/server/adapters/tasks/in-process-analysis-dispatcher";
import { TriggerAnalysisDispatcher } from "@/server/adapters/tasks/trigger-analysis-dispatcher";
import { AiExpertSuite } from "@/server/agents/ai-expert-suite";
import { BaselineOrchestrator } from "@/server/agents/baseline-orchestrator";
import { FakeExpertSuite } from "@/server/agents/fake-expert-suite";
import { loadServerEnv } from "./config/env";
import { createDb, type AppDb } from "./db/client";
import { recordProductEvent } from "./observability/product-events";

export type ApplicationContainer = {
  db: AppDb;
  authService: AuthService;
  analysisRepository: AnalysisRepository;
  analysisDispatcher: AnalysisDispatcher;
  baselineOrchestrator: BaselineOrchestrator;
  submitAnalysis(input: SubmitAnalysisInput): Promise<SubmitAnalysisResult>;
};

let container: ApplicationContainer | undefined;

export function getContainer(): ApplicationContainer {
  if (!container) {
    const env = loadServerEnv();
    const db = createDb(env.DATABASE_URL);
    const analysisRepository = new PostgresAnalysisRepository(db);
    const now = () => new Date();
    const productEventRecorder = (
      input: Parameters<typeof recordProductEvent>[1],
    ) => recordProductEvent(db, input);
    const experts =
      env.AGENT_ADAPTER === "fake"
        ? new FakeExpertSuite()
        : new AiExpertSuite({
            generator: new OpenAICompatibleGenerator({
              baseURL: env.LLM_BASE_URL!,
              apiKey: env.LLM_API_KEY!,
              modelId: env.LLM_MODEL_ID!,
            }),
            searchClient: new TavilySearchClient({
              apiKey: env.TAVILY_API_KEY!,
            }),
          });
    const baselineOrchestrator = new BaselineOrchestrator(
      experts,
      analysisRepository,
      now,
      productEventRecorder,
    );
    const analysisDispatcher =
      env.ANALYSIS_RUNTIME === "in-process"
        ? new InProcessAnalysisDispatcher(baselineOrchestrator)
        : new TriggerAnalysisDispatcher();
    container = {
      db,
      authService: new AuthService(
        new PostgresAuthRepository(db),
        new Argon2PasswordHasher(),
        env.AUTH_SECRET,
      ),
      analysisRepository,
      analysisDispatcher,
      baselineOrchestrator,
      submitAnalysis: (input) =>
        submitAnalysis(
          input,
          analysisRepository,
          analysisDispatcher,
          now,
          productEventRecorder,
        ),
    };
  }
  return container;
}
