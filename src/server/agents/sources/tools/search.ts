import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { getDomain } from "tldts";
import { Type } from "typebox";

import { externalSource } from "../../shared/prompt";
import { withLangfuseObservation } from "@/server/observability/langfuse";
import type { SearchClient, SearchResult } from "@/server/search/search-client";

export type SourceCandidate = SearchResult & {
  id: string;
  canonicalUrl: string;
  registrableDomain: string;
  qualityTier: number;
};

type SourceSearchToolInput = {
  searchClient: SearchClient;
  material: string;
  onCandidates?(candidates: SourceCandidate[]): void;
};

export function createSourceSearchTool(input: SourceSearchToolInput): ToolDefinition {
  return defineTool({
    name: "search_sources",
    label: "Search sources",
    description: "Search trusted external sources relevant to the submitted material.",
    promptSnippet: "Use search_sources to find external evidence for the submitted material.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      const queries = sourceQueries(input.material);
      const { candidates } = await withLangfuseObservation(
        {
          name: "sources.search",
          asType: "retriever",
          input: { material: input.material, queries },
        },
        async () => {
          const candidates = selectCandidates((await mapWithConcurrency(queries, 2, (query) =>
            input.searchClient.search({ query, topic: "general", maxResults: 5, signal }),
          )).flat().slice(0, 15));
          input.onCandidates?.(candidates);
          return { candidates };
        },
      );
      return {
        content: [{
          type: "text",
          text: candidates.map(externalSource).join("\n") || "<external_source />",
        }],
        details: { candidates },
      };
    },
  });
}

function sourceQueries(material: string): string[] {
  const topic = material.replace(/\s+/g, " ").trim().slice(0, 120) || "待核实主题";
  return [`${topic} 官方数据`, `${topic} 研究 证据`, `${topic} 争议 反方`];
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, callback: (item: T) => Promise<R>): Promise<R[]> {
  const values: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        values[index] = await callback(items[index]);
      }
    }),
  );
  return values;
}

function selectCandidates(results: SearchResult[]): SourceCandidate[] {
  const byUrl = new Map<string, SourceCandidate>();
  for (const result of results) {
    const canonicalUrl = canonicalizeUrl(result.url);
    if (!canonicalUrl || byUrl.has(canonicalUrl)) continue;
    const domain = new URL(canonicalUrl).hostname;
    byUrl.set(canonicalUrl, {
      ...result,
      id: `source-${byUrl.size + 1}`,
      url: canonicalUrl,
      domain,
      canonicalUrl,
      registrableDomain: getDomain(domain, { allowPrivateDomains: true }) ?? domain.toLowerCase(),
      qualityTier: sourceTier(domain),
    });
  }
  const byDomain = new Map<string, SourceCandidate>();
  for (const candidate of [...byUrl.values()].sort(compareCandidates)) {
    if (!byDomain.has(candidate.registrableDomain)) byDomain.set(candidate.registrableDomain, candidate);
  }
  return [...byDomain.values()].sort(compareCandidates).slice(0, 8);
}

function canonicalizeUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return undefined;
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function sourceTier(domain: string): number {
  if (/\.(gov|edu)(\.|$)/i.test(domain) || domain.endsWith(".gov.cn")) return 1;
  if (/(who\.int|un\.org|oecd\.org|worldbank\.org)$/i.test(domain)) return 1;
  if (/(reuters\.com|apnews\.com|nature\.com|science\.org)$/i.test(domain)) return 2;
  return 3;
}

function compareCandidates(left: SourceCandidate, right: SourceCandidate): number {
  return left.qualityTier - right.qualityTier || right.score - left.score;
}
