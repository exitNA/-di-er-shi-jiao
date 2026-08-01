import Link from "next/link";
import { redirect } from "next/navigation";

import { HistoryList } from "@/features/analysis/components/history-list";
import { getCurrentUser } from "@/features/auth/server/current-user";
import { getContainer } from "@/server/container";

export default async function HistoryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const items = await getContainer().analysisRepository.listOwnedHistory(user.id, 20);

  return (
    <main className="min-h-screen px-4 py-14 sm:px-6 sm:py-20">
      <section className="mx-auto w-full max-w-3xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-medium tracking-[0.16em] text-secondary">思考桌 · 已保存的判断过程</p>
            <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight">思考档案</h1>
          </div>
          <Link className="rounded-full border border-border bg-white/60 px-4 py-2 text-sm font-medium transition hover:border-secondary" href="/">
            新建分析
          </Link>
        </header>
        <HistoryList items={items} />
      </section>
    </main>
  );
}
