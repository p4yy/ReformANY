import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Maximize2, Minimize2, X, type LucideIcon } from "lucide-react";
import { clamp, cx, formatBytes, middleEllipsis } from "../lib/util";
import type { OrbitContext } from "./data";

export interface DialogProps {
  context: OrbitContext;
  onClose: () => void;
}

/**
 * Shared chrome for every Orbit dialog: opaque surface, 1px border, no shadow or
 * backdrop of its own (nothing that could read as a ghost window), custom header
 * that is a drag region, fullscreen toggle, focus trap, Esc to close.
 *
 * In a frameless Tauri window the header drags natively via `-webkit-app-region`;
 * in a plain browser the same header drags the panel with pointer events.
 */
export function PanelShell({
  icon: Icon,
  title,
  subtitle,
  context,
  width = 30,
  danger,
  flush,
  closeOnEsc = true,
  headerExtra,
  footer,
  onClose,
  children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  context?: OrbitContext;
  /** rem */
  width?: number;
  danger?: boolean;
  flush?: boolean;
  closeOnEsc?: boolean;
  headerExtra?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const [full, setFull] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const titleId = useId();

  useEffect(() => {
    const el = panel.current;
    const prev = document.activeElement as HTMLElement | null;
    (el?.querySelector<HTMLElement>("[data-autofocus]") ?? el)?.focus({ preventScroll: true });
    return () => prev?.focus?.();
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (closeOnEsc) onClose();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const nodes = Array.from(
      panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select, textarea, [tabindex]:not([tabindex="-1"])'),
    ).filter((n) => n.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (full || e.button !== 0 || (e.target as HTMLElement).closest("button, input, a, select")) return;
    drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const maxX = window.innerWidth / 2 - 48;
    const maxY = window.innerHeight / 2 - 32;
    setPos({ x: clamp(d.ox + e.clientX - d.sx, -maxX, maxX), y: clamp(d.oy + e.clientY - d.sy, -maxY, maxY) });
  };
  const endDrag = () => {
    drag.current = null;
  };

  const meta = context
    ? context.kind === "folder"
      ? `${context.items ?? 0} items`
      : `${formatBytes(context.size)}${context.pages ? ` · ${context.pages} pages` : ""}`
    : "";

  return (
    <div className="panel-layer">
      <div
        ref={panel}
        className="panel focus:outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-full={full || undefined}
        data-danger={danger || undefined}
        style={{ "--panel-w": `${width}rem`, transform: full ? undefined : `translate3d(${pos.x}px, ${pos.y}px, 0)` } as CSSProperties}
        onKeyDown={onKeyDown}
      >
        <header
          className="panel-header"
          data-tauri-drag-region
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={(e) => !(e.target as HTMLElement).closest("button") && setFull((f) => !f)}
        >
          <span className="panel-chip">
            <Icon size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-[0.9375rem] font-semibold leading-tight">
              {title}
            </h2>
            {subtitle && <p className="truncate text-[0.75rem] text-soft">{subtitle}</p>}
          </div>
          {headerExtra}
          <button type="button" className="btn btn-icon" aria-label={full ? "Exit fullscreen" : "Fullscreen"} aria-pressed={full} title={full ? "Exit fullscreen" : "Fullscreen"} onClick={() => setFull((f) => !f)}>
            {full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button type="button" className="btn btn-icon is-danger" aria-label="Close" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        {context && (
          <div className="panel-file">
            <span className="tag" data-family={context.kind === "pdf" ? "doc" : context.kind === "folder" ? "archive" : context.kind}>
              {context.kind === "folder" ? "dir" : context.ext}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium" title={context.name}>
                {context.name}
              </span>
              <span className="mono block truncate text-[0.6875rem] text-muted" title={context.path}>
                {middleEllipsis(context.path, 54)}
              </span>
            </span>
            <span className="mono flex-none text-[0.6875rem] text-soft">{meta}</span>
          </div>
        )}

        <div className={cx("panel-body", flush && "!p-0")}>{children}</div>
        {footer && <footer className="panel-footer">{footer}</footer>}
      </div>
    </div>
  );
}

/** A stand-in page for the browser preview, where there is no PDF on disk to render. */
export function FauxPage({ n, className, style, children }: { n: number; className?: string; style?: CSSProperties; children?: ReactNode }) {
  const lines = useMemo(() => {
    const out: Array<{ top: number; w: number; h?: number; cls?: string }> = [];
    const seed = n * 7;
    let y = 9;
    out.push({ top: y, w: 40 + (seed % 24), cls: "is-head" });
    y += 9;
    for (let i = 0; i < 26 && y < 88; i++) {
      if ((i + n) % 11 === 5 && y < 66) {
        out.push({ top: y, w: 78, h: 15, cls: "is-fig" });
        y += 18.5;
      } else {
        const short = (i + seed) % 6 === 4;
        out.push({ top: y, w: short ? 30 + ((seed + i * 13) % 34) : 78 - ((seed + i * 5) % 8) });
        y += short ? 6 : 3.3;
      }
    }
    return out;
  }, [n]);
  return (
    <div className={cx("faux-page", className)} style={style}>
      {lines.map((l, i) => (
        <span key={i} className={l.cls} style={{ top: `${l.top}%`, width: `${l.w}%`, height: l.h ? `${l.h}%` : undefined }} />
      ))}
      {children}
    </div>
  );
}
