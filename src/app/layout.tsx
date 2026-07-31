import type { Metadata } from "next";
import type { ReactNode } from "react";
import { FontPreconnect } from "./font-preconnect";

import "./globals.css";

export const metadata: Metadata = {
  title: "第二视角",
  description: "帮你弄懂复杂议题，但不替你下结论。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <FontPreconnect />
      <body>{children}</body>
    </html>
  );
}
