"use client";

import { useState, type ReactNode } from "react";

import { ConfidenceMeter } from "./confidence-meter";
import { TraceabilityBadge } from "./traceability-badge";
import type {
  ReportModuleStatus,
  ReportModuleType,
  TraceableStatement,
} from "@/features/analysis/domain/contracts";

type ReportModuleProps = {
  id: string;
  moduleType: ReportModuleType;
  title: string;
  status: ReportModuleStatus;
  children?: ReactNode;
  onRetry?: () => Promise<void>;
};

export function ReportModule({
  id,
  moduleType,
  title,
  status,
  children,
  onRetry,
}: ReportModuleProps) {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string>();
  const sourceFailed = moduleType === "sources" && status === "failed";
  const statusText = sourceFailed
    ? "信源服务暂时不可用"
    : status === "queued"
      ? `${title}等待分析`
      : status === "running"
        ? `${title}分析中`
        : status === "completed"
          ? `${title}已完成`
          : `${title}暂时不可用`;

  async function retry() {
    if (!onRetry || retrying) return;
    setRetrying(true);
    setRetryError(undefined);
    try {
      await onRetry();
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : "模块重试失败");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <section
      id={id}
      className="scroll-mt-6 rounded-xl border border-neutral-300 bg-white p-6"
      aria-labelledby={`${id}-heading`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id={`${id}-heading`} className="text-2xl font-semibold">
          {title}
        </h2>
        <p className="text-sm text-neutral-600">{statusText}</p>
      </div>
      {children ? <div className="mt-6 space-y-6">{children}</div> : null}
      {status === "failed" && onRetry ? (
        <button
          type="button"
          className="mt-5 rounded-lg border border-neutral-900 px-4 py-2 font-medium disabled:opacity-50"
          disabled={retrying}
          onClick={() => void retry()}
        >
          {retrying
            ? "正在重试…"
            : sourceFailed
              ? "重试信源对照"
              : `重试${title}`}
        </button>
      ) : null}
      {retryError ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {retryError}
        </p>
      ) : null}
    </section>
  );
}

export function StatementSection({
  id,
  title,
  items,
}: {
  id: string;
  title: string;
  items: readonly TraceableStatement[];
}) {
  return (
    <section aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`} className="text-lg font-medium">
        {title}
      </h3>
      {items.length ? (
        <ul className="mt-3 space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              id={`${id}-${item.id}`}
              className="rounded-lg bg-neutral-50 p-4"
            >
              <p className="leading-7">{item.text}</p>
              {item.sourceMaterialQuote ? (
                <blockquote className="mt-3 border-l-2 border-neutral-300 pl-3 text-sm text-neutral-600">
                  {item.sourceMaterialQuote}
                </blockquote>
              ) : null}
              <div className="mt-3">
                <TraceabilityBadge origin={item.origin} />
              </div>
              <ConfidenceMeter confidence={item.confidence} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-neutral-600">暂无可展示内容。</p>
      )}
    </section>
  );
}
