"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AnalysisSnapshot,
  ReportModuleType,
} from "@/features/analysis/domain/contracts";

export type AnalysisConnectionState =
  | "connecting"
  | "connected"
  | "polling"
  | "closed";

type RetryableModuleType = Exclude<
  ReportModuleType,
  "overview" | "reflection"
>;

export function useAnalysisStream(
  workspaceId: string,
  initialSnapshot: AnalysisSnapshot,
) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [agentOutput, setAgentOutput] = useState("");
  const [connectionState, setConnectionState] =
    useState<AnalysisConnectionState>(
      shouldUseNetwork(initialSnapshot) ? "connecting" : "closed",
    );
  const lastCursor = useRef(initialSnapshot.lastEventId);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new job needs its server snapshot before subscribing.
    setSnapshot(initialSnapshot);
    setAgentOutput("");
    lastCursor.current = initialSnapshot.lastEventId;
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
    const response = await request(`/api/analyses/${workspaceId}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("无法刷新分析结果");

    const next = await response.json() as AnalysisSnapshot;
    applySnapshot(next);
    return next;
  }, [applySnapshot, workspaceId, request]);

  const retryModule = useCallback(
    async (moduleType: RetryableModuleType) => {
      const response = await request(
        `/api/analyses/${workspaceId}/modules/${moduleType}/retry`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "模块重试失败");
      }
      await fetchSnapshot();
    },
    [fetchSnapshot, workspaceId, request],
  );

  const networkActive = shouldUseNetwork(snapshot);
  useEffect(() => {
    if (!networkActive) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- terminal snapshots close the active connection.
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

    const poll = (generation = pollingGeneration) => {
      pollTimer = setTimeout(async () => {
        if (!active || generation !== pollingGeneration) return;
        const next = await fetchSnapshot().catch(() => null);
        if (!active || generation !== pollingGeneration || !polling || (next && !shouldUseNetwork(next))) return;
        pollingDelay = Math.min(pollingDelay * 2, 5000);
        if (!active || !polling) return;
        poll(generation);
      }, pollingDelay);
    };

    const connect = () => {
      if (!active) return;
      setConnectionState("connecting");
      source = new EventSource(
        `/api/analyses/${workspaceId}/events?after=${lastCursor.current}`,
      );
      source.onopen = () => {
        if (!active) return;
        failures = 0;
        polling = false;
        pollingGeneration += 1;
        if (pollTimer) clearTimeout(pollTimer);
        setConnectionState("connected");
      };
      source.addEventListener("changed", (event) => {
        if (!active) return;
        const cursor = Number((event as MessageEvent).lastEventId);
        if (Number.isSafeInteger(cursor)) {
          lastCursor.current = Math.max(lastCursor.current, cursor);
        }
        void fetchSnapshot().catch(() => undefined);
      });
      source.addEventListener("agent-output", (event) => {
        if (!active) return;
        const message = event as MessageEvent<string>;
        const cursor = Number(message.lastEventId);
        if (Number.isSafeInteger(cursor)) {
          lastCursor.current = Math.max(lastCursor.current, cursor);
        }
        try {
          const payload = JSON.parse(message.data) as { text?: unknown };
          if (typeof payload.text === "string") {
            setAgentOutput((current) => current + payload.text);
          }
        } catch {
          // Ignore malformed transient output; the durable snapshot remains authoritative.
        }
      });
      source.onerror = () => {
        if (!active || polling) return;
        failures += 1;
        setConnectionState("connecting");
        if (failures < 3) return;

        polling = true;
        pollingGeneration += 1;
        source?.close();
        source = undefined;
        setConnectionState("polling");
        poll(pollingGeneration);
        reconnectTimer = setTimeout(() => {
          if (!active) return;
          failures = 0;
          connect();
        }, 30_000);
      };
    };

    connect();
    return () => {
      active = false;
      source?.close();
      if (pollTimer) clearTimeout(pollTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [fetchSnapshot, workspaceId, networkActive]);

  return {
    snapshot,
    agentOutput,
    connectionState,
    retryModule,
    applySnapshot,
    refreshSnapshot: fetchSnapshot,
  };
}

function shouldUseNetwork(snapshot: AnalysisSnapshot): boolean {
  return snapshot.activeRun?.status === "queued"
    || snapshot.activeRun?.status === "running"
    || snapshot.activeRun?.status === "recoverable"
    || snapshot.messages.some((message) =>
      message.status === "queued"
      || message.status === "running"
      || message.status === "recoverable"
    )
    || snapshot.status === "queued"
    || snapshot.status === "running"
    || snapshot.status === "partial"
    || snapshot.status === "recoverable";
}

function mergeSnapshots(
  current: AnalysisSnapshot,
  next: AnalysisSnapshot,
): AnalysisSnapshot {
  if (next.lastEventId < current.lastEventId) return current;

  const modules = Object.fromEntries(
    Object.entries(next.modules).map(([moduleType, module]) => {
      const currentModule = current.modules[moduleType as ReportModuleType];
      return [
        moduleType,
        module.version < currentModule.version ? currentModule : module,
      ];
    }),
  ) as AnalysisSnapshot["modules"];

  return {
    ...next,
    lastEventId: Math.max(current.lastEventId, next.lastEventId),
    modules,
    messages: mergeRecords(current.messages ?? [], next.messages ?? []),
    revisions: mergeRecords(current.revisions ?? [], next.revisions ?? []),
  };
}

function mergeRecords<T extends { id: string }>(
  current: readonly T[],
  next: readonly T[],
): T[] {
  const records = new Map(current.map((record) => [record.id, record]));
  for (const record of next) records.set(record.id, record);
  return [...records.values()];
}
