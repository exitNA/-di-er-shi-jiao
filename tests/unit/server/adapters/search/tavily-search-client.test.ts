import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { TavilySearchClient } from "@/server/adapters/search/tavily-search-client";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("TavilySearchClient", () => {
  it("sends Tavily's requested payload and returns normalized search results", async () => {
    server.use(
      http.post("https://api.tavily.com/search", async ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer test-key");
        expect(await request.json()).toEqual({
          query: "second perspective",
          topic: "general",
          search_depth: "advanced",
          max_results: 5,
          include_answer: false,
          include_raw_content: "markdown",
        });

        return HttpResponse.json({
          results: [
            {
              title: "Example",
              url: "https://EXAMPLE.com/article?utm_source=newsletter&keep=yes",
              content: "Summary",
              raw_content: "x".repeat(20_001),
              published_date: "2026-07-30T00:00:00Z",
              score: 0.92,
            },
            {
              title: "Insecure",
              url: "http://example.com/insecure",
              content: "Ignored",
              score: 0,
            },
          ],
        });
      }),
    );
    const client = new TavilySearchClient({ apiKey: "test-key" });

    const results = await client.search({
      query: "second perspective",
      topic: "general",
      maxResults: 5,
    });

    expect(results).toMatchObject([
      {
        title: "Example",
        url: "https://example.com/article?keep=yes",
        domain: "example.com",
        content: "Summary",
        publishedAt: "2026-07-30T00:00:00Z",
        score: 0.92,
      },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]?.rawContent).toHaveLength(20_000);
  });

  it("rejects oversized queries before calling Tavily", async () => {
    const client = new TavilySearchClient({ apiKey: "test-key" });

    await expect(
      client.search({ query: "x".repeat(401), topic: "general", maxResults: 5 }),
    ).rejects.toMatchObject({ code: "SEARCH_QUERY_TOO_LONG" });
  });
});
