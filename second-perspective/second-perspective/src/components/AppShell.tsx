"use client";

import { usePathname } from "next/navigation";
import { ReactNode } from "react";
import Navbar from "./Navbar";

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hideNav = pathname === "/login";

  return (
    <div className="flex min-h-screen flex-col">
      {!hideNav && <Navbar />}
      <main className="flex-1">{children}</main>
    </div>
  );
}
