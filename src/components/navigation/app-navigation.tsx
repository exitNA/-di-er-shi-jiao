"use client";

import Link from "next/link";
import { useState } from "react";

import { LogoMark } from "@/components/brand/logo-mark";
import { AuthDialog } from "@/features/auth/components/auth-dialog";

export function AppNavigation({ username }: { username?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2"><LogoMark /><span className="font-display font-semibold">第二视角</span></Link>
        <nav className="flex items-center gap-5" aria-label="主导航">
          <Link href="/" className="text-sm font-medium">首页</Link><Link href="/history" className="text-sm font-medium">历史记录</Link>
          {username ? <div className="relative"><button type="button" aria-label="打开账户菜单" aria-expanded={open} onClick={() => setOpen(!open)} className="rounded-full border border-border px-3 py-1.5 text-sm">{username}</button>
            {open ? <div className="absolute right-0 mt-2 w-44 rounded-xl border border-border bg-paper p-2 shadow-lg"><p className="px-2 py-1 text-xs text-ink-faint">{username}</p><form action="/api/auth/logout" method="post"><button type="submit" className="w-full rounded-lg px-2 py-2 text-left text-sm text-danger hover:bg-danger-soft">退出登录</button></form></div> : null}</div>
          : <AuthDialog />}
        </nav>
      </div>
    </header>
  );
}
