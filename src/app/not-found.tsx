import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center">
      <section>
        <p className="text-sm font-medium text-neutral-500">404</p>
        <h1 className="mt-3 text-2xl font-semibold">没有找到这个页面</h1>
        <Link
          className="mt-6 inline-block rounded-full bg-neutral-900 px-5 py-2.5 text-white"
          href="/"
        >
          返回首页
        </Link>
      </section>
    </main>
  );
}
