"use client";

export default function TermsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-[2px] px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-paper p-6 shadow-xl animate-rise"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h3 className="font-display text-lg font-semibold text-ink">使用须知</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="text-ink-faint transition hover:text-ink"
          >
            ✕
          </button>
        </div>
        <div className="mt-4 space-y-3 text-sm leading-relaxed text-ink-soft">
          <p>
            欢迎使用「第二视角」。在开始之前，请花一点时间了解以下几点：
          </p>
          <p>1. 本产品用于帮助你从不同角度查看与讨论内容，请遵守相关法律法规，文明发言。</p>
          <p>2. 请妥善保管你的账号与密码，不要与他人共享登录信息。</p>
          <p>3. 我们会在必要范围内使用你的信息以提供服务，不会用于约定之外的用途。</p>
          <p>4. 当前为演示环境，登录信息仅保存于本地浏览器，不会上传至服务器。</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-6 w-full rounded-full bg-primary py-2.5 text-sm font-medium text-white transition hover:bg-primary-hover"
        >
          我已了解
        </button>
      </div>
    </div>
  );
}
