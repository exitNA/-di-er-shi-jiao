"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import LogoMark from "@/components/LogoMark";
import TermsModal from "@/components/TermsModal";
import ForgotPasswordModal from "@/components/ForgotPasswordModal";

export default function LoginPage() {
  const router = useRouter();
  const { loginWithPhone, loginAsGuest, resetAttempts } = useAuth();

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [needsAgree, setNeedsAgree] = useState(false);
  const [shake, setShake] = useState(false);

  const [termsOpen, setTermsOpen] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  function triggerShake() {
    setShake(true);
    window.setTimeout(() => setShake(false), 500);
  }

  function handlePhoneChange(value: string) {
    setPhone(value.replace(/\D/g, "").slice(0, 11));
    setError(null);
    resetAttempts();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setNeedsAgree(false);
    setError(null);

    if (!agreed) {
      setNeedsAgree(true);
      triggerShake();
      return;
    }
    if (!phone || !password) {
      setError("请填写手机号和密码");
      triggerShake();
      return;
    }

    const result = loginWithPhone(phone, password);
    if (!result.ok) {
      setError(result.message ?? "登录失败，请重试");
      triggerShake();
      return;
    }
    router.push("/");
  }

  function handleGuestEntry() {
    setNeedsAgree(false);
    if (!agreed) {
      setNeedsAgree(true);
      triggerShake();
      return;
    }
    loginAsGuest();
    router.push("/");
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      {/* 背景：两种色调从两侧汇聚，呼应“第二视角”的双重视角意象 */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(115deg, var(--color-primary-soft) 0%, var(--color-paper) 42%, var(--color-paper) 58%, var(--color-secondary-soft) 100%)",
        }}
      />
      <div className="pointer-events-none absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-1/4 h-72 w-72 rounded-full bg-secondary/10 blur-3xl" />

      <div
        className={`relative w-full max-w-sm rounded-3xl border border-border bg-paper/95 p-8 shadow-xl backdrop-blur ${
          shake ? "animate-shake" : ""
        }`}
      >
        <div className="flex flex-col items-center">
          <LogoMark size={40} />
          <h1 className="mt-3 font-display text-xl font-semibold tracking-tight text-ink">
            第二视角
          </h1>
          <p className="mt-1 text-xs text-ink-faint">换一个角度，看见不一样的答案</p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-soft">手机号</label>
            <input
              value={phone}
              onChange={(e) => handlePhoneChange(e.target.value)}
              inputMode="numeric"
              placeholder="请输入11位手机号"
              className="w-full rounded-xl border border-border bg-paper px-3.5 py-2.5 font-mono text-sm text-ink outline-none transition focus:border-primary"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-soft">密码</label>
            <div className="relative">
              <input
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                type={showPassword ? "text" : "password"}
                placeholder="请输入密码"
                className="w-full rounded-xl border border-border bg-paper px-3.5 py-2.5 pr-11 text-sm text-ink outline-none transition focus:border-primary"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-faint transition hover:text-ink-soft"
              >
                {showPassword ? "隐藏" : "显示"}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-ink-faint">
              演示环境：密码为 123456 或手机号后6位
            </p>
          </div>

          {error && (
            <div className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-xs leading-relaxed text-danger">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="w-full rounded-full bg-primary py-3 text-sm font-semibold text-white transition hover:bg-primary-hover"
          >
            登录
          </button>

          <div className="flex items-start gap-2 pt-1">
            <input
              id="agree"
              type="checkbox"
              checked={agreed}
              onChange={(e) => {
                setAgreed(e.target.checked);
                if (e.target.checked) setNeedsAgree(false);
              }}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-primary)]"
            />
            <label
              htmlFor="agree"
              className={`text-xs leading-relaxed ${
                needsAgree ? "text-danger" : "text-ink-faint"
              }`}
            >
              登录/继续即代表同意
              <button
                type="button"
                onClick={() => setTermsOpen(true)}
                className="text-primary underline underline-offset-2"
              >
                《使用须知》
              </button>
              {needsAgree && <span className="ml-1">请先勾选同意</span>}
            </label>
          </div>
        </form>

        <div className="mt-6 flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={() => setForgotOpen(true)}
            className="text-ink-soft transition hover:text-primary"
          >
            忘记密码
          </button>
          <button
            type="button"
            onClick={handleGuestEntry}
            className="text-ink-soft transition hover:text-primary"
          >
            游客身份进入
          </button>
        </div>
      </div>

      <TermsModal open={termsOpen} onClose={() => setTermsOpen(false)} />
      <ForgotPasswordModal
        open={forgotOpen}
        defaultPhone={phone}
        onClose={() => setForgotOpen(false)}
      />
    </div>
  );
}
