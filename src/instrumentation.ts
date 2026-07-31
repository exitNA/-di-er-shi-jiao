export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { configure, getConsoleSink } = await import("@logtape/logtape");
  await configure({
    reset: true,
    sinks: { console: getConsoleSink() },
    loggers: [
      { category: "second-perspective", lowestLevel: "info", sinks: ["console"] },
      { category: ["logtape", "meta"], lowestLevel: "warning", sinks: ["console"] },
    ],
  });
  const { startTelemetry } = await import("@/server/observability/tracing");
  await startTelemetry();
}
