export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { configure, getAnsiColorFormatter, getConsoleSink } = await import(
    "@logtape/logtape",
  );
  await configure({
    reset: true,
    sinks: {
      console: getConsoleSink({
        formatter: getAnsiColorFormatter({
          timestamp: "time",
          format: ({ timestamp, level, category, message, record }) => {
            const properties = Object.entries(record.properties)
              .map(([key, value]) => `${key}=${String(value)}`)
              .join(" ");
            return `${timestamp} ${level} ${category}: ${message}${properties ? ` ${properties}` : ""}`;
          },
        }),
      }),
    },
    loggers: [
      { category: "second-perspective", lowestLevel: "info", sinks: ["console"] },
      { category: ["logtape", "meta"], lowestLevel: "warning", sinks: ["console"] },
    ],
  });
  const { startObservability } = await import("@/server/observability/tracing");
  await startObservability();
}
