import "server-only";

import { context, createContextKey, ROOT_CONTEXT } from "@opentelemetry/api";
import {
  propagateAttributes,
  startActiveObservation,
  type LangfuseAgent,
  type LangfuseChain,
  type LangfuseGeneration,
  type LangfuseObservationAttributes,
  type LangfuseRetriever,
  type LangfuseTool,
} from "@langfuse/tracing";
import { Opik, type Span, type Trace } from "opik";

import { loadServerEnv } from "@/server/config/env";

type ObservationType = "agent" | "chain" | "generation" | "tool" | "retriever";
type SupportedObservation =
  | LangfuseAgent
  | LangfuseChain
  | LangfuseGeneration
  | LangfuseTool
  | LangfuseRetriever;

type ObservationInput = {
  name: string;
  asType: ObservationType;
  input: unknown;
  metadata?: Record<string, string>;
};

export type ObservationHandle = {
  update(attributes: Record<string, unknown>): void;
};

type OpikTarget =
  | { kind: "span"; value: Span }
  | { kind: "trace"; value: Trace };

const opikParentKey = createContextKey("second-perspective.opik-parent");
let opikClient: Opik | undefined;

export async function withObservation<T>(
  input: ObservationInput,
  run: (observation: ObservationHandle) => Promise<T>,
): Promise<T> {
  const activeParent = context.active().getValue(opikParentKey) as Trace | Span | undefined;
  const fallbackTrace = activeParent ? undefined : getOpikClient().trace({
    name: input.name,
    input: input.input as Parameters<Opik["trace"]>[0]["input"],
    metadata: input.metadata,
  });
  const parent = activeParent ?? fallbackTrace;
  const span = parent?.span({
    name: input.name,
    type: opikSpanType(input.asType),
    input: input.input as Parameters<Trace["span"]>[0]["input"],
    metadata: input.metadata,
  });
  if (!span) throw new Error("Opik observation parent is unavailable");

  try {
    return await runLangfuseObservation(
      input,
      { kind: "span", value: span },
      run,
    );
  } finally {
    span.end();
    fallbackTrace?.end();
  }
}

export async function withAnalysisTrace<T>(
  input: {
    workspaceId: string;
    userId: string;
    kind: "baseline" | "challenge";
    material: string;
  },
  run: (observation: ObservationHandle) => Promise<T>,
): Promise<T> {
  const name = `analysis.${input.kind}`;
  const metadata = {
    kind: input.kind,
    userId: input.userId,
    workspaceId: input.workspaceId,
  };
  const trace = getOpikClient().trace({
    name,
    input: { material: input.material },
    metadata,
  });

  try {
    return await context.with(
      ROOT_CONTEXT.setValue(opikParentKey, trace),
      () => propagateAttributes(
        {
          traceName: name,
          userId: input.userId,
          sessionId: input.workspaceId,
          metadata: {
            kind: input.kind,
            workspaceId: input.workspaceId,
          },
        },
        () => runLangfuseObservation(
          {
            name,
            asType: "chain",
            input: { material: input.material },
            metadata,
          },
          { kind: "trace", value: trace },
          run,
        ),
      ),
    );
  } finally {
    trace.end();
  }
}

export async function flushObservationClient(): Promise<void> {
  await getOpikClient().flush();
}

async function runLangfuseObservation<T>(
  input: ObservationInput,
  opikTarget: OpikTarget,
  run: (observation: ObservationHandle) => Promise<T>,
): Promise<T> {
  const observe = async (langfuse: SupportedObservation): Promise<T> => {
    let outputUpdated = false;
    langfuse.update({ input: input.input, metadata: input.metadata });
    const handle: ObservationHandle = {
      update: (attributes) => {
        if (Object.hasOwn(attributes, "output")) outputUpdated = true;
        langfuse.update(attributes as LangfuseObservationAttributes);
        updateOpik(opikTarget, attributes);
      },
    };

    try {
      const result = await context.with(
        context.active().setValue(opikParentKey, opikTarget.value),
        () => run(handle),
      );
      if (result !== undefined && !outputUpdated) handle.update({ output: result });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      langfuse.update({
        level: "ERROR",
        statusMessage: message,
        output: { error: message },
      });
      updateOpik(opikTarget, { output: { error: message } }, error);
      throw error;
    }
  };

  switch (input.asType) {
    case "agent":
      return startActiveObservation(input.name, observe, { asType: "agent" });
    case "chain":
      return startActiveObservation(input.name, observe, { asType: "chain" });
    case "generation":
      return startActiveObservation(input.name, observe, { asType: "generation" });
    case "tool":
      return startActiveObservation(input.name, observe, { asType: "tool" });
    case "retriever":
      return startActiveObservation(input.name, observe, { asType: "retriever" });
  }
}

function updateOpik(
  target: OpikTarget,
  attributes: Record<string, unknown>,
  error?: unknown,
): void {
  const errorInfo = error === undefined
    ? errorFromAttributes(attributes)
    : {
        exceptionType: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
        traceback: error instanceof Error ? error.stack ?? error.message : String(error),
      };

  if (target.kind === "trace") {
    const updates: Parameters<Trace["update"]>[0] = {};
    if (Object.hasOwn(attributes, "input")) {
      updates.input = attributes.input as typeof updates.input;
    }
    if (Object.hasOwn(attributes, "output")) {
      updates.output = attributes.output as typeof updates.output;
    }
    if (Object.hasOwn(attributes, "metadata")) {
      updates.metadata = attributes.metadata as typeof updates.metadata;
    }
    if (errorInfo) updates.errorInfo = errorInfo;
    target.value.update(updates);
    return;
  }

  const updates: Parameters<Span["update"]>[0] = {};
  if (Object.hasOwn(attributes, "input")) {
    updates.input = attributes.input as typeof updates.input;
  }
  if (Object.hasOwn(attributes, "output")) {
    updates.output = attributes.output as typeof updates.output;
  }
  if (Object.hasOwn(attributes, "metadata")) {
    updates.metadata = attributes.metadata as typeof updates.metadata;
  }
  if (typeof attributes.model === "string") updates.model = attributes.model;
  const usage = numberRecord(attributes.usageDetails);
  if (usage) updates.usage = usage;
  const cost = numberRecord(attributes.costDetails);
  if (cost?.total !== undefined) updates.totalEstimatedCost = cost.total;
  if (errorInfo) updates.errorInfo = errorInfo;
  target.value.update(updates);
}

function errorFromAttributes(
  attributes: Record<string, unknown>,
): Parameters<Span["update"]>[0]["errorInfo"] {
  if (attributes.level !== "ERROR") return undefined;
  const message = typeof attributes.statusMessage === "string"
    ? attributes.statusMessage
    : "Observation failed";
  return { exceptionType: "Error", message, traceback: message };
}

function numberRecord(value: unknown): Record<string, number> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function opikSpanType(type: ObservationType): "general" | "llm" | "tool" {
  if (type === "generation") return "llm";
  if (type === "tool") return "tool";
  return "general";
}

function getOpikClient(): Opik {
  if (!opikClient) {
    const env = loadServerEnv();
    opikClient = new Opik({
      apiUrl: env.OPIK_URL_OVERRIDE,
      projectName: env.OPIK_PROJECT_NAME,
    });
  }
  return opikClient;
}
