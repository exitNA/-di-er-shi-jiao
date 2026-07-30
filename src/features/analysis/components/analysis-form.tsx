"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const maxLength = 20_000;

const messages = {
  EMPTY: "请输入需要分析的文本。",
  TOO_LONG: "文本不能超过 20,000 字符。",
  UNSAFE_CONTENT: "文本包含无法处理的控制字符。",
  REQUEST_FAILED: "提交失败，请稍后重试。",
};

export function AnalysisForm() {
  const router = useRouter();
  const idempotencyKey = useRef<string | null>(null);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const isBlank = !content.trim();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBlank) {
      setError(messages.EMPTY);
      return;
    }

    idempotencyKey.current ??= crypto.randomUUID();
    setPending(true);
    setError(undefined);

    try {
      const response = await fetch("/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, idempotencyKey: idempotencyKey.current }),
      });
      const body = await response.json().catch(() => null) as { jobId?: string; code?: keyof typeof messages } | null;
      if (response.ok && body?.jobId) {
        router.push(`/analysis/${body.jobId}`);
        return;
      }
      setError(body?.code ? messages[body.code] : messages.REQUEST_FAILED);
    } catch {
      setError(messages.REQUEST_FAILED);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="mt-10 space-y-4" onSubmit={submit}>
      <label className="block text-sm font-medium" htmlFor="analysis-content">
        想分析的内容
      </label>
      <textarea
        id="analysis-content"
        name="content"
        value={content}
        onChange={(event) => {
          idempotencyKey.current = null;
          setContent(event.target.value);
        }}
        maxLength={maxLength}
        rows={10}
        className="w-full rounded-lg border border-neutral-300 bg-white p-4 leading-7"
        aria-describedby="analysis-content-help analysis-content-count"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-neutral-600">
        <p id="analysis-content-help">支持 1–20,000 个字符，请粘贴需要核查的完整文本。</p>
        <output id="analysis-content-count" aria-live="polite">{content.length.toLocaleString("en-US")} / 20,000</output>
      </div>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <button
        type="submit"
        disabled={pending || isBlank}
        className="rounded-lg bg-neutral-900 px-5 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "正在提交…" : "开始分析"}
      </button>
    </form>
  );
}
