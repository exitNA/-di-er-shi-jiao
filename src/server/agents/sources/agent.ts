import { getDomain } from "tldts";
import {
  sourcesModuleSchema,
  type ExternalSource,
  type SourcesModule,
} from "@/features/analysis/domain/contracts";
import type { SearchResult } from "@/server/search/search-client";
import type { ExpertInput, ExpertResult } from "../expert-suite";
import {
  createExpertHarness,
  type ExpertHarness,
  type ExpertSessionFactory,
  expertResourceDir,
  zodCompletionSchema,
} from "../shared/expert-harness";
import { externalSource, loadPromptTemplate, sourceMaterial, systemInstruction } from "../shared/prompt";
import type { SearchTool } from "./tools/search";

type SourceCandidate = SearchResult & {
  id: string;
  canonicalUrl: string;
  registrableDomain: string;
  qualityTier: number;
};

const sourcesSystemInstruction = systemInstruction(loadPromptTemplate("sources/prompts/system"));

export function createSourcesExpert(createSession: ExpertSessionFactory): ExpertHarness<SourcesModule> {
  return createExpertHarness({
    schema: sourcesModuleSchema,
    completionSchema: zodCompletionSchema(sourcesModuleSchema),
    createSession,
    resourceDir: expertResourceDir("sources"),
    systemPrompt: sourcesSystemInstruction,
  });
}

export async function researchSources(
  harness: ExpertHarness<SourcesModule>,
  searchTool: SearchTool | undefined,
  input: ExpertInput,
): Promise<ExpertResult<SourcesModule>> {
  const candidates = searchTool
    ? selectCandidates((await mapWithConcurrency(sourceQueries(input.material), 2, (query) =>
      searchTool.search({ query, topic: "general", maxResults: 5, signal: input.abortSignal }),
    )).flat().slice(0, 15))
    : [];
  const generated = await harness.run({
    operation: "sources",
    systemPrompt: sourcesSystemInstruction,
    prompt: sourcesPrompt(input.material, candidates.slice(0, 8)),
    abortSignal: input.abortSignal,
  });

  return {
    ...generated,
    value: searchTool
      ? constrainSources(generated.value, candidates)
      : { ...generated.value, sources: [], relations: [], gaps: [] },
  };
}

function sourcesPrompt(material: string, candidates: SourceCandidate[]): string {
  return `${sourceMaterial(material)}\n\n${candidates.map(externalSource).join("\n") || "<external_source />"}`;
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
      registrableDomain: registrableDomain(domain),
      qualityTier: sourceTier(domain),
    });
  }

  const byDomain = new Map<string, SourceCandidate>();
  for (const candidate of [...byUrl.values()].sort(compareCandidates)) {
    if (!byDomain.has(candidate.registrableDomain)) byDomain.set(candidate.registrableDomain, candidate);
  }
  return [...byDomain.values()].sort(compareCandidates).slice(0, 8);
}

function constrainSources(value: SourcesModule, candidates: SourceCandidate[]): SourcesModule {
  const candidatesByUrl = new Map(candidates.map((candidate) => [candidate.canonicalUrl, candidate]));
  const sourceIdMap = new Map<string, string>();
  const sources: ExternalSource[] = [];
  for (const source of value.sources) {
    const url = source.url;
    if (typeof url !== "string") continue;
    const canonicalUrl = canonicalizeUrl(url);
    if (!canonicalUrl) continue;
    const candidate = candidatesByUrl.get(canonicalUrl);
    if (!candidate || sources.some((selected) => selected.id === candidate.id)) continue;
    sourceIdMap.set(source.id, candidate.id);
    sources.push(toExternalSource(candidate));
    if (sources.length === 5) break;
  }
  const sourceIds = new Set(sources.map((source) => source.id));
  const relations = value.relations
    .map((relation) => ({ ...relation, sourceId: sourceIdMap.get(relation.sourceId) ?? relation.sourceId }))
    .filter((relation) => sourceIds.has(relation.sourceId));
  for (const candidate of candidates) {
    if (sources.length >= 3) break;
    if (sources.some((source) => source.id === candidate.id)) continue;
    sources.push(toExternalSource(candidate));
  }
  const gaps = sources.length > 2 ? value.gaps.filter(isActionableEvidenceGap) : [evidenceGap()];
  return { ...value, sources, relations, gaps };
}

function toExternalSource(candidate: SourceCandidate): ExternalSource {
  return {
    id: candidate.id,
    title: candidate.title,
    url: candidate.canonicalUrl,
    domain: candidate.domain,
    publisher: candidate.domain,
    publishedAt: candidate.publishedAt ?? null,
    qualityTier: candidate.qualityTier,
    excerpt: candidate.content.slice(0, 2_000) || candidate.title,
  };
}

function isActionableEvidenceGap(gap: SourcesModule["gaps"][number]): boolean {
  return /不足|缺乏|未知/.test(gap.text) && /获取|查找|补充|核对/.test(gap.text);
}

function evidenceGap(): SourcesModule["gaps"][number] {
  return {
    id: "source-gap",
    text: "合格外部信源不足；获取更多证据：查找官方原始数据、同行评审研究或当事方公开记录。",
    origin: "ai_inference",
    confidence: { score: 0.9, rationale: "当前候选未达到独立信源目标" },
  };
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

function registrableDomain(hostname: string): string {
  return getDomain(hostname, { allowPrivateDomains: true }) ?? hostname.toLowerCase();
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
