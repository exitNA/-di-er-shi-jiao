"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import LogoMark from "./LogoMark";
import ConfirmDialog from "./ConfirmDialog";

export default function Navbar() {
  const { session, logout } = useAuth();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const label =
    session?.type === "user"
      ? `${session.phone.slice(-4)}`
      : session?.type === "guest"
      ? "游客"
      : null;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <LogoMark />
          <span className="font-display text-[17px] font-semibold tracking-tight text-ink">
            第二视角
          </span>
        </Link>

        <nav className="flex items-center gap-6">
          <Link
            href="/"
            className="relative text-sm font-medium text-ink after:absolute after:-bottom-[21px] after:left-0 after:h-[2px] after:w-full after:bg-primary after:content-['']"
          >
            首页
          </Link>

          {!label ? (
            <Link
              href="/login"
              className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-white transition hover:bg-primary-hover"
            >
              登录
            </Link>
          ) : (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-1.5 rounded-full border border-border bg-paper px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-paper-dim"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-secondary-soft text-[10px] font-mono text-secondary">
                  {session?.type === "guest" ? "G" : "•••"}
                </span>
                {session?.type === "user" ? `${label}` : "游客"}
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  className={`transition-transform ${menuOpen ? "rotate-180" : ""}`}
                >
                  <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" />
                </svg>
              </button>

              {menuOpen && (
                <div className="absolute right-0 mt-2 w-44 overflow-hidden rounded-xl border border-border bg-paper shadow-lg animate-rise">
                  {session?.type === "user" && (
                    <div className="border-b border-border px-4 py-3 text-xs text-ink-faint">
                      当前账号
                      <div className="mt-0.5 font-mono text-sm text-ink">
                        {session.phone.slice(0, 3)}****{session.phone.slice(-4)}
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      logout();
                      router.push("/login");
                    }}
                    className="block w-full px-4 py-2.5 text-left text-sm text-ink transition hover:bg-paper-dim"
                  >
                    切换账号
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmLogout(true);
                    }}
                    className="block w-full px-4 py-2.5 text-left text-sm text-danger transition hover:bg-danger-soft"
                  >
                    退出登录
                  </button>
                </div>
              )}
            </div>
          )}
        </nav>
      </div>

      <ConfirmDialog
        open={confirmLogout}
        title="确定要退出登录吗？"
        description="退出后需要重新登录才能继续使用「第二视角」。"
        confirmText="退出登录"
        danger
        onConfirm={() => {
          logout();
          setConfirmLogout(false);
          router.push("/login");
        }}
        onCancel={() => setConfirmLogout(false)}
      />
    </header>
  );
}
