export function isDevelopmentRuntime(source: NodeJS.ProcessEnv): boolean {
  return source.NODE_ENV !== "production";
}

export function requestPath(url: string | undefined): string {
  return new URL(url ?? "/", "http://localhost").pathname;
}

export function shouldLogAccess(path: string): boolean {
  return !path.startsWith("/_next/") && !path.startsWith("/__nextjs_") && path !== "/favicon.ico" && !path.startsWith("/.well-known/");
}
