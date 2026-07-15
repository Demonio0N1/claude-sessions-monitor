import { useEffect, useState } from 'react';

interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'error';
}

type ToastListener = (t: Toast) => void;
const listeners = new Set<ToastListener>();
let nextId = 1;

export function toast(text: string, kind: 'ok' | 'error' = 'ok'): void {
  const t = { id: nextId++, text, kind };
  for (const l of listeners) l(t);
}

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const on: ToastListener = (t) => {
      setToasts((list) => [...list, t]);
      setTimeout(() => setToasts((list) => list.filter((x) => x.id !== t.id)), 3500);
    };
    listeners.add(on);
    return () => {
      listeners.delete(on);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`max-w-full rounded-xl border px-4 py-2.5 text-sm shadow-lg backdrop-blur ${
            t.kind === 'ok'
              ? 'border-emerald-500/40 bg-emerald-950/90 text-emerald-200'
              : 'border-red-500/40 bg-red-950/90 text-red-200'
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
