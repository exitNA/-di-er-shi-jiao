import "server-only";

import {
  context,
  ROOT_CONTEXT,
  trace as otelTrace,
  type Span as OtelSpan,
} from "@opentelemetry/api";
import {
  propagateAttributes,
  startObservation as startLangfuseObservation,
  type LangfuseAgent,
  type LangfuseChain,
  type LangfuseGeneration,
  type LangfuseObservationAttributes,
  type LangfuseRetriever,
  type LangfuseTool,
} from "@langfuse/tracing";
import { Opik, type Span as OpikSpan, type Trace as OpikTrace } from "opik";

import { loadServerEnv } from "@/server/config/env";

type ObservationType = "agent" | "chain" | "generation" | "tool" | "retriever";
type SupportedObservation =
  | LangfuseAgent
  | LangfuseChain
  | LangfuseGeneration
  | LangfuseTool
  | LangfuseRetriever;

export type ObservationInput = {
  name: string;
  asType: ObservationType;
  input: unknown;
  metadata?: Record<string, string>;
};

export type ObservationHandle = {
  update(attributes: Record<string, unknown>): void;
  end(error?: unknown): void;
  readonly otelSpan: OtelSpan;
};

type OpikTarget =
  | { kind: "span"; value: OpikSpan }
  | { kind: "trace"; value: OpikTrace };

const opikParents = new WeakMap<OtelSpan, OpikTrace | OpikSpan>();
let opikClient: Opik | undefined;

export function startObservation(input: ObservationInput): ObservationHandle {
  const activeParent = activeOpikParent();
  const fallbackTrace = activeParent ? undefined : getOpikClient().trace({
    name: input.name,
    input: input.input as Parameters<Opik["trace"]>[0]["input"],
    metadata: input.metadata,
  });
  const parent = activeParent ?? fallbackTrace;
  if (!parent) throw new Error("Opik observation parent is unavailable");
  const opikSpan = parent.span({
    name: input.name,
    type: opikSpanType(input.asType),
    input: input.input as Parameters<OpikTrace["span"]>[0]["input"],
    metadata: input.metadata,
  });
  return createObservationHandle(
    createLangfuseObservation(input),
    { kind: "span", value: opikSpan },
    fallbackTrace,
  );
}

export async function withObservation<T>(
  input: ObservationInput,
  run: (observation: ObservationHandle) => Promise<T>,
): Promise<T> {
  return runObservation(startObservation(input), run);
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
  return context.with(ROOT_CONTEXT, () => propagateAttributes(
    {
      traceName: name,
      userId: input.userId,
      sessionId: input.workspaceId,
      metadata: {
        kind: input.kind,
        workspaceId: input.workspaceId,
      },
    },
    () => {
      const opikTrace = getOpikClient().trace({
        name,
        input: { material: input.material },
        metadata,
      });
      return runObservation(
        createObservationHandle(
          createLangfuseObservation({
            name,
            asType: "chain",
            input: { material: input.material },
            metadata,
          }),
          { kind: "trace", value: opikTrace },
        ),
        run,
      );
    },
  ));
}

export async function flushObservationClient(): Promise<void> {
  await getOpikClient().flush();
}

async function runObservation<T>(
  observation: ObservationHandle,
  run: (observation: ObservationHandle) => Promise<T>,
): Promise<T> {
  let outputUpdated = false;
  const handle: ObservationHandle = {
    end: observation.end,
    otelSpan: observation.otelSpan,
    update: (attributes) => {
      if (Object.hasOwn(attributes, "output")) outputUpdated = true;
      observation.update(attributes);
    },
  };

  try {
    const result = await context.with(
      otelTrace.setSpan(context.active(), observation.otelSpan),
      () => run(handle),
    );
    if (result !== undefined && !outputUpdated) handle.update({ output: result });
    return result;
  } catch (error) {
    observation.end(error);
    throw error;
  } finally {
    observation.end();
  }
}

function createObservationHandle(
  langfuse: SupportedObservation,
  opikTarget: OpikTarget,
  fallbackTrace?: OpikTrace,
): ObservationHandle {
  let ended = false;
  opikParents.set(langfuse.otelSpan, opikTarget.value);

  return {
    otelSpan: langfuse.otelSpan,
    update(attributes) {
      if (ended) return;
      langfuse.update(attributes as LangfuseObservationAttributes);
      updateOpik(opikTarget, attributes);
    },
    end(error) {
      if (ended) return;
      ended = true;
      if (error !== undefined) {
        const message = error instanceof Error ? error.message : String(error);
        langfuse.update({
          level: "ERROR",
          statusMessage: message,
          output: { error: message },
        });
        const attributes = { output: { error: message } };
        updateOpik(opikTarget, attributes, error);
        if (fallbackTrace) {
          updateOpik({ kind: "trace", value: fallbackTrace }, attributes, error);
        }
      }
      opikParents.delete(langfuse.otelSpan);
      langfuse.end();
      opikTarget.value.end();
      fallbackTrace?.end();
    },
  };
}

function createLangfuseObservation(input: ObservationInput): SupportedObservation {
  const attributes = { input: input.input, metadata: input.metadata };
  switch (input.asType) {
    case "agent":
      return startLangfuseObservation(input.name, attributes, { asType: "agent" });
    case "chain":
      return startLangfuseObservation(input.name, attributes, { asType: "chain" });
    case "generation":
      return startLangfuseObservation(input.name, attributes, { asType: "generation" });
    case "tool":
      return startLangfuseObservation(input.name, attributes, { asType: "tool" });
    case "retriever":
      return startLangfuseObservation(input.name, attributes, { asType: "retriever" });
  }
}

function activeOpikParent(): OpikTrace | OpikSpan | undefined {
  const activeSpan = otelTrace.getSpan(context.active());
  return activeSpan ? opikParents.get(activeSpan) : undefined;
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
    const updates: Parameters<OpikTrace["update"]>[0] = {};
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

  const updates: Parameters<OpikSpan["update"]>[0] = {};
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
  const usage = opikUsage(attributes.usageDetails);
  if (usage) updates.usage = usage;
  const cost = numberRecord(attributes.costDetails);
  if (cost?.total !== undefined) updates.totalEstimatedCost = cost.total;
  if (errorInfo) updates.errorInfo = errorInfo;
  target.value.update(updates);
}

function errorFromAttributes(
  attributes: Record<string, unknown>,
): Parameters<OpikSpan["update"]>[0]["errorInfo"] {
  const message = typeof attributes.statusMessage === "string"
    ? attributes.statusMessage
    : "Observation failed";
  if (attributes.level === "WARNING") {
    return { exceptionType: "Cancelled", message, traceback: message };
  }
  if (attributes.level !== "ERROR") return undefined;
  return { exceptionType: "Error", message, traceback: message };
}

function numberRecord(value: unknown): Record<string, number> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function opikUsage(value: unknown): Record<string, number> | undefined {
  const usage = numberRecord(value);
  if (!usage) return undefined;
  const result: Record<string, number> = {};
  if (usage.input !== undefined) result.prompt_tokens = usage.input;
  if (usage.output !== undefined) result.completion_tokens = usage.output;
  if (usage.total !== undefined) result.total_tokens = usage.total;
  return Object.keys(result).length > 0 ? result : undefined;
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
