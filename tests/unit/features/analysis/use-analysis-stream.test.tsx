import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnalysisSnapshot,
  ReportModuleType,
} from "@/features/analysis/domain/contracts";
import type { WorkspaceAgentRun } from "@/features/analysis/domain/workspace";
import { useAnalysisStream } from "@/features/analysis/hooks/use-analysis-stream";

class MockEventSource {
  static instances: MockEventSource[] = [];

  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, (event: Event) => void>();

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.set(type, listener as (event: Event) => void);
  }

  close() {
    this.closed = true;
  }

  emitChanged(lastEventId = "1") {
    this.listeners.get("changed")?.(
      new MessageEvent("changed", { lastEventId }),
    );
  }

  emitAgentOutput(text: string, lastEventId = "1") {
    this.listeners.get("agent-output")?.(
      new MessageEvent("agent-output", {
        data: JSON.stringify({ text }),
        lastEventId,
      }),
    );
  }

  emitAgUi(payload: Record<string, unknown>, lastEventId = "1") {
    const type = typeof payload.type === "string" ? payload.type : "message";
    this.listeners.get(type)?.(
      new MessageEvent(type, {
        data: JSON.stringify(payload),
        lastEventId,
      }),
    );
  }
}

describe("useAnalysisStream", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("applies newer snapshots after an SSE event", async () => {
    const initial = snapshot();
    const newer = snapshot({
      lastEventId: 1,
      modules: {
        ...initial.modules,
        argument: { status: "completed", version: 1 },
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(newer), { status: 200 }),
      ),
    );

    const { result } = renderHook(() =>
      useAnalysisStream("job-1", initial),
    );
    await act(async () => {
      MockEventSource.instances[0].emitChanged("1");
    });

    expect(result.current.snapshot.modules.argument).toEqual({
      status: "completed",
      version: 1,
    });
  });

  it("renders streamed Agent output without waiting for a snapshot refresh", async () => {
    const initial = snapshot();
    const { result } = renderHook(() => useAnalysisStream("job-1", initial));

    await act(async () => {
      MockEventSource.instances[0].emitAgentOutput("正在核对论证。", "1");
      MockEventSource.instances[0].emitAgentOutput("已完成。", "2");
    });

    expect(result.current.agentOutput).toBe("正在核对论证。已完成。");
  });

  it("groups standard AG-UI Agent, reasoning and tool events without replaying duplicate SSE events", async () => {
    const initial = snapshot();
    const { result } = renderHook(() => useAnalysisStream("job-1", initial));
    const source = MockEventSource.instances[0];

    await act(async () => {
      source.emitAgUi({ type: "RUN_STARTED", runId: "main", agentName: "客户经理" }, "1");
      source.emitAgUi({ type: "STEP_STARTED", runId: "main", stepName: "核对证据" }, "2");
      source.emitAgUi({ type: "REASONING_MESSAGE_CONTENT", runId: "main", messageId: "reason-1", delta: "先比较证据。" }, "3");
      source.emitAgUi({ type: "TOOL_CALL_START", runId: "main", toolCallId: "tool-1", toolCallName: "search" }, "4");
      source.emitAgUi({ type: "TOOL_CALL_ARGS", runId: "main", toolCallId: "tool-1", delta: '{"query":"原文"}' }, "5");
      source.emitAgUi({ type: "TOOL_CALL_RESULT", runId: "main", toolCallId: "tool-1", content: "找到两条来源" }, "6");
      source.emitAgUi({ type: "TEXT_MESSAGE_CONTENT", runId: "main", messageId: "answer-1", delta: "模型输出" }, "7");
      source.emitAgUi({ type: "TEXT_MESSAGE_CONTENT", runId: "main", messageId: "answer-1", delta: "模型输出" }, "7");
    });

    expect(result.current.agentOutput).toBe("模型输出");
    expect(result.current.agentProcess.runs).toHaveLength(1);
    const entries = result.current.agentProcess.runs[0].steps.flatMap((step) => step.entries);
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "reasoning", content: "先比较证据。" }),
      expect.objectContaining({ kind: "tool", title: "search", content: '输入：{"query":"原文"}\n输出：找到两条来源', status: "completed" }),
      expect.objectContaining({ kind: "text", content: "模型输出" }),
    ]));
  });

  it("ignores module versions older than the current snapshot", async () => {
    const initial = snapshot({
      lastEventId: 1,
      modules: {
        ...emptyModules(),
        argument: { status: "completed", version: 2 },
      },
    });
    const staleModule = snapshot({
      lastEventId: 2,
      modules: {
        ...initial.modules,
        argument: { status: "running", version: 1 },
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(staleModule), { status: 200 }),
      ),
    );

    const { result } = renderHook(() =>
      useAnalysisStream("job-1", initial),
    );
    await act(async () => {
      MockEventSource.instances[0].emitChanged("2");
    });

    expect(result.current.snapshot.modules.argument).toEqual({
      status: "completed",
      version: 2,
    });
  });

  it("falls back to exponential polling after three SSE connection failures", async () => {
    vi.useFakeTimers();
    const initial = snapshot();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(initial), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useAnalysisStream("job-1", initial),
    );
    act(() => {
      const source = MockEventSource.instances[0];
      source.onerror?.();
      source.onerror?.();
      source.onerror?.();
    });

    expect(result.current.connectionState).toBe("polling");
    await act(() => vi.advanceTimersByTimeAsync(999));
    expect(fetchMock).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1999));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("keeps receiving updates for recoverable jobs", () => {
    const initial = snapshot({ status: "recoverable" });
    const { result } = renderHook(() =>
      useAnalysisStream("job-1", initial),
    );

    expect(result.current.connectionState).toBe("connecting");
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it("keeps receiving updates for a queued Agent run after the workspace is interrupted", () => {
    const initial = snapshot({
      status: "interrupted",
      activeRun: agentRun("queued"),
    });
    const { result } = renderHook(() =>
      useAnalysisStream("job-1", initial),
    );

    expect(result.current.connectionState).toBe("connecting");
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it("does not reschedule an in-flight poll after SSE reconnects", async () => {
    vi.useFakeTimers();
    const initial = snapshot();
    let resolveFetch: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn().mockImplementation(
      () => new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useAnalysisStream("job-1", initial));
    act(() => {
      const source = MockEventSource.instances[0];
      source.onerror?.();
      source.onerror?.();
      source.onerror?.();
      vi.advanceTimersByTime(1000);
      vi.advanceTimersByTime(29_000);
      MockEventSource.instances[1].onopen?.();
    });
    await act(async () => {
      resolveFetch(new Response(JSON.stringify(initial), { status: 200 }));
    });
    act(() => vi.advanceTimersByTime(10_000));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops network activity on unmount", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    const initial = snapshot();
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = renderHook(() =>
      useAnalysisStream("job-1", initial),
    );
    const source = MockEventSource.instances[0];

    unmount();
    act(() => {
      source.emitChanged();
      source.onerror?.();
    });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(source.closed).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(MockEventSource.instances).toHaveLength(1);
  });
});

function snapshot(
  overrides: Partial<AnalysisSnapshot> = {},
): AnalysisSnapshot {
  return {
    workspaceId: "job-1",
    reportId: "report-1",
    currentVersion: 0,
    status: "running",
    configVersion: "baseline-v1",
    materialPreview: "材料",
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
    lastEventId: 0,
    activeRun: null,
    toolCalls: [],
    messages: [],
    revisions: [],
    modules: emptyModules(),
    ...overrides,
  };
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

function agentRun(status: WorkspaceAgentRun["status"]): WorkspaceAgentRun {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    workspaceId: "job-1",
    kind: "baseline",
    status,
    configVersion: "agent-v1",
    cancellationRequestedAt: null,
    startedAt: null,
    completedAt: null,
  };
}
