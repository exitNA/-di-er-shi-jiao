"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AnalysisSnapshot,
  ReportModuleType,
} from "@/features/analysis/domain/contracts";

export type AnalysisConnectionState = "connecting" | "connected" | "polling" | "closed";

export type AgentProcessEntry = {
  id: string;
  kind: "reasoning" | "text" | "tool" | "activity";
  title?: string;
  content?: string;
  status?: "running" | "completed" | "failed";
};

export type AgentProcessRun = {
  id: string;
  parentRunId?: string;
  name: string;
  status: "running" | "completed" | "interrupted" | "failed";
  steps: Array<{
    id: string;
    name: string;
    status: "running" | "completed" | "failed";
    entries: AgentProcessEntry[];
  }>;
};

export type AgentProcessState = { runs: AgentProcessRun[] };

type RetryableModuleType = Exclude<ReportModuleType, "overview" | "reflection">;
type AgUiEvent = Record<string, unknown> & { type: string };

const agUiEventTypes = [
  "RUN_STARTED", "RUN_FINISHED", "RUN_ERROR", "STEP_STARTED", "STEP_FINISHED",
  "TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END", "TEXT_MESSAGE_CHUNK",
  "TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_END", "TOOL_CALL_RESULT", "TOOL_CALL_CHUNK",
  "REASONING_START", "REASONING_END", "REASONING_MESSAGE_START", "REASONING_MESSAGE_CONTENT",
  "REASONING_MESSAGE_END", "REASONING_MESSAGE_CHUNK", "STATE_SNAPSHOT", "STATE_DELTA",
  "MESSAGES_SNAPSHOT", "ACTIVITY_SNAPSHOT", "ACTIVITY_DELTA", "CUSTOM",
] as const;

