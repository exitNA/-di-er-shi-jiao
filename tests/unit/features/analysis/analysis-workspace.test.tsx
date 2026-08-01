import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { AnalysisWorkspace } from "@/features/analysis/components/analysis-workspace";
import type {
  AnalysisSnapshot,
  ReportModuleType,
} from "@/features/analysis/domain/contracts";

const mocks = vi.hoisted(() => ({
  retryModule: vi.fn().mockResolvedValue(undefined),
  refreshSnapshot: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/features/analysis/hooks/use-analysis-stream", () => ({
  useAnalysisStream: (_jobId: string, initialSnapshot: AnalysisSnapshot) => ({
    snapshot: initialSnapshot,
    connectionState: initialSnapshot.status === "completed" ? "closed" : "connected",
    retryModule: mocks.retryModule,
    refreshSnapshot: mocks.refreshSnapshot,
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

it("presents an agent workspace with current findings", () => {
  const current = snapshot({
    modules: {
      ...emptyModules(),
      argument: { status: "running", version: 1 },
    },
  });
  render(<AnalysisWorkspace initialSnapshot={current} />);

  expect(screen.getByText("与第二视角一起推理")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "观点地图" })).toBeInTheDocument();
  expect(screen.queryByText("认知体检报告")).not.toBeInTheDocument();
  expect(screen.getByText("速览等待分析")).toBeInTheDocument();
  expect(screen.getByText("论证骨架分析中")).toBeInTheDocument();
});

it("shows the source failure and retries that module", async () => {
  const current = snapshot({
    status: "partial",
    modules: {
      ...emptyModules(),
      sources: { status: "failed", version: 1, errorCode: "SEARCH_UNAVAILABLE" },
    },
  });
  render(<AnalysisWorkspace initialSnapshot={current} />);

  expect(screen.getByText("信源服务暂时不可用")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "重试信源对照" }));
  expect(mocks.retryModule).toHaveBeenCalledWith("sources");
});

it("uses one polite status region, keeps focus and shows the fixed disclaimer", () => {
  const current = snapshot();
  const { container, rerender } = render(
    <AnalysisWorkspace initialSnapshot={current} />,
  );
  const overviewModule = screen.getByRole("region", { name: "速览" });
  overviewModule.focus();

  rerender(
    <AnalysisWorkspace
      initialSnapshot={snapshot({ ...current, status: "completed" })}
    />,
  );

  expect(container.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
  expect(overviewModule).toHaveFocus();
  expect(screen.getByText("分析已更新")).toBeInTheDocument();
  expect(
    screen.getByText(
      "本报告由 AI 生成，旨在提供多角度思考框架。请核对引用，并结合自身知识独立判断。",
    ),
  ).toBeInTheDocument();
});

it("challenges a risk by stable target and keeps focus when the snapshot updates", async () => {
  let resolveChallenge: (response: Response) => void = () => undefined;
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url.endsWith("/challenges")) {
      return new Promise<Response>((resolve) => {
        resolveChallenge = resolve;
      });
    }
    return Promise.resolve(Response.json({ ok: true }));
  });
  vi.stubGlobal("fetch", fetchMock);
  const current = completedRiskSnapshot();
  const { rerender } = render(<AnalysisWorkspace initialSnapshot={current} />);

  await userEvent.click(screen.getByRole("button", { name: "质疑：认知风险" }));
  await userEvent.type(
    screen.getByRole("textbox", { name: "继续追问" }),
    "这项风险误读了原文。",
  );
  const submit = screen.getByRole("button", { name: "发送追问" });
  await userEvent.click(submit);

  expect(screen.getByText("质疑处理中…")).toBeInTheDocument();
  const challengeCall = fetchMock.mock.calls.find(([url]) =>
    String(url).endsWith("/challenges"),
  );
  expect(challengeCall).toBeDefined();
  expect(JSON.parse(String((challengeCall?.[1] as RequestInit).body))).toMatchObject({
    target: { moduleType: "risks", section: "items", itemId: "risk-1" },
    content: "这项风险误读了原文。",
  });

  resolveChallenge(
    Response.json({
      ok: true,
      messageId: "11111111-1111-4111-8111-111111111111",
      revisionId: "33333333-3333-4333-8333-333333333333",
      created: true,
      status: "completed",
    }),
  );
  await waitFor(() => expect(mocks.refreshSnapshot).toHaveBeenCalledOnce());
  submit.focus();

  rerender(
    <AnalysisWorkspace
      initialSnapshot={{
        ...current,
        currentVersion: 1,
        lastEventId: 2,
        messages: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            reportId: current.reportId,
            role: "user",
            target: { moduleType: "risks", section: "items", itemId: "risk-1" },
            content: "这项风险误读了原文。",
            status: "completed",
            idempotencyKey: "persisted-challenge-key",
            createdAt: "2026-08-01T01:00:00.000Z",
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            reportId: current.reportId,
            role: "agent",
            target: { moduleType: "risks", section: "items", itemId: "risk-1" },
            content: "复核后已修订报告。",
            status: "completed",
            idempotencyKey: null,
            createdAt: "2026-08-01T01:01:00.000Z",
          },
        ],
        revisions: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            triggeringMessageId: "11111111-1111-4111-8111-111111111111",
            fromVersion: 0,
            toVersion: 1,
            changes: [
              {
                target: { moduleType: "risks", section: "items", itemId: "risk-1" },
                reason: "原解释超出了原文证据。",
                newEvidenceSourceIds: ["source-new"],
                summary: "收窄风险解释。",
              },
            ],
            status: "completed",
            createdAt: "2026-08-01T01:01:00.000Z",
          },
        ],
      }}
    />,
  );

  expect(submit).toHaveFocus();
  expect(screen.getByText("修订理由：原解释超出了原文证据。")).toBeInTheDocument();
  expect(screen.getByText("新增证据：source-new")).toBeInTheDocument();
});

