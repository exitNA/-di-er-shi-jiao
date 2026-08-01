"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { LogoMark } from "@/components/brand/logo-mark";
import { AuthDialog } from "@/features/auth/components/auth-dialog";

const avatarColors = ["#dff0ee", "#f4c99b", "#e5e4f7", "#ddeadc"];

export function AppNavigation({ username }: { username?: string }) {
  const [open, setOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function closeOnOutsideClick(event: PointerEvent) {
      if (event.target instanceof Node && !accountMenuRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open]);

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-paper/80 backdrop-blur-xl">
      <div className="flex h-[4.5rem] items-center justify-between px-5 sm:px-8 lg:px-12">
        <Link href="/" className="flex items-center gap-2.5 rounded-full pr-2 transition-opacity hover:opacity-75"><LogoMark size={30} /><span className="font-display text-lg font-semibold tracking-tight">第二视角</span></Link>
        <nav className="flex items-center" aria-label="主导航">
          {username ? <div ref={accountMenuRef} className="relative"><button type="button" aria-label="打开账户菜单" aria-expanded={open} onClick={() => setOpen(!open)} className="rounded-full transition hover:opacity-75"><span aria-label={`${username} 的头像`} className="grid size-9 place-items-center rounded-full text-sm font-semibold text-primary" style={{ backgroundColor: avatarColor(username) }}>{avatarInitial(username)}</span></button>
            {open ? <div className="absolute right-0 mt-2 w-44 rounded-2xl border border-border bg-paper p-2 shadow-xl shadow-primary/10"><p className="px-3 py-2 text-xs text-ink-faint">{username}</p><Link href="/history" className="block rounded-xl px-3 py-2 text-sm font-medium text-primary hover:bg-forest-soft">思考档案</Link><form action="/api/auth/logout" method="post"><button type="submit" className="w-full rounded-xl px-3 py-2 text-left text-sm text-danger hover:bg-danger-soft">退出登录</button></form></div> : null}</div>
          : <AuthDialog />}
        </nav>
      </div>
    </header>
  );
}

function avatarInitial(username: string) {
  return Array.from(username.trim())[0]?.toLocaleUpperCase() ?? "?";
}

function avatarColor(username: string) {
  let hash = 0;
  for (const character of username) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  return avatarColors[hash % avatarColors.length];
}
