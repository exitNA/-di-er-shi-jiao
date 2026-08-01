"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

export function AgentWorkspaceLayout({
  conversation,
  findings,
}: {
  conversation: ReactNode;
  findings: ReactNode;
}) {
  const [leftWidth, setLeftWidth] = useState(38);
  const [mobileView, setMobileView] = useState<"conversation" | "findings">("conversation");
  const [isDesktop, setIsDesktop] = useState(true);
  const container = useRef<HTMLDivElement>(null);
  const desktopGrid = useRef<HTMLDivElement>(null);
  const pendingWidth = useRef(leftWidth);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  function updateWidth(clientX: number) {
    const bounds = container.current?.getBoundingClientRect();
    if (!bounds) return;
    const next = Math.min(58, Math.max(28, Math.round(((clientX - bounds.left) / bounds.width) * 100)));
    pendingWidth.current = next;
    desktopGrid.current?.style.setProperty("grid-template-columns", `${next}fr 13px ${100 - next}fr`);
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    const next = event.key === "ArrowLeft" ? leftWidth - 2 : event.key === "ArrowRight" ? leftWidth + 2 : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setLeftWidth(Math.min(58, Math.max(28, next)));
  }

  function startResize(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    updateWidth(event.clientX);
  }

  function finishResize(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setLeftWidth(pendingWidth.current);
  }

  return (
    <div ref={container} className="h-full min-h-0">
      {!isDesktop ? <><div className="mb-3 flex rounded-xl border border-border bg-white p-1" role="tablist" aria-label="工作区视图">
        <button type="button" role="tab" aria-selected={mobileView === "conversation"} className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${mobileView === "conversation" ? "bg-forest-soft text-primary" : "text-ink-faint"}`} onClick={() => setMobileView("conversation")}>对话</button>
        <button type="button" role="tab" aria-selected={mobileView === "findings"} className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${mobileView === "findings" ? "bg-forest-soft text-primary" : "text-ink-faint"}`} onClick={() => setMobileView("findings")}>当前发现</button>
      </div><div className="h-[calc(100%_-_3.5rem)] min-h-0">{mobileView === "conversation" ? conversation : findings}</div></> : <div ref={desktopGrid} className="grid h-full min-h-0" style={{ gridTemplateColumns: `${leftWidth}fr 13px ${100 - leftWidth}fr` }}>
        <div className="min-w-0 min-h-0 overflow-hidden px-6 py-5">{conversation}</div>
        <div role="separator" tabIndex={0} aria-label="调整对话与发现区域宽度" aria-orientation="vertical" aria-valuemin={28} aria-valuemax={58} aria-valuenow={leftWidth} className="group relative cursor-col-resize outline-none" onKeyDown={resizeWithKeyboard} onPointerDown={startResize} onPointerMove={(event) => event.currentTarget.hasPointerCapture(event.pointerId) && updateWidth(event.clientX)} onPointerUp={finishResize} onPointerCancel={finishResize}>
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition group-hover:w-0.5 group-hover:bg-secondary group-focus-visible:w-0.5 group-focus-visible:bg-secondary" />
        </div>
        <div className="min-w-0 min-h-0 overflow-y-auto overscroll-contain px-6 py-5">{findings}</div>
      </div>}
    </div>
  );
}
