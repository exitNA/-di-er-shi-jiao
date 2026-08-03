import { describe, expect, it, vi } from "vitest";

import { createSourceSearchTool } from "./search";

describe("createSourceSearchTool", () => {
  it("uses the server-owned material to form source queries", async () => {
    const searchClient = { search: vi.fn(async () => []) };

    await createSourceSearchTool({ searchClient, material: "policy" }).execute(
      "call",
      {},
      undefined,
      undefined,
      undefined as never,
    );

    expect(searchClient.search).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.stringContaining("policy"),
    }));
  });
});
