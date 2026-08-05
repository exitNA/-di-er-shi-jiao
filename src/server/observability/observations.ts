import "server-only";

import { context, ROOT_CONTEXT, trace as otelTrace, type Span as OtelSpan } from "@opentelemetry/api";
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

export function startObservation(input: ObservationInput): ObservationHandle {
  return createObservationHandle(createLangfuseObservation(input));
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
      return runObservation(
        createObservationHandle(
          createLangfuseObservation({
            name,
            asType: "chain",
            input: { material: input.material },
            metadata,
          }),
        ),
        run,
      );
    },
  ));
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
): ObservationHandle {
  let ended = false;

  return {
    otelSpan: langfuse.otelSpan,
    update(attributes) {
      if (ended) return;
      langfuse.update(attributes as LangfuseObservationAttributes);
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
      }
      langfuse.end();
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
