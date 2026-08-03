import "server-only";
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

type ObservationHandle = {
  update(input: Record<string, unknown>): void;
};

export async function withLangfuseObservation<T>(
  input: ObservationInput,
  run: (observation: ObservationHandle) => Promise<T>,
): Promise<T> {
  const observe = async (observation: SupportedObservation): Promise<T> => {
    observation.update({
      input: input.input,
      metadata: input.metadata,
    });
    const handle: ObservationHandle = {
      update: (attributes) => {
        observation.update(attributes as LangfuseObservationAttributes);
      },
    };

    try {
      const result = await run(handle);
      if (result !== undefined) observation.update({ output: result });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      observation.update({
        level: "ERROR",
        statusMessage: message,
        output: { error: message },
      });
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

export async function withAnalysisTrace<T>(
  input: {
    workspaceId: string;
    userId: string;
    kind: "baseline" | "challenge";
    material: string;
  },
  run: () => Promise<T>,
): Promise<T> {
  const name = `analysis.${input.kind}`;
  return propagateAttributes(
    {
      traceName: name,
      userId: input.userId,
      sessionId: input.workspaceId,
      metadata: {
        kind: input.kind,
        workspaceId: input.workspaceId,
      },
    },
    () => withLangfuseObservation(
      { name, asType: "chain", input: { material: input.material } },
      run,
    ),
  );
}
