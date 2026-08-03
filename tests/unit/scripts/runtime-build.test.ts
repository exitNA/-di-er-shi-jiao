import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const run = promisify(execFile);
const root = process.cwd();
const legacyEndpoint = ["OTEL_EXPORTER_OTLP", "_ENDPOINT"].join("");
const legacyExporter = ["OTLPTrace", "Exporter"].join("");

async function startFixture(server: string, nextChunk: string) {
  const workspace = await mkdtemp(join(tmpdir(), "second-perspective-start-"));
  const bin = join(workspace, "bin");

  try {
    await mkdir(join(workspace, "dist"), { recursive: true });
    await mkdir(join(workspace, ".next/server"), { recursive: true });
    await mkdir(bin);
    await writeFile(join(workspace, "dist/server.js"), server);
    await writeFile(join(workspace, ".next/server/chunk.js"), nextChunk);
    await writeFile(join(bin, "node"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

    return await run("bash", [join(root, "scripts/start.sh")], {
      env: {
        ...process.env,
        COZE_WORKSPACE_PATH: workspace,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
      },
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

it("cleans stale server bundles before building", async () => {
  await expect(readFile(join(root, "scripts/build.sh"), "utf8")).resolves.toContain(
    "--clean",
  );
});

it("refuses to start a stale legacy observability bundle", async () => {
  await expect(startFixture(legacyEndpoint, "current Next bundle")).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("stale build artifacts"),
  });
});

it("allows OTLP internals bundled by the Langfuse dependency", async () => {
  await expect(startFixture(
    "current server bundle",
    `class ${legacyExporter} {}; process.env.${legacyEndpoint}`,
  )).resolves.toBeDefined();
});

it("refuses the removed application OTLP environment schema in a Next bundle", async () => {
  await expect(startFixture(
    "current server bundle",
    `${legacyEndpoint}: z.string().url().optional()`,
  )).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("stale build artifacts"),
  });
});
