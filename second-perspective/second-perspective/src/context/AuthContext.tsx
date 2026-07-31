"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";

export type Session =
  | { type: "user"; phone: string }
  | { type: "guest" }
  | null;

interface AuthContextValue {
  session: Session;
  ready: boolean;
  loginWithPhone: (phone: string, password: string) => { ok: boolean; message?: string };
  loginAsGuest: () => void;
  logout: () => void;
  wrongAttempts: number;
  resetAttempts: () => void;
}

const STORAGE_KEY = "second-perspective:session";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// 演示环境使用的校验规则：
// 手机号为 11 位数字；密码为 123456，或手机号后 6 位，均视为正确。
function isPasswordCorrect(phone: string, password: string) {
  return password === "123456" || password === phone.slice(-6);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>(null);
  const [ready, setReady] = useState(false);
  const [wrongAttempts, setWrongAttempts] = useState(0);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 首次挂载时从localStorage水合登录态，属于一次性初始化
      if (raw) setSession(JSON.parse(raw));
    } catch {
      // 忽略解析失败，视为未登录
    }
    setReady(true);
  }, []);

  function persist(next: Session) {
    setSession(next);
    if (next) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }

  function loginWithPhone(phone: string, password: string) {
    if (!/^1\d{10}$/.test(phone)) {
      return { ok: false, message: "请输入正确的11位手机号" };
    }
    if (isPasswordCorrect(phone, password)) {
      setWrongAttempts(0);
      persist({ type: "user", phone });
      return { ok: true };
    }
    const next = wrongAttempts + 1;
    setWrongAttempts(next);
    if (next >= 3) {
      return { ok: false, message: "连续错了3次啦，要不试试「忘记密码」？" };
    }
    return { ok: false, message: `密码不对哦，再试试吧（${next}/3）` };
  }

  function loginAsGuest() {
    persist({ type: "guest" });
  }

  function logout() {
    persist(null);
    setWrongAttempts(0);
  }

  function resetAttempts() {
    setWrongAttempts(0);
  }

  return (
    <AuthContext.Provider
      value={{ session, ready, loginWithPhone, loginAsGuest, logout, wrongAttempts, resetAttempts }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return ctx;
}
