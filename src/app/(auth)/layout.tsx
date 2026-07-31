import type { ReactNode } from "react";
import { LogoMark } from "@/components/brand/logo-mark";

export default function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16" style={{ background: "linear-gradient(115deg, #edecfb 0%, var(--color-paper) 42%, var(--color-paper) 58%, #e3f4f3 100%)" }}>
      <section className="w-full max-w-md rounded-3xl border border-border bg-paper/95 p-8 shadow-xl">
        <div className="flex flex-col items-center"><LogoMark size={40} /><p className="mt-3 font-display text-xl font-semibold">第二视角</p><p className="mt-1 text-xs text-ink-faint">换一个角度，看见不一样的答案</p></div>
        {children}
      </section>
    </main>
  );
}
