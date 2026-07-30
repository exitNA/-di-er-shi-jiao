"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body>
        <main className="grid min-h-screen place-items-center px-6 text-center">
          <section>
            <h1 className="text-2xl font-semibold">应用暂时无法运行</h1>
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
      </body>
    </html>
  );
}
