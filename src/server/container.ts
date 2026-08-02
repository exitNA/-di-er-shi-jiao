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
import {
  createOpenAICompatibleLanguageModel,
  OpenAICompatibleGenerator,
} from "@/server/adapters/ai/openai-compatible-generator";
import { TavilySearchClient } from "@/server/adapters/search/tavily-search-client";
import { InProcessAnalysisDispatcher } from "@/server/adapters/tasks/in-process-analysis-dispatcher";
import { TriggerAnalysisDispatcher } from "@/server/adapters/tasks/trigger-analysis-dispatcher";
import { AiExpertSuite } from "@/server/agents/ai-expert-suite";
import { WorkspaceAgentRuntime } from "@/server/agents/workspace-agent-runtime";
import { WorkspaceToolExecutor } from "@/server/agents/workspace-tool-executor";
import { loadServerEnv } from "./config/env";
import { createDb, type AppDb } from "./db/client";
import { recordProductEvent } from "./observability/product-events";
import {
  submitChallenge,
  type SubmitChallengeInput,
  type SubmitChallengeResult,
} from "@/features/conversation/server/submit-challenge";

export type ApplicationContainer = {
  db: AppDb;
  authService: AuthService;
  analysisRepository: AnalysisRepository;
  analysisDispatcher: AnalysisDispatcher;
  workspaceAgentRuntime: Pick<WorkspaceAgentRuntime, "run">;
  submitAnalysis(input: SubmitAnalysisInput): Promise<SubmitAnalysisResult>;
  submitChallenge(input: SubmitChallengeInput): Promise<SubmitChallengeResult>;
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
    const llmConfig = {
      baseURL: env.LLM_BASE_URL,
      apiKey: env.LLM_API_KEY,
      modelId: env.LLM_MODEL_ID,
    };
    const experts = new AiExpertSuite({
      generator: new OpenAICompatibleGenerator(llmConfig),
      ...(env.TAVILY_API_KEY
        ? { searchClient: new TavilySearchClient({ apiKey: env.TAVILY_API_KEY }) }
        : {}),
    });
    const workspaceToolExecutor = new WorkspaceToolExecutor(
      experts,
      analysisRepository,
      now,
    );
    const workspaceAgentRuntime = new WorkspaceAgentRuntime(
      createOpenAICompatibleLanguageModel(llmConfig),
      workspaceToolExecutor,
      analysisRepository,
    );
    const analysisDispatcher =
      env.ANALYSIS_RUNTIME === "in-process"
        ? new InProcessAnalysisDispatcher(workspaceAgentRuntime, analysisRepository)
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
      workspaceAgentRuntime,
      submitAnalysis: (input) =>
        submitAnalysis(
          input,
          analysisRepository,
          analysisDispatcher,
          now,
          productEventRecorder,
        ),
      submitChallenge: (input) =>
        submitChallenge(
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
