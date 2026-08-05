"use client";

import { useState, type FormEvent } from "react";
import { ArrowUp, Square } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type {
  AnalysisSnapshot,
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
  onSnapshot,
  onRefresh,
}: {
  jobId: string;
  messages?: readonly ConversationMessage[];
  activeRun?: WorkspaceAgentRun | null;
  selectedTarget?: ReportItemTarget;
  agentOutput?: string;
  onSnapshot?: (snapshot: AnalysisSnapshot) => void;
  onRefresh: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState("");
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [lastSubmission, setLastSubmission] = useState<Submission>();
  const [isCancelling, setIsCancelling] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const hasBlockingRun =
    activeRun?.status === "queued"
    || activeRun?.status === "running"
    || activeRun?.status === "interrupted"
    || activeRun?.status === "recoverable";
  const isProcessing = activeRun?.status === "queued" || activeRun?.status === "running";
  const isResumable = activeRun?.status === "interrupted" || activeRun?.status === "recoverable";
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

  async function cancelRun() {
    if (!isProcessing || !activeRun || isCancelling) return;
    setIsCancelling(true);
    try {
      const response = await fetch(
        `/api/analyses/${jobId}/runs/${activeRun.id}/cancel`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      if (!response.ok) throw new Error("Cancel request failed");
      const snapshot = await response.json() as AnalysisSnapshot;
      if (onSnapshot) onSnapshot(snapshot);
      else await onRefresh();
    } catch {
      await onRefresh();
    } finally {
      setIsCancelling(false);
    }
  }

  async function resumeRun() {
    if (!isResumable || !activeRun || isResuming) return;
    setIsResuming(true);
    try {
      const response = await fetch(
        `/api/analyses/${jobId}/runs/${activeRun.id}/resume`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      if (!response.ok) throw new Error("Resume request failed");
      const snapshot = await response.json() as AnalysisSnapshot;
      if (onSnapshot) onSnapshot(snapshot);
      else await onRefresh();
    } catch {
      await onRefresh();
    } finally {
      setIsResuming(false);
    }
  }

  return (
    <section
      id="conversation-panel"
      className="flex h-full min-h-0 flex-col"
      aria-label="对话"
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
        {messages.length ? (
          <ol className="space-y-3">
            {messages.map((message) => (
              <li key={message.id} className="rounded-2xl bg-forest-soft/65 p-4">
                <p className="text-sm font-medium">
                  {message.role === "user" ? "你的质疑" : "客户经理"}
                </p>
                {message.role === "agent" ? <MarkdownContent content={message.content} /> : <p className="mt-1 leading-7">{message.content}</p>}
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
          <div className={messages.length ? "mt-3 rounded-2xl bg-forest-soft/65 p-4" : "rounded-2xl bg-forest-soft/65 p-4"} aria-live="polite">
            <p className="text-sm font-medium">客户经理</p>
            <MarkdownContent content={agentOutput} />
          </div>
        ) : null}
      </div>

      {isProcessing ? (
        <p aria-live="polite" aria-atomic="true" className="shrink-0 pb-2 text-xs text-ink-faint">
          正在处理此工作空间
        </p>
      ) : statusText ? (
        <p aria-live="polite" aria-atomic="true" className="shrink-0 pb-2 text-xs text-ink-faint">
          {statusText}
        </p>
      ) : null}
      <form className="shrink-0 rounded-[1.25rem] border border-border bg-white p-4 shadow-[0_8px_24px_-18px_rgba(22,58,54,0.4)]" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="challenge-content">继续追问</label>
        <Textarea
          id="challenge-content"
          value={draft}
          maxLength={5_000}
          required
          onChange={(event) => setDraft(event.target.value)}
          className="min-h-12 w-full resize-none border-0 bg-transparent p-0 text-base shadow-none placeholder:text-ink-faint focus-visible:border-0 focus-visible:ring-0"
        />
        <div className="mt-3 flex items-center justify-end gap-2">
          {requestState === "failed" && lastSubmission ? <Button type="button" variant="outline" size="sm" aria-label="重试质疑" disabled={hasBlockingRun} onClick={() => void submit(lastSubmission)}>重试</Button> : null}
          {isProcessing ? (
            <Button type="button" aria-label="终止任务" className="size-11 rounded-full p-0 text-white hover:text-white" disabled={isCancelling} onClick={() => void cancelRun()}>
              <Square size={15} fill="currentColor" aria-hidden="true" />
            </Button>
          ) : isResumable ? (
            <Button type="button" className="text-white hover:text-white" disabled={isResuming} onClick={() => void resumeRun()}>
              {isResuming ? "继续中…" : "继续分析"}
            </Button>
          ) : (
            <Button type="submit" aria-label="发送追问" className="size-11 rounded-full p-0" disabled={!selectedTarget || !draft.trim() || requestState === "submitting" || hasBlockingRun}><ArrowUp size={20} aria-hidden="true" /></Button>
          )}
        </div>
      </form>
    </section>
  );
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="mt-1 overflow-x-auto leading-7 [&_h1]:mt-5 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:text-lg [&_h3]:font-semibold [&_p]:mt-3 [&_strong]:font-semibold [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:bg-white/70 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
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