export function useAnalysisStream(workspaceId: string, initialSnapshot: AnalysisSnapshot) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [agentOutput, setAgentOutput] = useState("");
  const [agentProcess, setAgentProcess] = useState<AgentProcessState>({ runs: [] });
  const [connectionState, setConnectionState] = useState<AnalysisConnectionState>(
    shouldUseNetwork(initialSnapshot) ? "connecting" : "closed",
  );
  const lastCursor = useRef(initialSnapshot.lastEventId);
  const seenEventIds = useRef(new Set<string>());
  const controllers = useRef(new Set<AbortController>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
    };
  }, []);

  useEffect(() => {
    setSnapshot(initialSnapshot);
    setAgentOutput("");
    setAgentProcess({ runs: [] });
    lastCursor.current = initialSnapshot.lastEventId;
    seenEventIds.current.clear();
  }, [workspaceId, initialSnapshot]);

  const request = useCallback(async (url: string, init?: RequestInit) => {
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      controllers.current.delete(controller);
    }
  }, []);

  const applySnapshot = useCallback((next: AnalysisSnapshot) => {
    if (!mounted.current) return;
    lastCursor.current = Math.max(lastCursor.current, next.lastEventId);
    setSnapshot((current) => mergeSnapshots(current, next));
  }, []);

  const fetchSnapshot = useCallback(async () => {
    const response = await request(`/api/analyses/${workspaceId}`, { cache: "no-store" });
    if (!response.ok) throw new Error("无法刷新分析结果");
    const next = await response.json() as AnalysisSnapshot;
    applySnapshot(next);
    return next;
  }, [applySnapshot, workspaceId, request]);

  const retryModule = useCallback(async (moduleType: RetryableModuleType) => {
    const response = await request(`/api/analyses/${workspaceId}/modules/${moduleType}/retry`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(body?.error ?? "模块重试失败");
    }
    await fetchSnapshot();
  }, [fetchSnapshot, workspaceId, request]);

  const networkActive = shouldUseNetwork(snapshot);
  useEffect(() => {
    if (!networkActive) {
      setConnectionState("closed");
      return;
    }
    let active = true;
    let failures = 0;
    let pollingDelay = 1000;
    let polling = false;
    let pollingGeneration = 0;
    let source: EventSource | undefined;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const applyAgUi = (event: MessageEvent<string>) => {
      if (!active) return false;
      const cursor = Number(event.lastEventId);
      if (Number.isSafeInteger(cursor)) lastCursor.current = Math.max(lastCursor.current, cursor);
      const eventId = event.lastEventId || undefined;
      if (eventId && seenEventIds.current.has(eventId)) return true;
      let payload: unknown;
      try { payload = JSON.parse(event.data); } catch { return false; }
      if (!isAgUiEvent(payload)) return false;
      if (eventId) seenEventIds.current.add(eventId);
      setAgentProcess((current) => reduceAgentProcess(current, payload));
      if (payload.type === "TEXT_MESSAGE_CONTENT" || payload.type === "TEXT_MESSAGE_CHUNK") {
        const delta = stringValue(payload.delta);
        if (delta) setAgentOutput((current) => current + redact(delta));
      }
      if (payload.type === "MESSAGES_SNAPSHOT") {
        const messages = Array.isArray(payload.messages) ? payload.messages : [];
        const output = messages
          .filter((message): message is Record<string, unknown> => isRecord(message) && message.role === "assistant")
          .map((message) => stringValue(message.content) ?? "")
          .join("");
        if (output) setAgentOutput(redact(output));
      }
      return true;
    };

    const poll = (generation = pollingGeneration) => {
      pollTimer = setTimeout(async () => {
        if (!active || generation !== pollingGeneration) return;
        const next = await fetchSnapshot().catch(() => null);
        if (!active || generation !== pollingGeneration || !polling || (next && !shouldUseNetwork(next))) return;
        pollingDelay = Math.min(pollingDelay * 2, 5000);
        if (active && polling) poll(generation);
      }, pollingDelay);
    };

    const connect = () => {
      if (!active) return;
      setConnectionState("connecting");
      source = new EventSource(`/api/analyses/${workspaceId}/events?after=${lastCursor.current}`);
      source.onopen = () => {
        if (!active) return;
        failures = 0; polling = false; pollingGeneration += 1;
        if (pollTimer) clearTimeout(pollTimer);
        setConnectionState("connected");
      };
      const onEvent = (event: Event) => { void applyAgUi(event as MessageEvent<string>); };
      source.onmessage = onEvent;
      for (const type of agUiEventTypes) source.addEventListener(type, onEvent);
      source.addEventListener("changed", (event) => {
        if (!active) return;
        if (applyAgUi(event as MessageEvent<string>)) return;
        const cursor = Number((event as MessageEvent).lastEventId);
        if (Number.isSafeInteger(cursor)) lastCursor.current = Math.max(lastCursor.current, cursor);
        void fetchSnapshot().catch(() => undefined);
      });
      source.addEventListener("agent-output", (event) => {
        if (!active) return;
        const message = event as MessageEvent<string>;
        const cursor = Number(message.lastEventId);
        if (Number.isSafeInteger(cursor)) lastCursor.current = Math.max(lastCursor.current, cursor);
        try {
          const payload = JSON.parse(message.data) as { text?: unknown };
          const text = payload.text;
          if (typeof text === "string") setAgentOutput((current) => current + redact(text));
        } catch { /* The durable snapshot remains authoritative. */ }
      });
      source.onerror = () => {
        if (!active || polling) return;
        failures += 1; setConnectionState("connecting");
        if (failures < 3) return;
        polling = true; pollingGeneration += 1; source?.close(); source = undefined;
        setConnectionState("polling"); poll(pollingGeneration);
        reconnectTimer = setTimeout(() => { if (active) { failures = 0; connect(); } }, 30_000);
      };
    };
    connect();
    return () => {
      active = false; source?.close();
      if (pollTimer) clearTimeout(pollTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [fetchSnapshot, workspaceId, networkActive]);

  return { snapshot, agentOutput, agentProcess, connectionState, retryModule, applySnapshot, refreshSnapshot: fetchSnapshot };
}

export function reduceAgentProcess(current: AgentProcessState, event: AgUiEvent): AgentProcessState {
  if (event.type === "STATE_SNAPSHOT") return processFromSnapshot(event.snapshot) ?? current;
  if (event.type === "STATE_DELTA") return processFromDelta(current, event.delta);
  if (event.type === "MESSAGES_SNAPSHOT") {
    const messages = Array.isArray(event.messages) ? event.messages : [];
    return messages.reduce((state, message) => isRecord(message) ? reduceMessageSnapshot(state, message) : state, current);
  }
  const runId = stringValue(event.runId) ?? current.runs.findLast((run) => run.status === "running")?.id ?? "workspace-agent";
  if (event.type === "RUN_STARTED") return upsertRun(current, {
    id: runId, parentRunId: stringValue(event.parentRunId), name: agentName(event), status: "running", steps: [],
  });
  if (event.type === "RUN_FINISHED") return updateRun(current, runId, (run) => ({ ...run, status: event.outcome && isRecord(event.outcome) && event.outcome.type === "interrupt" ? "interrupted" : "completed" }));
  if (event.type === "RUN_ERROR") return updateRun(current, runId, (run) => appendEntry({ ...run, status: "failed" }, "run", {
    id: `run-error:${runId}`, kind: "activity", title: "运行失败", content: display(event.message ?? event.code), status: "failed",
  }));
  if (event.type === "STEP_STARTED" || event.type === "STEP_FINISHED") {
    const stepName = stringValue(event.stepName) ?? "执行步骤";
    return updateRun(current, runId, (run) => upsertStep(run, stepName, event.type === "STEP_STARTED" ? "running" : "completed"));
  }
  if (event.type === "TEXT_MESSAGE_START" || event.type === "TEXT_MESSAGE_CONTENT" || event.type === "TEXT_MESSAGE_END" || event.type === "TEXT_MESSAGE_CHUNK") {
    return updateRun(current, runId, (run) => updateStreamEntry(run, "text", stringValue(event.messageId) ?? "assistant-output", event));
  }
  if (event.type === "REASONING_MESSAGE_START" || event.type === "REASONING_MESSAGE_CONTENT" || event.type === "REASONING_MESSAGE_END" || event.type === "REASONING_MESSAGE_CHUNK") {
    return updateRun(current, runId, (run) => updateStreamEntry(run, "reasoning", stringValue(event.messageId) ?? "reasoning", event));
  }
  if (event.type === "TOOL_CALL_START" || event.type === "TOOL_CALL_ARGS" || event.type === "TOOL_CALL_END" || event.type === "TOOL_CALL_RESULT" || event.type === "TOOL_CALL_CHUNK") {
    return updateRun(current, runId, (run) => updateToolEntry(run, event));
  }
  if (event.type === "ACTIVITY_SNAPSHOT" || event.type === "ACTIVITY_DELTA" || event.type === "CUSTOM") {
    const name = event.type === "CUSTOM" ? stringValue(event.name) ?? "应用事件" : stringValue(event.activityType) ?? "Agent 动态";
    const content = display(event.type === "CUSTOM" ? event.value : event.content ?? event.patch);
    return updateRun(current, runId, (run) => appendEntry(run, "activity", {
      id: `${event.type}:${stringValue(event.messageId) ?? name}:${content}`, kind: "activity", title: name, content, status: "completed",
    }));
  }
  return current;
}

function reduceMessageSnapshot(current: AgentProcessState, message: Record<string, unknown>): AgentProcessState {
  const role = stringValue(message.role);
  if (role !== "assistant" && role !== "reasoning") return current;
  const messageId = stringValue(message.id) ?? stringValue(message.messageId);
  const content = stringValue(message.content);
  if (!messageId || !content) return current;
  const runId = stringValue(message.runId) ?? current.runs.findLast((run) => run.status === "running")?.id ?? "workspace-agent";
  return updateRun(current, runId, (run) => replaceEntry(run, "snapshot", {
    id: `${role}:${messageId}`, kind: role === "reasoning" ? "reasoning" : "text", content: redact(content), status: "completed",
  }));
}

function processFromSnapshot(snapshot: unknown): AgentProcessState | undefined {
  if (!isRecord(snapshot)) return undefined;
  const process = isRecord(snapshot.agentProcess) ? snapshot.agentProcess : isRecord(snapshot.agentProcessTimeline) ? snapshot.agentProcessTimeline : undefined;
  if (!process || !Array.isArray(process.runs)) return undefined;
  const runs = process.runs.flatMap((value) => hydrateRun(value));
  return { runs };
}

function processFromDelta(current: AgentProcessState, delta: unknown): AgentProcessState {
  if (!Array.isArray(delta)) return current;
  for (const patch of delta) {
    if (!isRecord(patch) || (patch.op !== "add" && patch.op !== "replace") || patch.path !== "/agentProcess") continue;
    const next = processFromSnapshot({ agentProcess: patch.value });
    if (next) return next;
  }
  return current;
}

function hydrateRun(value: unknown): AgentProcessRun[] {
  if (!isRecord(value) || !stringValue(value.id)) return [];
  const steps = Array.isArray(value.steps) ? value.steps.flatMap((step) => hydrateStep(step)) : [];
  return [{ id: stringValue(value.id)!, parentRunId: stringValue(value.parentRunId), name: stringValue(value.name) ?? "第二视角 Agent", status: runStatus(value.status), steps }];
}

function hydrateStep(value: unknown): AgentProcessRun["steps"] {
  if (!isRecord(value) || !stringValue(value.id) || !stringValue(value.name)) return [];
  const entries = Array.isArray(value.entries) ? value.entries.flatMap((entry) => hydrateEntry(entry)) : [];
  return [{ id: stringValue(value.id)!, name: stringValue(value.name)!, status: stepStatus(value.status), entries }];
}

function hydrateEntry(value: unknown): AgentProcessEntry[] {
  if (!isRecord(value) || !stringValue(value.id)) return [];
  const kind = stringValue(value.kind);
  if (kind !== "reasoning" && kind !== "text" && kind !== "tool" && kind !== "activity") return [];
  return [{ id: stringValue(value.id)!, kind, title: stringValue(value.title), content: stringValue(value.content) ? redact(stringValue(value.content)!) : undefined, status: entryStatus(value.status) }];
}

function updateStreamEntry(run: AgentProcessRun, kind: "text" | "reasoning", messageId: string, event: AgUiEvent): AgentProcessRun {
  const id = `${kind}:${messageId}`;
  const ending = event.type.endsWith("_END") || (event.type.endsWith("_CHUNK") && event.delta === "");
  const delta = stringValue(event.delta);
  return updateEntry(run, "stream", id, (entry) => ({
    id, kind, content: delta ? `${entry?.content ?? ""}${redact(delta)}` : entry?.content,
    status: ending ? "completed" : "running",
  }));
}

function updateToolEntry(run: AgentProcessRun, event: AgUiEvent): AgentProcessRun {
  const toolCallId = stringValue(event.toolCallId) ?? "tool";
  const id = `tool:${toolCallId}`;
  const isResult = event.type === "TOOL_CALL_RESULT";
  const isEnd = event.type === "TOOL_CALL_END";
  const delta = stringValue(event.delta);
  const result = isResult ? display(event.content) : undefined;
  return updateEntry(run, "tools", id, (entry) => ({
    id, kind: "tool", title: stringValue(event.toolCallName) ?? entry?.title ?? "工具调用",
    content: result
      ? `${entry?.content ? `${entry.content}\n` : ""}输出：${result}`
      : delta
        ? `${entry?.content ?? "输入："}${redact(delta)}`
        : entry?.content,
    status: isResult ? "completed" : isEnd ? entry?.status ?? "running" : "running",
  }));
}

function updateRun(current: AgentProcessState, id: string, updater: (run: AgentProcessRun) => AgentProcessRun): AgentProcessState {
  const index = current.runs.findIndex((run) => run.id === id);
  if (index < 0) return upsertRun(current, updater({ id, name: "第二视角 Agent", status: "running", steps: [] }));
  const runs = [...current.runs]; runs[index] = updater(runs[index]);
  return { runs };
}

function upsertRun(current: AgentProcessState, next: AgentProcessRun): AgentProcessState {
  const index = current.runs.findIndex((run) => run.id === next.id);
  if (index < 0) return { runs: [...current.runs, next] };
  const runs = [...current.runs]; runs[index] = { ...runs[index], ...next, steps: next.steps.length ? next.steps : runs[index].steps };
  return { runs };
}

function upsertStep(run: AgentProcessRun, name: string, status: "running" | "completed"): AgentProcessRun {
  const id = `step:${name}`;
  const index = run.steps.findIndex((step) => step.id === id);
  if (index < 0) return { ...run, steps: [...run.steps, { id, name, status, entries: [] }] };
  const steps = [...run.steps]; steps[index] = { ...steps[index], status };
  return { ...run, steps };
}

function appendEntry(run: AgentProcessRun, stepName: string, entry: AgentProcessEntry): AgentProcessRun {
  return updateEntry(run, stepName, entry.id, (existing) => existing ?? entry);
}

function replaceEntry(run: AgentProcessRun, stepName: string, entry: AgentProcessEntry): AgentProcessRun {
  return updateEntry(run, stepName, entry.id, () => entry);
}

function updateEntry(run: AgentProcessRun, stepName: string, entryId: string, updater: (entry: AgentProcessEntry | undefined) => AgentProcessEntry): AgentProcessRun {
  const stepId = `step:${stepName}`;
  const steps = [...run.steps];
  const index = steps.findIndex((step) => step.id === stepId);
  const step = index < 0 ? { id: stepId, name: stepName, status: "running" as const, entries: [] } : steps[index];
  const entryIndex = step.entries.findIndex((entry) => entry.id === entryId);
  const entries = [...step.entries];
  if (entryIndex < 0) entries.push(updater(undefined)); else entries[entryIndex] = updater(entries[entryIndex]);
  const next = { ...step, entries };
  if (index < 0) steps.push(next); else steps[index] = next;
  return { ...run, steps };
}

function agentName(event: AgUiEvent): string {
  return stringValue(event.agentName) ?? stringValue(event.name) ?? (stringValue(event.parentRunId) ? "子 Agent" : "第二视角 Agent");
}

function isAgUiEvent(value: unknown): value is AgUiEvent {
  return isRecord(value) && typeof value.type === "string" && (agUiEventTypes as readonly string[]).includes(value.type);
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function stringValue(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function display(value: unknown): string | undefined {
  if (typeof value === "string") return redact(value);
  if (value === undefined || value === null) return undefined;
  try { return redact(JSON.stringify(value)); } catch { return "[无法显示的内容]"; }
}
function redact(value: string): string {
  return value
    .replace(/\b(?:sk|rk|pk)_[A-Za-z0-9_-]{12,}\b/g, "[已隐藏密钥]")
    .replace(/(["']?(?:api[_-]?key|authorization|token|secret|password|cookie)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, "$1[已隐藏]");
}
function runStatus(value: unknown): AgentProcessRun["status"] { return value === "completed" || value === "interrupted" || value === "failed" ? value : "running"; }
function stepStatus(value: unknown): "running" | "completed" | "failed" { return value === "completed" || value === "failed" ? value : "running"; }
function entryStatus(value: unknown): "running" | "completed" | "failed" | undefined { return value === "running" || value === "completed" || value === "failed" ? value : undefined; }

function shouldUseNetwork(snapshot: AnalysisSnapshot): boolean {
  return snapshot.activeRun?.status === "queued" || snapshot.activeRun?.status === "running" || snapshot.activeRun?.status === "recoverable"
    || snapshot.messages.some((message) => message.status === "queued" || message.status === "running" || message.status === "recoverable")
    || snapshot.status === "queued" || snapshot.status === "running" || snapshot.status === "partial" || snapshot.status === "recoverable";
}

function mergeSnapshots(current: AnalysisSnapshot, next: AnalysisSnapshot): AnalysisSnapshot {
  if (next.lastEventId < current.lastEventId) return current;
  const modules = Object.fromEntries(Object.entries(next.modules).map(([moduleType, module]) => {
    const currentModule = current.modules[moduleType as ReportModuleType];
    return [moduleType, module.version < currentModule.version ? currentModule : module];
  })) as AnalysisSnapshot["modules"];
  return { ...next, lastEventId: Math.max(current.lastEventId, next.lastEventId), modules, messages: mergeRecords(current.messages ?? [], next.messages ?? []), revisions: mergeRecords(current.revisions ?? [], next.revisions ?? []) };
}

function mergeRecords<T extends { id: string }>(current: readonly T[], next: readonly T[]): T[] {
  const records = new Map(current.map((record) => [record.id, record]));
  for (const record of next) records.set(record.id, record);
  return [...records.values()];
}
