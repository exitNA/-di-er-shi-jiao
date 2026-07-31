import { z } from "zod";

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.string().url(),
    DATABASE_URL: z.string().url(),
    TEST_DATABASE_URL: z.string().url().optional(),
    AUTH_SECRET: z.string().min(32),
    AGENT_ADAPTER: z.enum(["fake", "openai-compatible", "coze-coding-dev-sdk"]).default("fake"),
    ANALYSIS_RUNTIME: z.enum(["in-process", "trigger"]).default("in-process"),
    LLM_BASE_URL: z.string().url().optional(),
    LLM_API_KEY: z.string().min(1).optional(),
    LLM_MODEL_ID: z.string().min(1).optional(),
    TAVILY_API_KEY: z.string().min(1).optional(),
    TRIGGER_SECRET_KEY: z.string().min(1).optional(),
    TRIGGER_PROJECT_REF: z.string().min(1).optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    LLM_INPUT_USD_PER_MILLION: z.coerce.number().nonnegative().default(0),
    LLM_OUTPUT_USD_PER_MILLION: z.coerce.number().nonnegative().default(0),
  })
  .superRefine((value, context) => {
    if (value.AGENT_ADAPTER === "openai-compatible") {
      for (const key of [
        "LLM_BASE_URL",
        "LLM_API_KEY",
        "LLM_MODEL_ID",
        "TAVILY_API_KEY",
      ] as const) {
        if (!value[key]) {
          context.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required`,
          });
        }
      }
    }
    if (value.AGENT_ADAPTER === "coze-coding-dev-sdk") {
      if (!value.TAVILY_API_KEY) {
        context.addIssue({
          code: "custom",
          path: ["TAVILY_API_KEY"],
          message: "TAVILY_API_KEY is required for coze-coding-dev-sdk adapter",
        });
      }
    }
    if (value.ANALYSIS_RUNTIME === "trigger") {
      for (const key of ["TRIGGER_SECRET_KEY", "TRIGGER_PROJECT_REF"] as const) {
        if (!value[key]) {
          context.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required`,
          });
        }
      }
    }
  });

export type ServerEnv = z.infer<typeof schema>;

export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  return schema.parse(source);
}
