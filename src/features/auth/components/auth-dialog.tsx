"use client";

import { useState } from "react";
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

export function AuthDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AuthMode>("login");
  const registering = mode === "register";

  function handleSuccess() {
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
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
          onClick={() => setMode(registering ? "login" : "register")}
          className="text-sm text-ink-soft underline"
        >
          {registering ? "已有账号？登录" : "创建账号"}
        </button>
      </DialogContent>
    </Dialog>
  );
}
