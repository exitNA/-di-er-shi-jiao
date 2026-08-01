"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { LogoMark } from "@/components/brand/logo-mark";
import { AuthDialog } from "@/features/auth/components/auth-dialog";

export function AppNavigation({ username }: { username?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-paper/80 backdrop-blur-xl">
      <div className="mx-auto flex h-[4.5rem] max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 rounded-full pr-2 transition-opacity hover:opacity-75"><LogoMark size={30} /><span className="font-display text-lg font-semibold tracking-tight">第二视角</span></Link>
        <nav className="flex items-center gap-1 sm:gap-2" aria-label="主导航">
          <Link href="/" className="rounded-full px-3 py-2 text-sm font-medium transition hover:bg-forest-soft">首页</Link><Link href="/history" className="rounded-full px-3 py-2 text-sm font-medium transition hover:bg-forest-soft">思考档案</Link>
          {username ? <div className="relative ml-1"><button type="button" aria-label="打开账户菜单" aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-1 rounded-full border border-border bg-white/60 px-3 py-2 text-sm font-medium shadow-sm transition hover:border-secondary">{username}<ChevronDown size={14} aria-hidden="true" /></button>
            {open ? <div className="absolute right-0 mt-2 w-44 rounded-2xl border border-border bg-paper p-2 shadow-xl shadow-primary/10"><p className="px-3 py-2 text-xs text-ink-faint">{username}</p><form action="/api/auth/logout" method="post"><button type="submit" className="w-full rounded-xl px-3 py-2 text-left text-sm text-danger hover:bg-danger-soft">退出登录</button></form></div> : null}</div>
          : <AuthDialog />}
        </nav>
      </div>
    </header>
  );
}
