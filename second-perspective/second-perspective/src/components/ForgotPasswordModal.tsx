"use client";

import { useState } from "react";

export default function ForgotPasswordModal({
  open,
  defaultPhone,
  onClose,
}: {
  open: boolean;
  defaultPhone: string;
  onClose: () => void;
}) {
  const [phone, setPhone] = useState(defaultPhone);
  const [sent, setSent] = useState(false);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-[2px] px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-paper p-6 shadow-xl animate-rise"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h3 className="font-display text-lg font-semibold text-ink">找回密码</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="text-ink-faint transition hover:text-ink"
          >
            ✕
          </button>
        </div>

        {!sent ? (
          <>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              请输入你的手机号，我们会发送验证码用于重置密码。
            </p>
            <label className="mt-4 block text-xs font-medium text-ink-soft">手机号</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
              placeholder="请输入11位手机号"
              className="mt-1.5 w-full rounded-xl border border-border bg-paper px-3.5 py-2.5 font-mono text-sm text-ink outline-none transition focus:border-primary"
            />
            <button
              type="button"
              disabled={phone.length !== 11}
              onClick={() => setSent(true)}
              className="mt-5 w-full rounded-full bg-primary py-2.5 text-sm font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              发送验证码
            </button>
          </>
        ) : (
          <div className="mt-4 rounded-xl bg-secondary-soft px-4 py-3 text-sm text-secondary">
            验证码已发送至 {phone.slice(0, 3)}****{phone.slice(-4)}（演示环境不会真实发送，
            可使用密码 123456 或手机号后6位直接登录）。
          </div>
        )}
      </div>
    </div>
  );
}
