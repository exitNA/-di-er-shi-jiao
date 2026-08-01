import { redirect } from "next/navigation";

import { HistoryList } from "@/features/analysis/components/history-list";
import { getCurrentUser } from "@/features/auth/server/current-user";
import { AppNavigation } from "@/components/navigation/app-navigation";
import { getContainer } from "@/server/container";

export default async function HistoryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const items = await getContainer().analysisRepository.listOwnedHistory(user.id, 20);

  return (<><AppNavigation username={user.username} />
    <main className="min-h-screen px-4 py-14 sm:px-6 sm:py-20">
      <section className="mx-auto w-full max-w-3xl">
        <header><p className="font-mono text-xs font-medium tracking-[0.16em] text-secondary">思考桌 · 已保存的判断过程</p><h1 className="mt-3 font-display text-4xl font-semibold tracking-tight">思考档案</h1></header>
        <HistoryList items={items} />
      </section>
    </main>
  </>);
}
