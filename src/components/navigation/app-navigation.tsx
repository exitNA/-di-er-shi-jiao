"use client";

import Link from "next/link";
import { useState } from "react";

import { LogoMark } from "@/components/brand/logo-mark";

export function AppNavigation({ username }: { username?: string }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2"><LogoMark /><span className="font-display font-semibold">第二视角</span></Link>
        <nav className="flex items-center gap-5" aria-label="主导航">
          <Link href="/" className="text-sm font-medium">首页</Link><Link href="/history" className="text-sm font-medium">历史记录</Link>
          {username ? <div className="relative"><button type="button" aria-label="打开账户菜单" aria-expanded={open} onClick={() => setOpen(!open)} className="rounded-full border border-border px-3 py-1.5 text-sm">{username}</button>
            {open ? <div className="absolute right-0 mt-2 w-44 rounded-xl border border-border bg-paper p-2 shadow-lg"><p className="px-2 py-1 text-xs text-ink-faint">{username}</p><button type="button" className="w-full rounded-lg px-2 py-2 text-left text-sm text-danger hover:bg-danger-soft" onClick={() => setConfirming(true)}>退出登录</button></div> : null}</div>
          : <Link href="/login" className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-white">登录</Link>}
        </nav>
      </div>
      {confirming ? <div role="dialog" aria-modal="true" className="fixed inset-0 flex items-center justify-center bg-ink/40 p-4"><div className="w-full max-w-sm rounded-2xl border border-border bg-paper p-6 shadow-xl"><h2 className="font-display text-lg font-semibold">确定要退出登录吗？</h2><p className="mt-2 text-sm text-ink-soft">退出后需要重新登录才能继续使用。</p><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setConfirming(false)}>取消</button><form action="/api/auth/logout" method="post"><button type="submit" className="rounded-full bg-danger px-4 py-2 text-white">退出登录</button></form></div></div></div> : null}
    </header>
  );
}
