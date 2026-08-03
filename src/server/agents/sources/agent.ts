import {
  sourcesModuleSchema,
  type ExternalSource,
  type SourcesModule,
} from "@/features/analysis/domain/contracts";
import type { SearchClient } from "@/server/search/search-client";
import type { ExpertInput, ExpertResult } from "../expert-suite";
import {
  createExpertHarness,
  type ExpertHarness,
  type ExpertSessionFactory,
  expertResourceDir,
  zodCompletionSchema,
} from "../shared/expert-harness";
import { loadPromptTemplate, sourceMaterial, systemInstruction, withDelegatedTask } from "../shared/prompt";
import { createSourceSearchTool, type SourceCandidate } from "./tools/search";

const sourcesSystemInstruction = systemInstruction(loadPromptTemplate("sources/prompts/system"));

export function createSourcesExpert(
  createSession: ExpertSessionFactory,
  searchClient?: SearchClient,
): ExpertHarness<SourcesModule> {
  return {
    async run(request) {
      let candidates: SourceCandidate[] = [];
      const searchTool = searchClient && createSourceSearchTool({
        searchClient,
        material: request.material ?? "",
        onCandidates: (value) => { candidates = value; },
      });
      const harness = createExpertHarness({
        schema: sourcesModuleSchema,
        completionSchema: zodCompletionSchema(sourcesModuleSchema),
        createSession: (sessionInput) => createSession({
          ...sessionInput,
          customTools: searchTool ? [...sessionInput.customTools, searchTool] : sessionInput.customTools,
        }),
        resourceDir: expertResourceDir("sources"),
        systemPrompt: sourcesSystemInstruction,
      });
      const generated = await harness.run(request);
      return {
        ...generated,
        value: searchTool
          ? constrainSources(generated.value, candidates)
          : { ...generated.value, sources: [], relations: [], gaps: [] },
      };
    },
  };
}

export async function researchSources(
  harness: ExpertHarness<SourcesModule>,
  input: ExpertInput,
): Promise<ExpertResult<SourcesModule>> {
  const generated = await harness.run({
    operation: "sources",
    systemPrompt: sourcesSystemInstruction,
    prompt: withDelegatedTask(sourcesPrompt(input.material), input.task),
    abortSignal: input.abortSignal,
  });
  return generated;
}

function sourcesPrompt(material: string): string {
  return `${sourceMaterial(material)}\n\n使用 search_sources 查找外部证据；若该工具不可用，仅基于提交素材完成分析。`;
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
