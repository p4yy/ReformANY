import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type SVGProps,
} from "react";
import { Check as CheckIcon, Download, FolderOpen, LoaderCircle, TriangleAlert, Info, type LucideIcon } from "lucide-react";
import { activity } from "../lib/activity";
import { isTauri, pickPaths, runJob, type JobRequest } from "../lib/bridge";
import type { NamedBlob } from "../lib/converters";
import { useSettings, type Settings } from "../lib/settings";
import { cx, downloadBlob, extOf, familyOf, formatBytes, sleep } from "../lib/util";
import { NAV, type PageId } from "../shell/nav";
import { toast } from "./Toasts";

/* ───────────── Brand marks ───────────── */
export function LogoMark({ size = 20, tile = false, ...rest }: { size?: number; tile?: boolean } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" {...rest}>
      {tile && <rect width="32" height="32" rx="9" fill="#4E8F72" />}
      <path d="M22.4 20.6A7.8 7.8 0 1 1 23.6 14" stroke="#E1E6D9" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="23.6" cy="17.6" r="1.9" fill="#B4C99F" />
      <circle cx="16" cy="16" r="2.6" fill="#E1E6D9" />
    </svg>
  );
}

/** Mouse-shake glyph shown beside the hold-and-shake setting. */
export function ShakeIcon({ size = 20, on = true }: { size?: number; on?: boolean }) {
  return (
    <svg
      className="shake-icon"
      data-on={on}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <g className="m">
        <rect x="8" y="5" width="8" height="14" rx="4" />
        <path d="M12 8.5V11" />
      </g>
      <path className="w" d="M4.5 8.5C3.5 9.6 3 10.8 3 12s.5 2.4 1.5 3.5" />
      <path className="w" d="M19.5 8.5c1 1.1 1.5 2.3 1.5 3.5s-.5 2.4-1.5 3.5" />
    </svg>
  );
}

/* ───────────── Segmented control with FLIP shared-layout indicator ───────────── */
export interface Option<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  hint?: string;
  kbd?: string;
  disabled?: boolean;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  size = "md",
  full,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Option<T>[];
  ariaLabel: string;
  size?: "sm" | "md";
  full?: boolean;
  className?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ x: number; w: number } | null>(null);
  const signature = options.map((o) => o.label + (o.kbd ?? "")).join("|");

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const cur = el.querySelector<HTMLElement>('[aria-checked="true"]');
      if (cur && cur.offsetWidth) setInd({ x: cur.offsetLeft, w: cur.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => ro.disconnect();
  }, [value, signature]);

  const onKey = (e: KeyboardEvent) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    onChange(options[(i + dir + options.length) % options.length].value);
    requestAnimationFrame(() => wrap.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  };

  return (
    <div
      ref={wrap}
      role="radiogroup"
      aria-label={ariaLabel}
      className={cx("seg", size === "sm" && "seg-sm", full && "seg-full", className)}
      onKeyDown={onKey}
    >
      {ind && <span className="seg-ind" aria-hidden="true" style={{ transform: `translateX(${ind.x}px)`, width: ind.w }} />}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          title={o.hint}
          disabled={o.disabled}
          className="seg-item"
          onClick={() => onChange(o.value)}
        >
          {o.icon && <o.icon size={14} />}
          <span>{o.label}</span>
          {o.kbd && <span className="kbd">{o.kbd}</span>}
        </button>
      ))}
    </div>
  );
}

