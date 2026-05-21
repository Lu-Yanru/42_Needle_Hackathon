// Operator Console toast system.
// A self-contained, design-matched stack (not sonner) so the console keeps its
// exact mission-control styling. Components fire toasts via useToast().

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

import { Icon } from "./icons";

export type ToastType = "ok" | "bad" | "warn" | "info";

export interface ToastInput {
  type?: ToastType;
  title: string;
  sub?: string;
  ttl?: number;
}

interface Toast extends ToastInput {
  id: string;
  out?: boolean;
}

const ToastContext = createContext<(t: ToastInput) => void>(() => {});

/** Fire a console toast. */
export function useToast(): (t: ToastInput) => void {
  return useContext(ToastContext);
}

const ICON: Record<ToastType, string> = { ok: "✓", bad: "!", warn: "!", info: "i" };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((cur) => cur.map((x) => (x.id === id ? { ...x, out: true } : x)));
    setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), 250);
  }, []);

  const push = useCallback(
    (t: ToastInput) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((cur) => [...cur, { ...t, id }]);
      setTimeout(() => dismiss(id), t.ttl ?? 5000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => {
          const type = t.type ?? "info";
          return (
            <div key={t.id} className={`toast ${type} ${t.out ? "out" : ""}`}>
              <div className="ic">{ICON[type]}</div>
              <div>
                <div className="ttl">{t.title}</div>
                {t.sub && <div className="sub">{t.sub}</div>}
              </div>
              <button type="button" className="x" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                <Icon name="x" size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
