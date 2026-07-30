import Link from "next/link";

import { AuthForm } from "@/features/auth/components/auth-form";

export default function RegisterPage() {
  return (
    <>
      <h1 className="text-3xl font-semibold">创建账号</h1>
      <p className="mt-3 text-neutral-600">开始生成你的认知体检报告。</p>
      <AuthForm mode="register" />
      <p className="mt-6 text-sm text-neutral-600">
        已有账号？ <Link className="underline" href="/login">登录</Link>
      </p>
    </>
  );
}
