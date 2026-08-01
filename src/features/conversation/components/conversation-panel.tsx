"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type {
  ConversationMessage,
  ReportItemTarget,
} from "@/features/analysis/domain/contracts";
import { reportTargetLabel } from "./revision-history";

type Submission = {
  target: ReportItemTarget;
  content: string;
  idempotencyKey: string;
};

type RequestState = "idle" | "submitting" | "failed" | "submitted";

export function ConversationPanel({
  jobId,
  messages = [],
  selectedTarget,
  onRefresh,
}: {
  jobId: string;
  messages?: readonly ConversationMessage[];
  selectedTarget?: ReportItemTarget;
  onRefresh: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState("");
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [lastSubmission, setLastSubmission] = useState<Submission>();
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
                  : "选择报告条目后可发起质疑。";

  async function submit(submission: Submission) {
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
    if (!selectedTarget || !content || requestState === "submitting") return;
    void submit({
      target: selectedTarget,
      content,
      idempotencyKey: crypto.randomUUID(),
    });
  }

  function retryMessage(message: ConversationMessage) {
    if (!message.idempotencyKey) return;
    void submit({
      target: message.target,
      content: message.content,
      idempotencyKey: message.idempotencyKey,
    });
  }

  return (
    <section
      id="conversation-panel"
      className="rounded-[1.5rem] border border-border bg-white/75 p-5 shadow-sm sm:p-6"
      aria-labelledby="conversation-panel-heading"
    >
      <h3 id="conversation-panel-heading" className="font-display text-2xl font-semibold">
        报告质疑
      </h3>
      <p className="mt-2 text-sm leading-6 text-ink-faint">
        {selectedTarget
          ? `当前条目：${reportTargetLabel(selectedTarget)}`
          : "请先从报告中选择要质疑的条目。"}
      </p>

      {messages.length ? (
        <ol className="mt-5 space-y-3">
          {messages.map((message) => (
            <li key={message.id} className="rounded-2xl bg-forest-soft/65 p-4">
              <p className="text-sm font-medium">
                {message.role === "user" ? "你的质疑" : "第二视角 Agent"}
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
                      disabled={requestState === "submitting"}
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

      <form className="mt-5 space-y-3" onSubmit={onSubmit}>
        <label className="block text-sm font-medium" htmlFor="challenge-content">
          质疑内容
        </label>
        <Textarea
          id="challenge-content"
          value={draft}
          maxLength={5_000}
          required
          disabled={!selectedTarget || requestState === "submitting"}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            disabled={
              !selectedTarget || !draft.trim() || requestState === "submitting"
            }
          >
            提交质疑
          </Button>
          {requestState === "failed" && lastSubmission ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void submit(lastSubmission)}
            >
              重试质疑
            </Button>
          ) : null}
        </div>
      </form>

      <p aria-live="polite" aria-atomic="true" className="mt-3 text-sm">
        {statusText}
      </p>
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
