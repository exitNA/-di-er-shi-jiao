export function isDevelopmentRuntime(source: NodeJS.ProcessEnv): boolean {
  const cozeEnvironment = source.COZE_PROJECT_ENV?.toLowerCase();
  return source.NODE_ENV !== "production" && cozeEnvironment !== "prod" && cozeEnvironment !== "production";
}

export function requestPath(url: string | undefined): string {
  return new URL(url ?? "/", "http://localhost").pathname;
}

export function shouldLogAccess(path: string): boolean {
  return !path.startsWith("/_next/") && !path.startsWith("/__nextjs_") && path !== "/favicon.ico" && !path.startsWith("/.well-known/");
}
