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
    <main className="min-h-screen px-6 py-16">
      <section className="w-full max-w-3xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium tracking-[0.2em] text-neutral-500">第二视角</p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight">历史记录</h1>
          </div>
          <Link className="underline" href="/">
            返回输入页
          </Link>
        </header>
        <HistoryList items={items} />
      </section>
    </main>
  );
}