it("selects shared statements and source relations by stable target", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true })));
  const claim = {
    id: "claim-1",
    text: "待核对主张",
    origin: "source_material" as const,
    sourceMaterialQuote: "原文",
    confidence: { score: 0.8, rationale: "测试依据" },
  };
  render(
    <AnalysisWorkspace
      initialSnapshot={snapshot({
        status: "completed",
        modules: {
          ...emptyModules(),
          overview: {
            status: "completed",
            version: 1,
            payload: {
              coreClaims: [claim],
              mainDisputes: [],
              topRisks: [],
              keyUnknowns: [],
              safetyNotice: null,
            },
          },
          sources: {
            status: "completed",
            version: 1,
            payload: {
              claims: [claim],
              sources: [
                {
                  id: "source-1",
                  title: "外部研究",
                  url: "https://example.com/research",
                  domain: "example.com",
                  publisher: "示例研究院",
                  publishedAt: null,
                  qualityTier: 2,
                  excerpt: "研究摘要",
                },
              ],
              relations: [
                {
                  claimId: "claim-1",
                  sourceId: "source-1",
                  relation: "challenges",
                },
              ],
              gaps: [],
            },
          },
        },
      })}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: "质疑：核心主张" }));
  expect(
    screen.getByText("正在讨论：速览 / 核心主张 / claim-1"),
  ).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "质疑：信源关系" }));
  expect(
    screen.getByText(
      "正在讨论：信源对照 / 信源关系 / claim-1:source-1",
    ),
  ).toBeInTheDocument();
});

it("targets a source gap with the gaps domain field", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true })));
  render(
    <AnalysisWorkspace
      initialSnapshot={snapshot({
        status: "completed",
        modules: {
          ...emptyModules(),
          sources: {
            status: "completed",
            version: 1,
            payload: {
              claims: [],
              sources: [],
              relations: [],
              gaps: [
                {
                  id: "gap-1",
                  text: "缺少原始数据。",
                  origin: "ai_inference",
                  confidence: { score: 0.7, rationale: "尚无一手资料" },
                },
              ],
            },
          },
        },
      })}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: "质疑：证据缺口" }));

  expect(
    screen.getByText("正在讨论：信源对照 / 证据缺口 / gap-1"),
  ).toBeInTheDocument();
});

it("renders legacy snapshots without conversation arrays", () => {
  const legacy = snapshot() as Partial<AnalysisSnapshot>;
  delete legacy.messages;
  delete legacy.revisions;

  render(
    <AnalysisWorkspace initialSnapshot={legacy as AnalysisSnapshot} />,
  );

  expect(screen.getByRole("heading", { name: "对话" })).toBeInTheDocument();
  expect(screen.getByText("还没有修订记录。")).toBeInTheDocument();
});

function snapshot(
  overrides: Partial<AnalysisSnapshot> = {},
): AnalysisSnapshot {
  return {
    jobId: "job-1",
    reportId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    currentVersion: 0,
    status: "running",
    configVersion: "baseline-v1",
    materialPreview: "待分析材料",
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
    lastEventId: 0,
    messages: [],
    revisions: [],
    modules: emptyModules(),
    ...overrides,
  };
}

function completedRiskSnapshot(): AnalysisSnapshot {
  return snapshot({
    status: "completed",
    modules: {
      ...emptyModules(),
      risks: {
        status: "completed",
        version: 1,
        payload: {
          items: [
            {
              id: "risk-1",
              type: "emotional_inducement",
              sourceMaterialQuote: "只有冷血的人才会质疑。",
              explanation: "用道德评价替代事实依据。",
              confidence: { score: 0.9, rationale: "原文措辞明确" },
            },
          ],
        },
      },
    },
  });
}

function emptyModules(): AnalysisSnapshot["modules"] {
  return Object.fromEntries(
    (
      [
        "overview",
        "argument",
        "perspectives",
        "sources",
        "risks",
        "reflection",
      ] satisfies ReportModuleType[]
    ).map((moduleType) => [
      moduleType,
      { status: "queued" as const, version: 0 },
    ]),
  ) as AnalysisSnapshot["modules"];
}