/* ───────────── Small controls ───────────── */
export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  format = (v) => String(v),
  id,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  format?: (v: number) => string;
  id?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex items-center gap-3">
      <input
        id={id}
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-valuetext={format(value)}
        style={{ "--v": `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output className="readout">{format(value)}</output>
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />;
}

export function Check({
  checked,
  onChange,
  children,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("check", className)}>
      <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="check-box" aria-hidden="true">
        <CheckIcon size={12} style={{ strokeWidth: 2.75 }} />
      </span>
      <span>{children}</span>
    </label>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  aside,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("grid min-w-0 gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="label">
            {label}
          </label>
        ) : (
          <span className="label">{label}</span>
        )}
        {aside}
      </div>
      {children}
      {hint && <p className="text-[0.75rem] text-soft text-pretty">{hint}</p>}
    </div>
  );
}

export function Chips<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<Option<T> & { dot?: boolean }>;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cx("flex flex-wrap gap-1.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          title={o.hint}
          className="chip"
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.dot && <i className="chip-dot" aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, active, label }: { value: number; active?: boolean; label?: string }) {
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label={label ?? "Progress"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      data-active={active || undefined}
    >
      <div className="progress-fill" style={{ transform: `scaleX(${value})` }} />
    </div>
  );
}

export function Card({
  title,
  icon: Icon,
  aside,
  children,
  className,
}: {
  title?: string;
  icon?: LucideIcon;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("card", className)}>
      {title && (
        <header className="card-head">
          {Icon && <Icon size={16} className="text-muted" />}
          <h2 className="card-title">{title}</h2>
          {aside && <div className="ml-auto flex items-center gap-2">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Note({ children, warn, className }: { children: ReactNode; warn?: boolean; className?: string }) {
  const Icon = warn ? TriangleAlert : Info;
  return (
    <p className={cx("note", warn && "is-warn", className)}>
      <Icon size={14} />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="dz-rings" aria-hidden="true">
        <i />
        <i />
        <i />
        <Icon size={20} />
      </div>
      <h3>{title}</h3>
      <div className="max-w-[46ch] text-pretty">{children}</div>
    </div>
  );
}

/* ───────────── Page header ───────────── */
export function PageHeader({ page, lead, children }: { page: PageId; lead?: ReactNode; children?: ReactNode }) {
  const { t } = useSettings();
  const group = NAV.find((n) => n.id === page)?.group ?? "workspace";
  return (
    <header className="stagger flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <nav aria-label="Breadcrumb" className="crumb">
          <span>{t(group)}</span>
          <span aria-hidden="true">/</span>
          <span className="text-soft" aria-current="page">
            {t(page)}
          </span>
        </nav>
        <h1 className="page-title">{t(page)}</h1>
        {lead && <p className="page-lead">{lead}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        <span className="local-badge" title="Files are processed on this device. Nothing is uploaded.">
          <i aria-hidden="true" />
          Local processing · Preview
        </span>
      </div>
    </header>
  );
}

/* ───────────── Jobs ───────────── */
export interface JobState {
  status: "idle" | "running" | "done" | "error";
  progress: number;
  note: string;
  dry?: boolean;
}
export interface RunSpec {
  title: string;
  detail: string;
  /** Sent to the backend (desktop) or walked as a dry run (browser). */
  request?: JobRequest;
  /** Runs for real inside the webview. Return a short summary. */
  real?: (onProgress: (p: number, note?: string) => void) => Promise<string | void>;
}

export const DRY_NOTE = "Dry run only — this job needs a desktop engine. No file was written.";

export function useJob(module: string) {
  const [state, setState] = useState<JobState>({ status: "idle", progress: 0, note: "" });

  const run = useCallback(
    async (spec: RunSpec) => {
      setState({ status: "running", progress: 0, note: "Starting…" });
      const onProgress = (p: number, note?: string) =>
        setState((s) => ({ ...s, progress: Math.min(1, Math.max(0, p)), note: note ?? s.note }));
      try {
        let dry = false;
        let summary = "";
        if (spec.real && !isTauri) summary = (await spec.real(onProgress)) || "";
        else if (spec.request) dry = (await runJob(spec.request, onProgress)).simulated;
        else if (spec.real) summary = (await spec.real(onProgress)) || "";
        setState({ status: "done", progress: 1, dry, note: dry ? DRY_NOTE : summary || "Finished" });
        activity.add({ module, title: spec.title, detail: dry ? `${spec.detail} · dry run, nothing written` : summary || spec.detail, status: dry ? "dry" : "done" });
        toast(
          dry
            ? { tone: "info", title: "Dry run complete", body: `"${spec.title}" needs a desktop engine. No file was written in this browser preview.` }
            : { tone: "success", title: spec.title, body: summary || spec.detail },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setState({ status: "error", progress: 0, note: msg });
        activity.add({ module, title: spec.title, detail: msg, status: "failed" });
        toast({ tone: "danger", title: "Job failed", body: msg });
      }
    },
    [module],
  );

  const reset = useCallback(() => setState({ status: "idle", progress: 0, note: "" }), []);
  return { state, run, reset };
}
export type Job = ReturnType<typeof useJob>;

export function JobBar({
  job,
  label,
  icon: Icon,
  disabled,
  hint,
  warning,
  onRun,
}: {
  job: Job;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  hint?: ReactNode;
  warning?: ReactNode;
  onRun: () => void;
}) {
  const s = job.state;
  const running = s.status === "running";
  return (
    <div className="jobbar">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <button type="button" className="btn btn-primary btn-lg" disabled={disabled || running} onClick={onRun}>
          {running ? <LoaderCircle size={16} className="spin" /> : <Icon size={16} />}
          {running ? "Working…" : label}
        </button>
        <div className="min-w-[12rem] flex-1">
          {s.status === "idle" ? (
            warning ? <Note warn>{warning}</Note> : hint ? <Note>{hint}</Note> : null
          ) : (
            <div className="grid gap-1.5">
              <div className="flex items-baseline justify-between gap-3 text-[0.75rem]">
                <span className={cx("min-w-0 truncate", s.status === "error" ? "text-danger" : "text-soft")} aria-live="polite" title={s.note}>
                  {s.note}
                </span>
                <span className="mono text-bright">{Math.round(s.progress * 100)}%</span>
              </div>
              <Progress value={s.progress} active={running} label={label} />
            </div>
          )}
        </div>
      </div>
      {s.status !== "idle" && warning && (
        <Note warn className="mt-2">
          {warning}
        </Note>
      )}
    </div>
  );
}

/* ───────────── Destination ───────────── */
export function useDestination() {
  const { settings } = useSettings();
  const [mode, setMode] = useState<Settings["outputMode"]>(settings.outputMode);
  const [path, setPath] = useState(settings.outputPath);
  return { mode, setMode, path, setPath };
}

export function DestinationField({ dest, id }: { dest: ReturnType<typeof useDestination>; id: string }) {
  const browse = async () => {
    const picked = await pickPaths({ directory: true, multiple: false, title: "Choose output folder" });
    if (picked?.[0]) dest.setPath(picked[0]);
  };
  return (
    <Field
      label="Destination"
      htmlFor={id}
      hint={isTauri ? undefined : "In this browser preview, finished files are offered through Save buttons."}
    >
      <select id={id} className="field" value={dest.mode} onChange={(e) => dest.setMode(e.target.value as Settings["outputMode"])}>
        <option value="source">Next to the source file</option>
        <option value="fixed">A fixed folder</option>
        <option value="ask">Ask every time</option>
      </select>
      {dest.mode === "fixed" && (
        <div className="flex gap-2">
          <input
            className="field mono"
            aria-label="Output folder path"
            placeholder="C:\Users\you\Converted"
            value={dest.path}
            onChange={(e) => dest.setPath(e.target.value)}
          />
          {isTauri && (
            <button type="button" className="btn btn-ghost" onClick={browse}>
              <FolderOpen size={16} />
              Browse
            </button>
          )}
        </div>
      )}
    </Field>
  );
}

/* ───────────── Result list (real outputs) ───────────── */
export function SaveList({ items, title = "Results" }: { items: NamedBlob[]; title?: string }) {
  if (!items.length) return null;
  const saveAll = async () => {
    for (const it of items) {
      downloadBlob(it.blob, it.name);
      await sleep(260);
    }
  };
  return (
    <Card
      title={title}
      icon={Download}
      aside={
        items.length > 1 ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={saveAll}>
            Save all
          </button>
        ) : undefined
      }
    >
      <ul className="grid gap-1">
        {items.map((it) => (
          <li key={it.name} className="flex items-center gap-2.5">
            <span className="tag" data-family={familyOf(extOf(it.name))}>
              {extOf(it.name) || "file"}
            </span>
            <span className="min-w-0 flex-1 truncate" title={it.name}>
              {it.name}
            </span>
            <span className="mono text-[0.6875rem] text-muted">{formatBytes(it.blob.size)}</span>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => downloadBlob(it.blob, it.name)} aria-label={`Save ${it.name}`}>
              <Download size={14} />
              Save
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
