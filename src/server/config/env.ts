import { z } from "zod";

const observabilitySchema = z.object({
  OPIK_URL_OVERRIDE: z.string().url(),
  OPIK_PROJECT_NAME: z.literal("second-perspective"),
});

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.string().url(),
    DATABASE_URL: z.string().url(),
    AUTH_SECRET: z.string().min(32),
    ANALYSIS_RUNTIME: z.enum(["in-process", "trigger"]).default("in-process"),
    LLM_BASE_URL: z.string().url(),
    LLM_API_KEY: z.string().min(1),
    LLM_MODEL_ID: z.string().min(1),
    TAVILY_API_KEY: z.preprocess(
      (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
      z.string().min(1).optional(),
    ),
    TRIGGER_SECRET_KEY: z.string().min(1).optional(),
    TRIGGER_PROJECT_REF: z.string().min(1).optional(),
    LANGFUSE_BASE_URL: z.string().url(),
    LANGFUSE_PUBLIC_KEY: z.string().min(1),
    LANGFUSE_SECRET_KEY: z.string().min(1),
    LANGFUSE_TRACING_ENVIRONMENT: z.literal("local").default("local"),
    LLM_INPUT_USD_PER_MILLION: z.coerce.number().nonnegative().default(0),
    LLM_OUTPUT_USD_PER_MILLION: z.coerce.number().nonnegative().default(0),
  })
  .superRefine((value, context) => {
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

export function loadObservabilityEnv(
  source: NodeJS.ProcessEnv = process.env,
): z.infer<typeof observabilitySchema> {
  return observabilitySchema.parse(source);
}
