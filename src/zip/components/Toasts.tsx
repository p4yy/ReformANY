import { useSyncExternalStore } from "react";
import { CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { uid } from "../lib/util";

export type Tone = "info" | "success" | "warn" | "danger";
interface ToastItem {
  id: string;
  tone: Tone;
  title: string;
  body?: string;
  leaving?: boolean;
}

let items: ToastItem[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((fn) => fn());

function dismiss(id: string) {
  if (!items.some((t) => t.id === id && !t.leaving)) return;
  items = items.map((t) => (t.id === id ? { ...t, leaving: true } : t));
  emit();
  setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, 190);
}

export function toast(t: { tone?: Tone; title: string; body?: string; ms?: number }) {
  const id = uid();
  items = [...items.slice(-3), { id, tone: t.tone ?? "info", title: t.title, body: t.body }];
  emit();
  setTimeout(() => dismiss(id), t.ms ?? 5200);
}

const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
};

export function ToastViewport() {
  const list = useSyncExternalStore(subscribe, () => items);
  return (
    <div className="toast-viewport" role="region" aria-label="Notifications" aria-live="polite">
      {list.map((t) => {
        const Icon = t.tone === "success" ? CircleCheck : t.tone === "info" ? Info : TriangleAlert;
        return (
          <div key={t.id} className="toast" data-tone={t.tone} data-leaving={t.leaving || undefined} role="status">
            <Icon size={16} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold leading-snug [overflow-wrap:anywhere]">{t.title}</p>
              {t.body && <p className="mt-0.5 text-[0.78125rem] text-soft [overflow-wrap:anywhere]">{t.body}</p>}
            </div>
            <button type="button" className="btn btn-icon -my-0.5" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
