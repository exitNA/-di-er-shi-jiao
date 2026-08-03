import { execFile } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const run = promisify(execFile);
const devScript = join(process.cwd(), "scripts/dev.sh");

it("loads required development settings from .env without printing them", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "second-perspective-dev-"));
  const bin = join(fixture, "bin");
  const secret = "local-dev-secret-must-not-appear";
  await mkdir(bin);
  await writeFile(join(fixture, ".env"), [
    "ANALYSIS_RUNTIME=in-process",
    "APP_URL=http://127.0.0.1:5000",
    "DATABASE_URL=postgres://app:app@127.0.0.1:54329/second_perspective_test",
    "AUTH_SECRET=local-development-auth-secret-at-least-32-bytes",
    "LLM_BASE_URL=https://llm.example/v1",
    `LLM_API_KEY=${secret}`,
    "LLM_MODEL_ID=test-model",
    "TAVILY_API_KEY=test-tavily-key",
    "TAVILY_API_KEY=test-tavily-key",
    "LANGFUSE_BASE_URL=http://127.0.0.1:3000",
    "LANGFUSE_PUBLIC_KEY=pk-lf-test",
    "LANGFUSE_SECRET_KEY=sk-lf-test",
    "LANGFUSE_TRACING_ENVIRONMENT=local",
  ].join("\n"));
  await writeFile(join(bin, "pnpm"), `#!/bin/sh
set -eu
test "$LLM_API_KEY" = "${secret}"
test "$ANALYSIS_RUNTIME" = "in-process"
test "$LANGFUSE_BASE_URL" = "http://127.0.0.1:3000"
test "$LANGFUSE_PUBLIC_KEY" = "pk-lf-test"
test "$LANGFUSE_SECRET_KEY" = "sk-lf-test"
printf 'development environment loaded\\n'
`);
  await writeFile(join(bin, "ss"), "#!/bin/sh\nexit 0\n");
  await Promise.all([chmod(join(bin, "pnpm"), 0o755), chmod(join(bin, "ss"), 0o755)]);

  try {
    const { stdout } = await run("bash", [devScript], {
      cwd: fixture,
      env: {
        APP_URL: "",
        DATABASE_URL: "",
        AUTH_SECRET: "",
        LLM_BASE_URL: "",
        LLM_API_KEY: "",
        LLM_MODEL_ID: "",
        TAVILY_API_KEY: "",
        COZE_WORKSPACE_PATH: fixture,
        DEPLOY_RUN_PORT: "0",
        PATH: `${bin}:${process.env.PATH ?? ""}`,
      },
    });

    expect(stdout).toContain("development environment loaded");
    expect(stdout).not.toContain(secret);
    await expect(readFile(devScript, "utf8")).resolves.toContain("for env_file in .env; do");
  } finally {
    await rm(fixture, { force: true, recursive: true });
  }
});
