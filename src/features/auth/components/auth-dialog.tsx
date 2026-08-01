"use client";

import { useState } from "react";
import { getLogger } from "@logtape/logtape";
import { useRouter } from "next/navigation";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AuthForm } from "./auth-form";

type AuthMode = "login" | "register";
type AuthDialogEvent = "login_clicked" | "dialog_opened" | "dialog_closed" | "mode_changed";

const logger = getLogger(["second-perspective", "auth"]);

function recordEvent(event: AuthDialogEvent) {
  try {
    logger.info("Auth dialog event", { event });
  } catch {
    // Console bridges must not interrupt authentication controls.
  }
  try {
    void fetch("/api/auth/diagnostics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event }),
      keepalive: true,
    }).catch(() => {
      try {
        logger.warning("Auth dialog diagnostic delivery failed", { event });
      } catch {
        // Console bridges must not interrupt authentication controls.
      }
    });
  } catch {
    // Diagnostic delivery must not interrupt authentication controls.
  }
}

export function AuthDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AuthMode>("login");
  const registering = mode === "register";

  function handleSuccess() {
    setOpen(false);
    recordEvent("dialog_closed");
    router.refresh();
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    recordEvent(nextOpen ? "dialog_opened" : "dialog_closed");
  }

  function switchMode() {
    setMode(registering ? "login" : "register");
    recordEvent("mode_changed");
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button
        type="button"
        size="sm"
        onClick={() => {
          setOpen(true);
          recordEvent("login_clicked");
        }}
        className="cursor-pointer rounded-full"
      >
        登录
      </Button>
      <DialogContent className="max-w-md rounded-[1.75rem] border-border bg-paper p-7 shadow-2xl shadow-primary/20">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl">{registering ? "创建账号" : "登录"}</DialogTitle>
          <DialogDescription className="leading-6 text-ink-faint">
            {registering ? "开始生成你的认知体检报告。" : "继续你的独立思考。"}
          </DialogDescription>
        </DialogHeader>
        <AuthForm mode={mode} onSuccess={handleSuccess} />
        <button
          type="button"
          onClick={switchMode}
          className="text-left text-sm font-medium text-secondary underline underline-offset-4"
        >
          {registering ? "已有账号？登录" : "创建账号"}
        </button>
      </DialogContent>
    </Dialog>
  );
}
