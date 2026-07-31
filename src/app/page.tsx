import { HomeAnalysisWorkspace } from "@/features/analysis/components/home-analysis-workspace";
import { getCurrentUser } from "@/features/auth/server/current-user";
import { AppNavigation } from "@/components/navigation/app-navigation";

export default async function Home() {
  const user = await getCurrentUser();

  return (
    <div className="min-h-screen bg-paper">
      <AppNavigation username={user?.username} />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6"><p className="font-mono text-xs tracking-wide text-secondary">欢迎回来，{user ? user.username : "访客"}</p><h1 className="mt-2 max-w-xl font-display text-2xl font-semibold leading-snug text-ink sm:text-3xl">粘贴一段内容，看看它的第二视角。</h1><p className="mt-2 max-w-xl text-sm leading-relaxed text-neutral-600">我们会拆解信息结构、铺开不同立场、核对认知风险，并给出可以继续追问的思路。</p><div className="mt-6"><HomeAnalysisWorkspace /></div></main></div>
  );
}
