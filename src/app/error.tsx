"use client";

import { useEffect } from "react";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["second-perspective", "ui"]);

export default function Error({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  useEffect(() => {
    logger.error("Route error", { error: error.message, digest: error.digest });
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center px-6 text-center">
      <section className="max-w-md rounded-[1.75rem] border border-border bg-white/70 p-8 shadow-xl shadow-primary/10">
        <p className="font-mono text-xs font-medium tracking-[0.16em] text-secondary">第二视角 · 暂停一下</p>
        <h1 className="mt-3 font-display text-3xl font-semibold">页面暂时无法显示</h1>
        <p className="mt-3 leading-7 text-ink-faint">请稍后重试。</p>
        <button
          className="mt-6 rounded-full bg-primary px-5 py-2.5 font-medium text-white transition hover:bg-primary/90"
          onClick={reset}
          type="button"
        >
          重新加载
        </button>
      </section>
    </main>
  );
}
