import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { ConversationPanel } from "@/features/conversation/components/conversation-panel";
import { RevisionHistory } from "@/features/conversation/components/revision-history";
import type {
  ConversationMessage,
  AnalysisSnapshot,
  ReportItemTarget,
  ReportModuleType,
  ReportRevision,
} from "@/features/analysis/domain/contracts";
import { useAnalysisStream } from "@/features/analysis/hooks/use-analysis-stream";

const target: ReportItemTarget = {
  moduleType: "risks",
  section: "items",
  itemId: "risk-1",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

it("submits the selected report target and exposes the pending state", async () => {
  let resolveRequest: (response: Response) => void = () => undefined;
  const fetchMock = vi.fn().mockReturnValue(
    new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(
    <ConversationPanel
      jobId="job-1"
      messages={[]}
      selectedTarget={target}
      onRefresh={refresh}
    />,
  );

  await userEvent.type(
    screen.getByRole("textbox", { name: "继续追问" }),
    "这项风险误读了原文。",
  );
  await userEvent.click(screen.getByRole("button", { name: "发送追问" }));

  expect(screen.getByText("质疑处理中…")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("/api/analyses/job-1/challenges");
  expect(JSON.parse(String(init.body))).toMatchObject({
    target,
    content: "这项风险误读了原文。",
  });
  expect(JSON.parse(String(init.body))).not.toHaveProperty("jobId");

  resolveRequest(
    Response.json({
      ok: true,
      messageId: "message-1",
      created: true,
      status: "running",
    }),
  );
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
});

it("retries a failed submission with the same idempotency key", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ error: "暂时不可用" }, { status: 503 }))
    .mockResolvedValueOnce(
      Response.json({
        ok: true,
        messageId: "message-1",
        created: false,
        status: "completed",
      }),
    );
  vi.stubGlobal("fetch", fetchMock);
  render(
    <ConversationPanel
      jobId="job-1"
      messages={[]}
      selectedTarget={target}
      onRefresh={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  await userEvent.type(
    screen.getByRole("textbox", { name: "继续追问" }),
    "请重新核对。",
  );
  await userEvent.click(screen.getByRole("button", { name: "发送追问" }));
  expect(await screen.findByText("质疑提交失败，请重试。")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "重试质疑" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  const first = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
  const second = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
  expect(second.idempotencyKey).toBe(first.idempotencyKey);
});

it("retries the durable challenge when snapshot refresh fails", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    Response.json({
      ok: true,
      messageId: "message-1",
      created: false,
      status: "completed",
    }),
  );
  const refresh = vi
    .fn()
    .mockRejectedValueOnce(new Error("刷新失败"))
    .mockResolvedValueOnce(undefined);
  vi.stubGlobal("fetch", fetchMock);
  render(
    <ConversationPanel
      jobId="job-1"
      messages={[]}
      selectedTarget={target}
      onRefresh={refresh}
    />,
  );

  await userEvent.type(
    screen.getByRole("textbox", { name: "继续追问" }),
    "请重新核对。",
  );
  await userEvent.click(screen.getByRole("button", { name: "发送追问" }));

  expect(await screen.findByText("质疑提交失败，请重试。")).toBeInTheDocument();
  expect(screen.queryByText("质疑已提交，等待报告更新。")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "重试质疑" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));

  expect(fetchMock).toHaveBeenCalledTimes(2);
  const first = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
  const second = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
  expect(second.idempotencyKey).toBe(first.idempotencyKey);
  expect(
    await screen.findByText("质疑已提交，等待报告更新。"),
  ).toBeInTheDocument();
});

