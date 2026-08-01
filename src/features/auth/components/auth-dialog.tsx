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
import { AuthForm } from "./auth-form";

type AuthMode = "login" | "register";
type AuthDialogEvent = "login_clicked" | "dialog_opened" | "dialog_closed" | "mode_changed";

const logger = getLogger(["second-perspective", "auth"]);

function recordEvent(event: AuthDialogEvent) {
  logger.info("Auth dialog event", { event });
  void fetch("/api/auth/diagnostics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event }),
    keepalive: true,
  }).catch(() => logger.warning("Auth dialog diagnostic delivery failed", { event }));
}

export function AuthDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AuthMode>("login");
  const registering = mode === "register";

  function handleSuccess() {
    recordEvent("dialog_closed");
    setOpen(false);
    router.refresh();
  }

  function handleOpenChange(nextOpen: boolean) {
    recordEvent(nextOpen ? "dialog_opened" : "dialog_closed");
    setOpen(nextOpen);
  }

  function switchMode() {
    recordEvent("mode_changed");
    setMode(registering ? "login" : "register");
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <button
        type="button"
        onClick={() => {
          recordEvent("login_clicked");
          setOpen(true);
        }}
        className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-white"
      >
        登录
      </button>
      <DialogContent className="max-w-md bg-paper">
        <DialogHeader>
          <DialogTitle>{registering ? "创建账号" : "登录"}</DialogTitle>
          <DialogDescription>
            {registering ? "开始生成你的认知体检报告。" : "继续你的独立思考。"}
          </DialogDescription>
        </DialogHeader>
        <AuthForm mode={mode} onSuccess={handleSuccess} />
        <button
          type="button"
          onClick={switchMode}
          className="text-sm text-ink-soft underline"
        >
          {registering ? "已有账号？登录" : "创建账号"}
        </button>
      </DialogContent>
    </Dialog>
  );
}
