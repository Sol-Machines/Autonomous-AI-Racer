"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type Variant = "info" | "success" | "warning" | "error";

interface ToastInput {
  variant?: Variant;
  title?: string;
  message: string;
  durationMs?: number;
}

interface ToastEntry extends ToastInput {
  id: number;
  variant: Variant;
}

const ToastCtx = createContext<((t: ToastInput) => void) | null>(null);

const VARIANT_STYLES: Record<Variant, string> = {
  info:    "border-[#3a3a3a] text-[#dcdcdc] bg-[#0e0e0e]/95",
  success: "border-[#2a6a2a] text-[#a3f4a3] bg-[#081208]/95",
  warning: "border-[#7a4400] text-[#ffb14a] bg-[#1a0d00]/95",
  error:   "border-[#7a1a00] text-[#ff8866] bg-[#1a0500]/95",
};

const VARIANT_ICONS: Record<Variant, string> = {
  info: "ℹ", success: "✓", warning: "⚠", error: "✕",
};

const VARIANT_ACCENT: Record<Variant, string> = {
  info:    "before:bg-[#666]",
  success: "before:bg-[#44ff44]",
  warning: "before:bg-[#ff8800]",
  error:   "before:bg-[#ff4400]",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastEntry[]>([]);

  const push = useCallback((t: ToastInput) => {
    const id = Date.now() + Math.random();
    const entry: ToastEntry = {
      id,
      variant: t.variant ?? "info",
      title: t.title,
      message: t.message,
      durationMs: t.durationMs,
    };
    setItems((prev) => [...prev, entry]);
    const ttl = t.durationMs ?? 5500;
    setTimeout(() => {
      setItems((prev) => prev.filter((x) => x.id !== id));
    }, ttl);
  }, []);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-[360px] w-[calc(100vw-2rem)] pointer-events-none">
        {items.map((t) => (
          <ToastItem key={t.id} entry={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastItem({
  entry,
  onDismiss,
}: {
  entry: ToastEntry;
  onDismiss: () => void;
}) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    // next tick so the transition runs
    const id = requestAnimationFrame(() => setShow(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      className={`
        pointer-events-auto relative font-mono text-[12px]
        border ${VARIANT_STYLES[entry.variant]}
        shadow-[0_8px_32px_rgba(0,0,0,0.7)]
        backdrop-blur-md
        transition-all duration-200 ease-out
        ${show ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}
        before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[2px]
        ${VARIANT_ACCENT[entry.variant]}
      `}
    >
      <div className="flex items-start gap-2.5 px-3.5 py-2.5 pl-4">
        <span className="text-[14px] leading-none mt-0.5 shrink-0">
          {VARIANT_ICONS[entry.variant]}
        </span>
        <div className="flex-1 min-w-0">
          {entry.title && (
            <div className="font-bold tracking-[0.15em] text-[10px] uppercase mb-1 opacity-90">
              {entry.title}
            </div>
          )}
          <div className="text-[11.5px] leading-snug whitespace-pre-line break-words">
            {entry.message}
          </div>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-[#666] hover:text-[#fff] text-[14px] leading-none mt-0.5 shrink-0 transition-colors"
        >
          ×
        </button>
      </div>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) {
    // Soft-fallback so a missing provider doesn't crash the app — just logs.
    return (t: ToastInput) =>
      console.warn("[toast no-provider]", t.variant ?? "info", t.message);
  }
  return ctx;
}
