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

it("ignores generated local Langfuse credentials", async () => {
  await expect(run("git", ["check-ignore", "--quiet", ".env.langfuse.local"])).resolves.toBeDefined();
});

it("binds the Langfuse web interface to the local loopback address", async () => {
  await expect(read("compose.langfuse.yaml")).resolves.toContain('"127.0.0.1:3000:3000"');
});

it("disables ClickHouse clustering for the local single-node stack", async () => {
  await expect(read("compose.langfuse.yaml")).resolves.toContain(
    'CLICKHOUSE_CLUSTER_ENABLED: "false"',
  );
});
