"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AuthForm({ mode }: { mode: "register" | "login" }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const registering = mode === "register";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (response.ok) {
        router.push("/");
        router.refresh();
        return;
      }
      setError(body?.error ?? "请求失败，请稍后重试");
      setPassword("");
    } catch {
      setError("请求失败，请稍后重试");
      setPassword("");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="mt-8 space-y-5" onSubmit={submit}>
      <div>
        <label className="block text-sm font-medium" htmlFor={`${mode}-username`}>用户名</label>
        <input
          id={`${mode}-username`}
          name="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          minLength={3}
          maxLength={32}
          pattern="[A-Za-z0-9_]+"
          required
          className="mt-2 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2"
        />
      </div>
      <div>
        <label className="block text-sm font-medium" htmlFor={`${mode}-password`}>密码</label>
        <input
          id={`${mode}-password`}
          name="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={registering ? "new-password" : "current-password"}
          minLength={12}
          maxLength={128}
          required
          className="mt-2 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2"
        />
      </div>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-neutral-900 px-5 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "请稍候…" : registering ? "创建账号" : "登录"}
      </button>
    </form>
  );
}
