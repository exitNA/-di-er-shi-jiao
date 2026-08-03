import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const run = promisify(execFile);
const read = (file: string) => readFile(join(process.cwd(), file), "utf8");

it("starts Langfuse with generated local credentials and persistent services", async () => {
  const [packageJson, compose, envExample] = await Promise.all([
    read("package.json"),
    read("compose.langfuse.yaml"),
    read(".env.example"),
  ]);

  expect(JSON.parse(packageJson).scripts["langfuse:up"]).toContain("scripts/langfuse-up.sh");
  expect(compose).toMatch(/^  langfuse-web:/m);
  expect(compose).toMatch(/^  langfuse-worker:/m);
  expect(compose).toMatch(/^  clickhouse:/m);
  expect(compose).toMatch(/^  redis:/m);
  expect(compose).toMatch(/^  minio:/m);
  expect(envExample).toContain("LANGFUSE_BASE_URL=http://localhost:3000");
});

it("keeps the Langfuse stack separate from the application Compose project", async () => {
  await expect(read("compose.langfuse.yaml")).resolves.toMatch(/^name: second-perspective-langfuse$/m);
});

it("stores generated local Langfuse credentials in the ignored .env file", async () => {
  await expect(run("git", ["check-ignore", "--quiet", ".env"])).resolves.toBeDefined();
  await expect(read("scripts/langfuse-up.sh")).resolves.not.toContain(".env.langfuse.local");
});

it("binds the Langfuse web interface to the local loopback address", async () => {
  await expect(read("compose.langfuse.yaml")).resolves.toContain('"127.0.0.1:3000:3000"');
});

it("disables ClickHouse clustering for the local single-node stack", async () => {
  await expect(read("compose.langfuse.yaml")).resolves.toContain(
    'CLICKHOUSE_CLUSTER_ENABLED: "false"',
  );
});

it("waits for real Langfuse Web and Worker HTTP readiness", async () => {
  const [{ stdout }, startup] = await Promise.all([
    run(
      "docker",
      ["compose", "-f", "compose.langfuse.yaml", "config", "--format", "json"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          LANGFUSE_BASE_URL: "http://localhost:3000",
          LANGFUSE_PUBLIC_KEY: "pk-test",
          LANGFUSE_SECRET_KEY: "sk-test",
          NEXTAUTH_SECRET: "test",
          SALT: "test",
          ENCRYPTION_KEY: "0".repeat(64),
          POSTGRES_PASSWORD: "test",
          CLICKHOUSE_PASSWORD: "test",
          REDIS_AUTH: "test",
          MINIO_ROOT_PASSWORD: "test",
          LANGFUSE_INIT_USER_PASSWORD: "test",
        },
      },
    ),
    read("scripts/langfuse-up.sh"),
  ]);
  const services = JSON.parse(stdout).services as Record<
    string,
    { healthcheck?: { test?: string[] } }
  >;

  expect(services["langfuse-web"]?.healthcheck?.test?.join(" ")).toContain(
    "/api/public/health",
  );
  expect(services["langfuse-worker"]?.healthcheck?.test?.join(" ")).toContain(
    ":3030/",
  );
  expect(startup).toContain("--env-file .env");
  expect(startup).toContain("--wait --wait-timeout 180");
});
