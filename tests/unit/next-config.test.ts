import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

it("keeps the Node-only Pi runtime outside the server bundle", async () => {
  const config = await readFile(join(process.cwd(), "next.config.ts"), "utf8");

  expect(config).toContain('serverExternalPackages: ["@earendil-works/pi-coding-agent"]');
});
