export function isPostgresUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();

  while (typeof error === "object" && error !== null && !seen.has(error)) {
    seen.add(error);
    if ("code" in error && error.code === "23505") return true;
    error = "cause" in error ? error.cause : undefined;
  }

  return false;
}
