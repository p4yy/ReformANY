import { useState } from "react";
import { ChevronLeft, ChevronRight, Stamp, ZoomIn, ZoomOut } from "lucide-react";
import { Field, Segmented, Slider } from "../components/ui";
import { isTauri } from "../lib/bridge";
import { clamp } from "../lib/util";
import { commit } from "./data";
import { FauxPage, PanelShell, type DialogProps } from "./PanelShell";

const COLORS = [
  { value: "#4e8f72", label: "Steel green" },
  { value: "#2a3222", label: "Ink" },
  { value: "#c4886e", label: "Terracotta" },
  { value: "#7a876b", label: "Sage grey" },
];
const POSITIONS = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"] as const;
type Position = (typeof POSITIONS)[number];
const ALIGN: Record<string, string> = { top: "flex-start", bottom: "flex-end", left: "flex-start", right: "flex-end" };

/* ───────────── 3 · Watermark PDF ───────────── */
export function WatermarkDialog({ context, onClose }: DialogProps) {
  const pages = context.pages ?? 1;
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [text, setText] = useState("CONFIDENTIAL");
  const [color, setColor] = useState(COLORS[0].value);
  const [size, setSize] = useState(64);
  const [rotation, setRotation] = useState(-35);
  const [opacity, setOpacity] = useState(30);
  const [position, setPosition] = useState<Position>("center");
  const [scope, setScope] = useState<"all" | "current" | "range">("all");
  const [range, setRange] = useState("1-3");

  const rangeBad = scope === "range" && !/^\s*\d+(\s*-\s*\d+)?(\s*,\s*\d+(\s*-\s*\d+)?)*\s*$/.test(range);
  const valid = text.trim().length > 0 && !rangeBad;
  const [v, h] = position === "center" ? ["center", "center"] : [position.split("-")[0], position.split("-")[1] ?? position.split("-")[0]];
  const alignItems = ALIGN[["top", "bottom"].includes(v) ? v : ""] ?? "center";
  const justifyContent = ALIGN[["left", "right"].includes(h) ? h : ""] ?? "center";

  const submit = async () => {
    if (!valid) return;
    const ok = await commit(
      "watermark-pdf",
      context,
      { text: text.trim(), color, size, rotation, opacity: opacity / 100, position, scope, range: scope === "range" ? range : scope === "current" ? String(page) : "all" },
      { title: "Watermark PDF", previewBody: "Dry run on the sample PDF. The desktop app saves a new, watermarked copy next to the original." },
    );
    if (ok) onClose();
  };

  return (
    <PanelShell
      icon={Stamp}
      title="Watermark PDF"
      subtitle="Stamp text across pages and save a copy"
      context={context}
      width={56}
      flush
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!valid} onClick={submit}>
            <Stamp size={16} />
            Save as new PDF
          </button>
        </>
      }
    >
      <div className="grid min-h-0 grid-cols-1 min-[760px]:grid-cols-[minmax(0,1fr)_19rem]">
        {/* Live preview */}
        <div className="flex min-h-[18rem] min-w-0 flex-col border-b border-line bg-app min-[760px]:border-b-0 min-[760px]:border-r">
          <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
            <div className="flex items-center gap-1" role="group" aria-label="Page">
              <button type="button" className="btn btn-icon" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <ChevronLeft size={16} />
              </button>
              <span className="mono min-w-[3.5rem] text-center text-[0.75rem] text-soft" aria-live="polite">
                {page} / {pages}
              </span>
              <button type="button" className="btn btn-icon" aria-label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                <ChevronRight size={16} />
              </button>
            </div>
            <span className="label ml-2 max-[520px]:hidden">{isTauri ? "Live preview" : "Live preview · sample page"}</span>
            <div className="ml-auto flex items-center gap-1" role="group" aria-label="Zoom">
              <button type="button" className="btn btn-icon" aria-label="Zoom out" disabled={zoom <= 0.6} onClick={() => setZoom(clamp(+(zoom - 0.2).toFixed(1), 0.6, 2))}>
                <ZoomOut size={16} />
              </button>
              <button type="button" className="btn btn-quiet btn-sm mono !w-14 !px-0" aria-label="Reset zoom" onClick={() => setZoom(1)}>
                {Math.round(zoom * 100)}%
              </button>
              <button type="button" className="btn btn-icon" aria-label="Zoom in" disabled={zoom >= 2} onClick={() => setZoom(clamp(+(zoom + 0.2).toFixed(1), 0.6, 2))}>
                <ZoomIn size={16} />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <FauxPage n={page} className="mx-auto" style={{ width: `${17 * zoom}rem`, maxWidth: zoom <= 1 ? "100%" : undefined }}>
              <div className="pointer-events-none absolute inset-[6%] flex" style={{ alignItems, justifyContent }} aria-hidden="true">
                <b
                  style={{
                    color,
                    opacity: opacity / 100,
                    fontSize: `${(size / 595) * 100}cqw`,
                    transform: `rotate(${rotation}deg)`,
                    whiteSpace: "nowrap",
                    lineHeight: 1,
                    letterSpacing: "0.04em",
                    transition: "opacity 160ms, transform 200ms var(--ease)",
                  }}
                >
                  {text || " "}
                </b>
              </div>
            </FauxPage>
          </div>
        </div>

        {/* Controls */}
        <div className="grid content-start gap-3.5 p-3.5">
          <Field label="Text" htmlFor="wm-text">
            <input id="wm-text" data-autofocus className="field" maxLength={60} value={text} aria-invalid={!text.trim() || undefined} onChange={(e) => setText(e.target.value)} />
          </Field>
          <Field label="Colour">
            <div role="radiogroup" aria-label="Watermark colour" className="flex items-center gap-2.5">
              {COLORS.map((c) => (
                <button key={c.value} type="button" role="radio" aria-checked={color === c.value} aria-label={c.label} title={c.label} className="swatch" style={{ background: c.value }} onClick={() => setColor(c.value)} />
              ))}
              <label className="btn btn-ghost btn-sm relative cursor-pointer">
                Custom
                <input type="color" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="Custom watermark colour" value={color} onChange={(e) => setColor(e.target.value)} />
              </label>
            </div>
          </Field>
          <Field label="Size" htmlFor="wm-size">
            <Slider id="wm-size" label="Size" value={size} onChange={setSize} min={12} max={160} format={(x) => `${x} pt`} />
          </Field>
          <Field label="Rotation" htmlFor="wm-rot">
            <Slider id="wm-rot" label="Rotation" value={rotation} onChange={setRotation} min={-90} max={90} format={(x) => `${x}°`} />
          </Field>
          <Field label="Opacity" htmlFor="wm-op">
            <Slider id="wm-op" label="Opacity" value={opacity} onChange={setOpacity} min={5} max={100} format={(x) => `${x}%`} />
          </Field>
          <div className="flex items-start gap-4">
            <Field label="Position">
              <div role="radiogroup" aria-label="Watermark position" className="grid w-[5.25rem] grid-cols-3 gap-1">
                {POSITIONS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={position === p}
                    aria-label={p.replace("-", " ")}
                    title={p.replace("-", " ")}
                    className={`grid h-6 place-items-center rounded-[0.3125rem] border transition-colors ${position === p ? "border-bright bg-bright" : "border-line bg-app hover:border-accent"}`}
                    onClick={() => setPosition(p)}
                  >
                    <i className={`h-1 w-1 rounded-full ${position === p ? "bg-onaccent" : "bg-muted"}`} />
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Apply to" className="flex-1">
              <Segmented
                ariaLabel="Apply to"
                size="sm"
                value={scope}
                onChange={setScope}
                options={[
                  { value: "all", label: "All" },
                  { value: "current", label: `Page ${page}` },
                  { value: "range", label: "Range" },
                ]}
              />
              {scope === "range" && (
                <input className="field mono" aria-label="Page range" placeholder="1-3, 7" value={range} aria-invalid={rangeBad || undefined} onChange={(e) => setRange(e.target.value)} />
              )}
            </Field>
          </div>
        </div>
      </div>
    </PanelShell>
  );
}
