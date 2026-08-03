"use client";

import { useState, type FormEvent } from "react";
import { ArrowUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type {
  ConversationMessage,
  ReportItemTarget,
} from "@/features/analysis/domain/contracts";
import type { WorkspaceAgentRun } from "@/features/analysis/domain/workspace";

type Submission = {
  target: ReportItemTarget;
  content: string;
  idempotencyKey: string;
};

type RequestState = "idle" | "submitting" | "failed" | "submitted";

export function ConversationPanel({
  jobId,
  messages = [],
  activeRun,
  selectedTarget,
  agentOutput = "",
  onRefresh,
}: {
  jobId: string;
  messages?: readonly ConversationMessage[];
  activeRun?: WorkspaceAgentRun | null;
  selectedTarget?: ReportItemTarget;
  agentOutput?: string;
  onRefresh: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState("");
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [lastSubmission, setLastSubmission] = useState<Submission>();
  const hasBlockingRun =
    activeRun?.status === "queued"
    || activeRun?.status === "running"
    || activeRun?.status === "interrupted"
    || activeRun?.status === "recoverable";
  const isProcessing = activeRun?.status === "queued" || activeRun?.status === "running";
  const persistedStatus = latestUserStatus(messages);
  const statusText =
    requestState === "submitting"
      ? "质疑处理中…"
      : requestState === "failed"
        ? "质疑提交失败，请重试。"
        : persistedStatus === "queued" || persistedStatus === "running"
          ? "质疑处理中…"
          : persistedStatus === "recoverable"
            ? "质疑处理暂时中断。"
            : persistedStatus === "completed"
              ? "质疑已处理。"
              : requestState === "submitted"
                ? "质疑已提交，等待报告更新。"
                : messages.length
                  ? "对话已更新。"
                  : "";

  async function submit(submission: Submission) {
    if (hasBlockingRun) return;
    setRequestState("submitting");
    setLastSubmission(submission);
    try {
      const response = await fetch(`/api/analyses/${jobId}/challenges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submission),
      });
      if (!response.ok) throw new Error("Challenge request failed");
      setDraft("");
      await onRefresh();
      setRequestState("submitted");
    } catch {
      setRequestState("failed");
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!selectedTarget || !content || requestState === "submitting" || hasBlockingRun) return;
    void submit({
      target: selectedTarget,
      content,
      idempotencyKey: crypto.randomUUID(),
    });
  }

  function retryMessage(message: ConversationMessage) {
    if (!message.idempotencyKey || hasBlockingRun) return;
    void submit({
      target: message.target,
      content: message.content,
      idempotencyKey: message.idempotencyKey,
    });
  }

  return (
    <section
      id="conversation-panel"
      className="flex h-full min-h-0 flex-col"
      aria-label="对话"
    >
      {messages.length ? (
        <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
          {messages.map((message) => (
            <li key={message.id} className="rounded-2xl bg-forest-soft/65 p-4">
              <p className="text-sm font-medium">
                {message.role === "user" ? "你的质疑" : "客户经理"}
              </p>
              <p className="mt-1 leading-7">{message.content}</p>
              {message.role === "user" && message.status !== "completed" ? (
                <>
                  <p className="mt-1 text-sm text-neutral-600">
                    {messageStatusLabel(message.status)}
                  </p>
                  {message.idempotencyKey ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      disabled={requestState === "submitting" || hasBlockingRun}
                      onClick={() => retryMessage(message)}
                    >
                      重试这条质疑
                    </Button>
                  ) : null}
                </>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {agentOutput ? (
        <div className="mt-3 rounded-2xl bg-forest-soft/65 p-4" aria-live="polite">
          <p className="text-sm font-medium">客户经理</p>
          <p className="mt-1 leading-7">{agentOutput}</p>
        </div>
      ) : null}

      {isProcessing ? (
        <p aria-live="polite" aria-atomic="true" className="mt-auto pb-2 text-xs text-ink-faint">
          正在处理此工作空间
        </p>
      ) : statusText ? (
        <p aria-live="polite" aria-atomic="true" className="mt-auto pb-2 text-xs text-ink-faint">
          {statusText}
        </p>
      ) : null}
      <form className="mt-auto shrink-0 flex items-end gap-2 rounded-2xl border border-border bg-white px-3 py-2 shadow-sm" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="challenge-content">继续追问</label>
        <Textarea
          id="challenge-content"
          value={draft}
          maxLength={5_000}
          required
          disabled={requestState === "submitting" || hasBlockingRun}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="继续追问…"
          className="min-h-10 flex-1 resize-none border-0 bg-transparent px-1 py-2 shadow-none focus-visible:border-0 focus-visible:ring-0"
        />
        <Button type="submit" aria-label="发送追问" className="size-9 rounded-full p-0" disabled={!selectedTarget || !draft.trim() || requestState === "submitting" || hasBlockingRun}><ArrowUp size={17} aria-hidden="true" /></Button>
        {requestState === "failed" && lastSubmission ? <Button type="button" variant="outline" size="sm" aria-label="重试质疑" disabled={hasBlockingRun} onClick={() => void submit(lastSubmission)}>重试</Button> : null}
      </form>
    </section>
  );
}

function latestUserStatus(
  messages: readonly ConversationMessage[],
): ConversationMessage["status"] | undefined {
  return messages.findLast((message) => message.role === "user")?.status;
}

function messageStatusLabel(status: ConversationMessage["status"]): string {
  return {
    queued: "等待处理",
    running: "处理中",
    completed: "已完成",
    recoverable: "可重试",
  }[status];
}
