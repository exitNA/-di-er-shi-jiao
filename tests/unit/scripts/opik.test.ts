import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

const read = (file: string) => readFile(join(process.cwd(), file), "utf8");

it("defines the local Opik stack and application connection settings", async () => {
  const [packageJson, compose, envExample, serverEnv] = await Promise.all([
    read("package.json"),
    read("docker/opik/compose.yaml"),
    read(".env.example"),
    read("src/server/config/env.ts"),
  ]);

  expect(JSON.parse(packageJson).scripts["opik:up"]).toContain("scripts/opik-up.sh");
  expect(compose).toMatch(/^name: second-perspective-opik$/m);
  expect(compose).toContain('"127.0.0.1:5173:5173"');
  expect(envExample).toContain("OPIK_URL_OVERRIDE=http://localhost:5173/api");
  expect(envExample).toContain("OPIK_PROJECT_NAME=second-perspective");
  expect(serverEnv).toContain("OPIK_URL_OVERRIDE: z.string().url()");
  expect(serverEnv).toContain('OPIK_PROJECT_NAME: z.literal("second-perspective")');
});

it("starts from the official local topology and preserves volumes when stopping", async () => {
  const [startup, shutdown, compose] = await Promise.all([
    read("scripts/opik-up.sh"),
    read("scripts/opik-down.sh"),
    read("docker/opik/compose.yaml"),
  ]);

  expect(startup).not.toContain("git clone");
  expect(startup).toContain("--env-file .env -f docker/opik/compose.yaml up -d --wait --wait-timeout 180");
  expect(shutdown).toContain("--env-file .env -f docker/opik/compose.yaml down");
  expect(shutdown).not.toContain("--volumes");
  for (const service of ["mysql", "redis", "clickhouse", "zookeeper", "minio", "backend", "python-backend", "frontend"]) {
    expect(compose).toMatch(new RegExp(`^  ${service}:`, "m"));
  }
  expect(compose).not.toContain(".opik/");
  expect(compose).toContain("./config/clickhouse:/clickhouse_config_files:ro");
  expect(compose).toContain("./config/nginx_default_local.conf:/etc/nginx/templates/default.conf.template:ro");
});

it("uses the same lightweight public dependency images as Langfuse", async () => {
  const [opik, langfuse] = await Promise.all([
    read("docker/opik/compose.yaml"),
    read("docker/langfuse/compose.yaml"),
  ]);

  for (const image of [
    "docker.io/clickhouse/clickhouse-server:25.12",
    "redis:8.6.4-alpine",
    "minio/minio:RELEASE.2025-09-07T16-13-09Z",
  ]) {
    expect(opik).toContain(image);
    expect(langfuse).toContain(image);
  }

  expect(opik).not.toMatch(/(?:image|OPIK_VERSION): .*latest/);
  expect(langfuse).not.toMatch(/image: .*latest/);
});
