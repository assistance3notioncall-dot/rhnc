"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { STATUS } from "@/lib/format";

export function Badge({ status, label }: { status: string; label?: string }) {
  const s = STATUS[status] ?? { label: status, cls: "bg-gray2-l text-gray2" };
  return <span className={`badge ${s.cls}`}>{label ?? s.label}</span>;
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1>{title}</h1>
        {sub && <p className="mut mt-1">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function Kpi({ label, value, hint, tone = "text-fg" }: { label: string; value: React.ReactNode; hint?: string; tone?: string }) {
  return (
    <div className="card">
      <div className="mut text-[12.5px] font-semibold">{label}</div>
      <div className={`kpi mt-2 ${tone}`}>{value}</div>
      {hint && <div className="mut mt-1.5 text-[12.5px]">{hint}</div>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="mut py-8 text-center">{children}</div>;
}

export function Loading() {
  return <div className="mut py-10 text-center">Chargement…</div>;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div
        className={`card max-h-[90vh] w-full overflow-auto ${wide ? "max-w-4xl" : "max-w-lg"}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2>{title}</h2>
          <button className="btn btn-sm" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`mb-3.5 block ${className}`}>
      <span className="lbl">{label}</span>
      {children}
    </label>
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: { key: string; label: string }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {tabs.map((t) => (
        <button key={t.key} className={value === t.key ? "chip-on" : "chip"} onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- toasts ---------- */
type Toast = { id: number; text: string; tone: "ok" | "err" };
const ToastCtx = createContext<(text: string, tone?: "ok" | "err") => void>(() => {});
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === "err" ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} className={`rounded-lg px-4 py-3 text-white shadow-lg ${t.tone === "ok" ? "bg-slate-900" : "bg-err"}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Exécute une action async avec toast d'erreur / succès. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (fn: () => Promise<unknown>, okText?: string) => {
      setBusy(true);
      try {
        await fn();
        if (okText) toast(okText);
        return true;
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), "err");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { busy, run };
}
