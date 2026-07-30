import Link from "next/link";

import { AuthForm } from "@/features/auth/components/auth-form";

export default function LoginPage() {
  return (
    <>
      <h1 className="text-3xl font-semibold">登录</h1>
      <p className="mt-3 text-neutral-600">继续你的独立思考。</p>
      <AuthForm mode="login" />
      <p className="mt-6 text-sm text-neutral-600">
        还没有账号？ <Link className="underline" href="/register">创建账号</Link>
      </p>
    </>
  );
}
