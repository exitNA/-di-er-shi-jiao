import { AnalysisForm } from "@/features/analysis/components/analysis-form";
import { getCurrentUser } from "@/features/auth/server/current-user";
import { redirect } from "next/navigation";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <main className="min-h-screen px-6 py-16">
      <section className="w-full max-w-3xl">
        <header className="flex items-center justify-between gap-4">
          <p className="text-sm font-medium tracking-[0.2em] text-neutral-500">第二视角</p>
          <nav className="flex items-center gap-4" aria-label="账户导航">
            <span>你好，{user.username}</span>
            <a className="underline" href="/history">历史记录</a>
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="underline">退出登录</button>
            </form>
          </nav>
        </header>
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          帮你弄懂复杂议题，但不替你下结论。
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-neutral-600">
          AI 认知防火墙，帮助你看清信息结构、观点偏差与隐藏假设。
        </p>
        <AnalysisForm />
      </section>
    </main>
  );
}
