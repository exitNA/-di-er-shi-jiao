import type { SearchClient, SearchResult } from "@/server/search/search-client";

type TavilySearchClientConfig = {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
};

type TavilyResponse = {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    raw_content?: string;
    published_date?: string;
    score?: number;
  }>;
};

export class SearchClientError extends Error {
  constructor(public readonly code: "SEARCH_QUERY_TOO_LONG" | "SEARCH_AUTHENTICATION_FAILED" | "SEARCH_RATE_LIMITED" | "SEARCH_UNKNOWN_ERROR") {
    super(code);
    this.name = "SearchClientError";
  }
}

export class TavilySearchClient implements SearchClient {
  private readonly fetch: typeof globalThis.fetch;

  constructor(private readonly config: TavilySearchClientConfig) {
    this.fetch = config.fetch ?? globalThis.fetch;
  }

  async search(input: Parameters<SearchClient["search"]>[0]): Promise<SearchResult[]> {
    if (input.query.length > 400) throw new SearchClientError("SEARCH_QUERY_TOO_LONG");

    const response = await this.fetch("https://api.tavily.com/search", {
      method: "POST",
      signal: input.signal,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: input.query,
        topic: input.topic,
        search_depth: "advanced",
        max_results: input.maxResults,
        include_answer: false,
        include_raw_content: "markdown",
      }),
    });
    if (!response.ok) throw responseError(response.status);

    const body = (await response.json()) as TavilyResponse;
    return (body.results ?? []).flatMap(toSearchResult);
  }
}

function toSearchResult(result: NonNullable<TavilyResponse["results"]>[number]): SearchResult[] {
  if (!result.url) return [];

  try {
    const url = new URL(result.url);
    if (url.protocol !== "https:") return [];
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_") || ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return [
      {
        title: result.title ?? "",
        url: url.toString(),
        domain: url.hostname,
        content: result.content ?? "",
        ...(result.raw_content ? { rawContent: result.raw_content.slice(0, 20_000) } : {}),
        ...(result.published_date ? { publishedAt: result.published_date } : {}),
        score: result.score ?? 0,
      },
    ];
  } catch {
    return [];
  }
}

function responseError(status: number): SearchClientError {
  if (status === 401 || status === 403) return new SearchClientError("SEARCH_AUTHENTICATION_FAILED");
  if (status === 429) return new SearchClientError("SEARCH_RATE_LIMITED");
  return new SearchClientError("SEARCH_UNKNOWN_ERROR");
}