it("retries a persisted recoverable challenge with its durable key", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    Response.json({
      ok: true,
      messageId: "11111111-1111-4111-8111-111111111111",
      created: false,
      status: "running",
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(
    <ConversationPanel
      jobId="job-1"
      messages={[
        message({
          status: "recoverable",
          idempotencyKey: "persisted-challenge-key",
        }),
      ]}
      onRefresh={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  await userEvent.click(
    screen.getByRole("button", { name: "重试这条质疑" }),
  );

  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  expect(
    JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)),
  ).toEqual({
    target,
    content: "请重新核对。",
    idempotencyKey: "persisted-challenge-key",
  });
});

it("places the interrupted-run continuation control beside the input", async () => {
  const onSnapshot = vi.fn<(snapshot: AnalysisSnapshot) => void>();
  const fetchMock = vi.fn().mockResolvedValue(Response.json(analysisSnapshot()));
  vi.stubGlobal("fetch", fetchMock);
  render(
    <ConversationPanel
      jobId="job-1"
      messages={[]}
      activeRun={{
        id: "22222222-2222-4222-8222-222222222222",
        workspaceId: "job-1",
        kind: "baseline",
        status: "interrupted",
        configVersion: "agent-v1",
        cancellationRequestedAt: nowIso,
        startedAt: nowIso,
        completedAt: nowIso,
      }}
      selectedTarget={target}
      onSnapshot={onSnapshot}
      onRefresh={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  expect(screen.getByRole("textbox", { name: "继续追问" })).toBeEnabled();
  await userEvent.click(screen.getByRole("button", { name: "继续分析" }));
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/analyses/job-1/runs/22222222-2222-4222-8222-222222222222/resume",
    expect.objectContaining({ method: "POST" }),
  );
  await waitFor(() => expect(onSnapshot).toHaveBeenCalledOnce());
});

it("turns the submit control into an interrupt control while a run is active", async () => {
  const onSnapshot = vi.fn<(snapshot: AnalysisSnapshot) => void>();
  const fetchMock = vi.fn().mockResolvedValue(Response.json(analysisSnapshot()));
  vi.stubGlobal("fetch", fetchMock);
  render(
    <ConversationPanel
      jobId="job-1"
      messages={[]}
      activeRun={{
        id: "22222222-2222-4222-8222-222222222222",
        workspaceId: "job-1",
        kind: "baseline",
        status: "running",
        configVersion: "agent-v1",
        cancellationRequestedAt: null,
        startedAt: nowIso,
        completedAt: null,
      }}
      selectedTarget={target}
      onSnapshot={onSnapshot}
      onRefresh={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  expect(screen.getByRole("textbox", { name: "继续追问" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "发送追问" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "终止任务" }));

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/analyses/job-1/runs/22222222-2222-4222-8222-222222222222/cancel",
    expect.objectContaining({ method: "POST" }),
  );
  await waitFor(() => expect(onSnapshot).toHaveBeenCalledOnce());
});

it("renders persisted messages and a revision with a focusable report link", () => {
  const messages: ConversationMessage[] = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      reportId: "22222222-2222-4222-8222-222222222222",
      role: "user",
      target,
      content: "这项风险误读了原文。",
      status: "completed",
      idempotencyKey: "persisted-challenge-key",
      createdAt: "2026-08-01T01:00:00.000Z",
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      reportId: "22222222-2222-4222-8222-222222222222",
      role: "agent",
      target,
      content: "复核后已修订报告。",
      status: "completed",
      idempotencyKey: null,
      createdAt: "2026-08-01T01:01:00.000Z",
    },
  ];
  const revisions: ReportRevision[] = [
    {
      id: "44444444-4444-4444-8444-444444444444",
      triggeringMessageId: messages[0].id,
      fromVersion: 0,
      toVersion: 1,
      changes: [
        {
          target,
          reason: "原解释超出了原文证据。",
          newEvidenceSourceIds: ["source-new"],
          summary: "收窄风险解释。",
        },
      ],
      status: "completed",
      createdAt: "2026-08-01T01:01:00.000Z",
    },
  ];

  render(
    <>
      <ConversationPanel
        jobId="job-1"
        messages={messages}
        selectedTarget={target}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
      />
      <RevisionHistory revisions={revisions} />
    </>,
  );

  expect(screen.getByText("这项风险误读了原文。")).toBeInTheDocument();
  expect(screen.getByText("复核后已修订报告。")).toBeInTheDocument();
  expect(screen.getByText("质疑已处理。")).toHaveAttribute(
    "aria-live",
    "polite",
  );
  expect(
    screen.getByRole("link", { name: "认知风险 / 风险条目 / risk-1" }),
  ).toHaveAttribute("href", "#report-item-risks-items-risk-1");
  expect(screen.getByText("修订理由：原解释超出了原文证据。")).toBeInTheDocument();
  expect(screen.getByText("新增证据：source-new")).toBeInTheDocument();
});

it("formats Agent output as Markdown", () => {
  render(
    <ConversationPanel
      jobId="job-1"
      messages={[]}
      agentOutput={"## 执行状态\n\n**已完成**\n\n| 能力 | 状态 |\n| --- | --- |\n| 论证 | ✅ 完成 |"}
      onRefresh={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  expect(screen.getByRole("heading", { name: "执行状态" })).toBeVisible();
  expect(screen.getByText("已完成").tagName).toBe("STRONG");
  expect(screen.getByRole("table")).toBeVisible();
});

it("focuses the stable module anchor when a revised item no longer exists", async () => {
  const modules = analysisSnapshot().modules;
  modules.risks = {
    status: "completed",
    version: 2,
    payload: { items: [] },
  };

  render(
    <>
      <section id="report-module-risks" tabIndex={-1} />
      <RevisionHistory revisions={[revision()]} modules={modules} />
    </>,
  );

  const link = screen.getByRole("link", {
    name: "认知风险 / 风险条目 / risk-1",
  });
  expect(link).toHaveAttribute("href", "#report-module-risks");

  await userEvent.click(link);

  expect(document.querySelector("#report-module-risks")).toHaveFocus();
});

it("keeps a completed report connected while conversation work is pending and merges records by ID", async () => {
  const sources: MockEventSource[] = [];
  vi.stubGlobal(
    "EventSource",
    class extends MockEventSource {
      constructor(url: string) {
        super(url);
        sources.push(this);
      }
    },
  );
  const pending = message({ status: "queued" });
  const oldAgent = message({
    id: "55555555-5555-4555-8555-555555555555",
    role: "agent",
    content: "此前回应",
  });
  const oldRevision = revision({
    id: "66666666-6666-4666-8666-666666666666",
  });
  const initial = analysisSnapshot({
    status: "completed",
    lastEventId: 1,
    messages: [pending, oldAgent],
    revisions: [oldRevision],
  });
  const next = analysisSnapshot({
    status: "completed",
    lastEventId: 2,
    messages: [
      { ...pending, status: "completed" },
      message({
        id: "77777777-7777-4777-8777-777777777777",
        role: "agent",
        content: "最新回应",
      }),
    ],
    revisions: [revision()],
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json(next)),
  );

  const { result } = renderHook(() => useAnalysisStream("job-1", initial));

  expect(sources).toHaveLength(1);
  await act(async () => sources[0].emitChanged("2"));
  expect(result.current.snapshot.messages.map(({ id }) => id)).toEqual([
    pending.id,
    oldAgent.id,
    "77777777-7777-4777-8777-777777777777",
  ]);
  expect(result.current.snapshot.messages[0].status).toBe("completed");
  expect(result.current.snapshot.revisions.map(({ id }) => id)).toEqual([
    oldRevision.id,
    "44444444-4444-4444-8444-444444444444",
  ]);
});

class MockEventSource {
  private listeners = new Map<string, (event: Event) => void>();

  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.set(type, listener as (event: Event) => void);
  }

  close() {}

  emitChanged(lastEventId: string) {
    this.listeners.get("changed")?.(
      new MessageEvent("changed", { lastEventId }),
    );
  }
}

function message(
  overrides: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    reportId: "22222222-2222-4222-8222-222222222222",
    role: "user",
    target,
    content: "请重新核对。",
    status: "completed",
    idempotencyKey: "persisted-challenge-key",
    createdAt: "2026-08-01T01:00:00.000Z",
    ...overrides,
  };
}

const nowIso = "2026-08-02T00:00:00.000Z";

function revision(
  overrides: Partial<ReportRevision> = {},
): ReportRevision {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    triggeringMessageId: "11111111-1111-4111-8111-111111111111",
    fromVersion: 0,
    toVersion: 1,
    changes: [
      {
        target,
        reason: "更新原因",
        newEvidenceSourceIds: [],
        summary: "更新摘要",
      },
    ],
    status: "completed",
    createdAt: "2026-08-01T01:01:00.000Z",
    ...overrides,
  };
}

function analysisSnapshot(
  overrides: Partial<AnalysisSnapshot> = {},
): AnalysisSnapshot {
  return {
    workspaceId: "job-1",
    reportId: "22222222-2222-4222-8222-222222222222",
    currentVersion: 0,
    status: "completed",
    configVersion: "baseline-v1",
    materialPreview: "材料",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    lastEventId: 0,
    activeRun: null,
    toolCalls: [],
    messages: [],
    revisions: [],
    modules: Object.fromEntries(
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
        { status: "completed" as const, version: 1 },
      ]),
    ) as AnalysisSnapshot["modules"],
    ...overrides,
  };
}
