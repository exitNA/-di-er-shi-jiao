import { HomeAnalysisWorkspace } from "@/features/analysis/components/home-analysis-workspace";
import { getCurrentUser } from "@/features/auth/server/current-user";
import { AppNavigation } from "@/components/navigation/app-navigation";

export default async function Home() {
  const user = await getCurrentUser();

  return (
    <div className="min-h-screen bg-paper">
      <AppNavigation username={user?.username} />
      <main className="mx-auto max-w-7xl px-4 pb-16 pt-14 sm:px-6 sm:pt-20">
        <div className="max-w-4xl">
          <p className="font-mono text-xs font-medium tracking-[0.16em] text-secondary">思考桌 · {user ? `欢迎回来，${user.username}` : "从一个问题开始"}</p>
          <h1 className="mt-4 max-w-3xl font-display text-4xl font-semibold leading-[1.15] tracking-tight text-ink sm:text-5xl">粘贴一段内容，看看它的第二视角。</h1>
          <p className="mt-5 max-w-2xl text-base leading-8 text-ink-faint">把一段让你犹豫、认同或想转发的内容放到桌上。我们帮你拆开论据、分歧与未知，把判断留给你。</p>
        </div>
        <div className="mt-8"><HomeAnalysisWorkspace /></div>
      </main>
    </div>
  );
}
