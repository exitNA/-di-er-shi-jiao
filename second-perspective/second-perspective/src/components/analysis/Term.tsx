"use client";

import { useEffect, useRef, useState } from "react";

type TermColor =
  | "orange"
  | "blue"
  | "purple"
  | "red"
  | "gray"
  | "yellow"
  | "lightgray"
  | "ink";

const COLOR_CLASS: Record<TermColor, { text: string; bg: string }> = {
  orange: { text: "text-tag-orange", bg: "bg-tag-orange-soft" },
  blue: { text: "text-tag-blue", bg: "bg-tag-blue-soft" },
  purple: { text: "text-tag-purple", bg: "bg-tag-purple-soft" },
  red: { text: "text-tag-red", bg: "bg-tag-red-soft" },
  gray: { text: "text-tag-gray", bg: "bg-tag-gray-soft" },
  yellow: { text: "text-tag-yellow", bg: "bg-tag-yellow-soft" },
  lightgray: { text: "text-tag-lightgray", bg: "bg-tag-lightgray-soft" },
  ink: { text: "text-ink", bg: "bg-paper-dim" },
};

export default function Term({
  label,
  definition,
  color = "ink",
  asTag = false,
}: {
  label: string;
  definition: string;
  color?: TermColor;
  asTag?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const { text, bg } = COLOR_CLASS[color];

  useEffect(() => {
    if (!locked) return;
    function handleOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setLocked(false);
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [locked]);

  return (
    <span ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onMouseEnter={() => !locked && setOpen(true)}
        onMouseLeave={() => !locked && setOpen(false)}
        onClick={(e) => {
          e.stopPropagation();
          setLocked((v) => {
            const next = !v;
            setOpen(next);
            return next;
          });
        }}
        className={
          asTag
            ? `rounded-full ${bg} px-2 py-0.5 text-[11px] font-medium ${text} cursor-help`
            : `${text} underline decoration-dotted decoration-1 underline-offset-2 cursor-help`
        }
      >
        {label}
      </button>

      {open && (
        <span
          className="absolute left-0 top-full z-30 mt-1.5 w-56 rounded-xl border border-border bg-paper px-3 py-2 text-[11px] font-normal leading-relaxed text-ink-soft shadow-lg animate-rise"
          role="tooltip"
        >
          <span className={`mb-1 block text-[11px] font-semibold ${text}`}>{label}</span>
          {definition}
        </span>
      )}
    </span>
  );
}
