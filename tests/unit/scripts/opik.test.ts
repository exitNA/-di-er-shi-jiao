import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

const read = (file: string) => readFile(join(process.cwd(), file), "utf8");

it("defines the local Opik stack and application connection settings", async () => {
  const [packageJson, compose, envExample, serverEnv] = await Promise.all([
    read("package.json"),
    read("compose.opik.yaml"),
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
    read("compose.opik.yaml"),
  ]);

  expect(startup).toContain("git clone --depth=1 https://github.com/comet-ml/opik.git");
  expect(startup).toContain("--env-file .env -f compose.opik.yaml up -d --wait --wait-timeout 180");
  expect(shutdown).toContain("--env-file .env -f compose.opik.yaml down");
  expect(shutdown).not.toContain("--volumes");
  for (const service of ["mysql", "redis", "clickhouse", "zookeeper", "minio", "backend", "python-backend", "frontend"]) {
    expect(compose).toMatch(new RegExp(`^  ${service}:`, "m"));
  }
});

it("uses the same lightweight public dependency images as Langfuse", async () => {
  const [opik, langfuse] = await Promise.all([
    read("compose.opik.yaml"),
    read("compose.langfuse.yaml"),
  ]);

  for (const image of [
    "docker.io/clickhouse/clickhouse-server:25.12",
    "redis:8.6.4-alpine",
    "cgr.dev/chainguard/minio@sha256:5f2b82fe2edccafed7902f423f171ae5e6b8b363fae72441c0e0e4289dc45555",
  ]) {
    expect(opik).toContain(image);
    expect(langfuse).toContain(image);
  }

  expect(opik).not.toMatch(/(?:image|OPIK_VERSION): .*latest/);
  expect(langfuse).not.toMatch(/image: .*latest/);
});
