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
      <section>
        <h1 className="text-2xl font-semibold">页面暂时无法显示</h1>
        <p className="mt-3 text-neutral-600">请稍后重试。</p>
        <button
          className="mt-6 rounded-full bg-neutral-900 px-5 py-2.5 text-white"
          onClick={reset}
          type="button"
        >
          重新加载
        </button>
      </section>
    </main>
  );
}
