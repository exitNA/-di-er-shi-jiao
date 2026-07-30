export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startTelemetry } = await import("@/server/observability/tracing");
  await startTelemetry();
}
