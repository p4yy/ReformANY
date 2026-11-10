import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type WheelEvent } from "react";
import { LogoMark, Segmented } from "../components/ui";
import { MOD_LABEL, SECTIONS, SECTION_LABEL, useSettings, type Section } from "../lib/settings";
import { play } from "../lib/sound";
import { formatBytes, reducedMotion } from "../lib/util";
import { wedgesFor, type OrbitContext, type OrbitItem } from "./data";

/* Disc geometry (SVG user units, centre at 0,0). Shared by all three sections. */
const HUB = 64;
const R_IN = 76;
const R_OUT = 214;

const polar = (r: number, deg: number): [number, number] => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [r * Math.cos(a), r * Math.sin(a)];
};
const n2 = (n: number) => n.toFixed(2);

function sector(r0: number, r1: number, a0: number, a1: number) {
  const [x0, y0] = polar(r1, a0);
  const [x1, y1] = polar(r1, a1);
  const [x2, y2] = polar(r0, a1);
  const [x3, y3] = polar(r0, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${n2(x0)} ${n2(y0)}A${r1} ${r1} 0 ${large} 1 ${n2(x1)} ${n2(y1)}L${n2(x2)} ${n2(y2)}A${r0} ${r0} 0 ${large} 0 ${n2(x3)} ${n2(y3)}Z`;
}

interface Wedge {
  item: OrbitItem;
  d: string;
  cx: number;
  cy: number;
  lx: number;
  ly: number;
  index: number;
  lines: string[];
}

function layout(items: OrbitItem[], section: Section): Wedge[] {
  const inner = items.filter((i) => !i.ring);
  const outer = items.filter((i) => i.ring === 1);
  const dual = outer.length > 0;
  const bands: Array<[OrbitItem[], number, number]> = dual
    ? [
        [inner, R_IN, 140],
        [outer, 144, R_OUT],
      ]
    : [[inner, R_IN, R_OUT]];
  const out: Wedge[] = [];
  let index = 0;
  for (const [ring, r0, r1] of bands) {
    const span = 360 / ring.length;
    ring.forEach((item, i) => {
      const a0 = i * span - span / 2;
      const mid = a0 + span / 2;
      const [cx, cy] = polar(r0 + (r1 - r0) * (dual ? 0.5 : 0.57), mid);
      const [lx, ly] = polar(4, mid);
      const sp = item.label.indexOf(" ");
      const split = section !== "convert" && ring.length >= 6 && sp > 0;
      out.push({
        item,
        d: sector(r0, r1, a0, a0 + span),
        cx,
        cy,
        lx,
        ly,
        index: index++,
        lines: split ? [item.label.slice(0, sp), item.label.slice(sp + 1)] : [item.label],
      });
    });
  }
  return out;
}

export function OrbitHUD({
  context,
  onPick,
  onClose,
  closeSignal = 0,
}: {
  context: OrbitContext;
  onPick: (item: OrbitItem, section: Section) => void;
  onClose: () => void;
  /** Increment to request the animated close from outside (e.g. scrim click). */
  closeSignal?: number;
}) {
  const { settings } = useSettings();
  const [section, setSection] = useState<Section>(settings.orbitStartSection);
  const [shown, setShown] = useState<Section>(settings.orbitStartSection);
  const [phase, setPhase] = useState<"in" | "out" | "fan">("in");
  const [closing, setClosing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const sectionRef = useRef(section);
  const closingRef = useRef(false);
  const lastWheel = useRef(0);
  const firstSignal = useRef(closeSignal);

  useEffect(() => {
    play("open");
    root.current?.focus({ preventScroll: true });
  }, []);

  const switchTo = useCallback((next: Section) => {
    if (closingRef.current || sectionRef.current === next) return;
    sectionRef.current = next;
    play("switch");
    setSection(next);
  }, []);

  // Section switch: inward collapse (90ms) → swap content → outward fan.
  useEffect(() => {
    if (section === shown) {
      setPhase((p) => (p === "out" ? "fan" : p));
      return;
    }
    if (reducedMotion()) {
      setShown(section);
      setPhase("fan");
      return;
    }
    setPhase("out");
    const t = window.setTimeout(() => {
      setShown(section);
      setPhase("fan");
    }, 90);
    return () => window.clearTimeout(t);
  }, [section, shown]);

  // Close: wedges fade, hub implodes (180ms), then the window/overlay goes away.
  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    play("close");
    setClosing(true);
    window.setTimeout(onClose, reducedMotion() ? 0 : 180);
  }, [onClose]);

  useEffect(() => {
    if (closeSignal !== firstSignal.current) close();
  }, [closeSignal, close]);

  // Esc closes. A bare tap of Shift / Ctrl / Alt (as mapped in settings) switches section.
  // Using the tap, not the press, keeps Shift+Tab and other chords working.
  useEffect(() => {
    const keys = settings.orbitKeys;
    let pending: string | null = null;
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.key === "Shift" || e.key === "Control" || e.key === "Alt") {
        if (!e.repeat) pending = e.key;
        if (e.key === "Alt") e.preventDefault();
        return;
      }
      pending = null;
    };
    const up = (e: KeyboardEvent) => {
      if (pending && e.key === pending) {
        const target = SECTIONS.find((s) => keys[s] === e.key);
        if (target) {
          e.preventDefault();
          switchTo(target);
        }
      }
      pending = null;
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
    };
  }, [settings.orbitKeys, close, switchTo]);

  const onWheel = (e: WheelEvent) => {
    if (!settings.orbitScrollSections || Math.abs(e.deltaY) < 6) return;
    const now = performance.now();
    if (now - lastWheel.current < 260) return;
    lastWheel.current = now;
    const i = SECTIONS.indexOf(sectionRef.current);
    switchTo(SECTIONS[(i + (e.deltaY > 0 ? 1 : -1) + SECTIONS.length) % SECTIONS.length]);
  };

  const onArrow = (e: ReactKeyboardEvent<SVGSVGElement>) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    const nodes = Array.from(e.currentTarget.querySelectorAll<SVGGElement>(".orbit-wedge"));
    const i = nodes.indexOf(document.activeElement as SVGGElement);
    if (i < 0) return;
    e.preventDefault();
    nodes[(i + dir + nodes.length) % nodes.length].focus();
  };

  const wedges = useMemo(() => layout(wedgesFor(context.kind, shown), shown), [context.kind, shown]);
  const count = wedgesFor(context.kind, section).length;
  const fire = (item: OrbitItem) => {
    if (!closingRef.current) onPick(item, shown);
  };

  const typeLabel = context.kind === "folder" ? "Folder" : context.ext.charAt(0).toUpperCase() + context.ext.slice(1);
  const sizeLabel = context.kind === "folder" ? `${context.items ?? 0} items` : formatBytes(context.size);

  return (
    <div
      ref={root}
      className="orbit-root focus:outline-none"
      data-closing={closing || undefined}
      tabIndex={-1}
      role="group"
      aria-label={`Orbit for ${context.name}`}
      onWheel={onWheel}
    >
      <div className="orbit-disc">
        <svg className="orbit-svg" viewBox="-250 -250 500 500" role="group" aria-label={`${SECTION_LABEL[shown]} for ${context.name}`} onKeyDown={onArrow}>
          <defs>
            <radialGradient id="orbit-hub-glow">
              <stop offset="0" style={{ stopColor: "var(--accent-dim)", stopOpacity: 0.6 }} />
              <stop offset="1" style={{ stopColor: "var(--accent-dim)", stopOpacity: 0 }} />
            </radialGradient>
          </defs>
          <circle className="disc-base" r={R_OUT + 1} />
          <g key={`${context.kind}-${shown}`} className="orbit-ring" data-phase={phase}>
            {wedges.map((w) => {
              const Icon = w.item.icon;
              const two = w.lines.length === 2;
              const code = shown === "convert";
              const name = code ? `Convert to ${w.item.label}${w.item.sub ? ` (${w.item.sub})` : ""}` : w.item.label;
              return (
                <g
                  key={w.item.id}
                  role="button"
                  tabIndex={0}
                  aria-label={name}
                  className="orbit-wedge"
                  data-danger={w.item.danger || undefined}
                  style={{ "--i": w.index, "--lx": `${w.lx.toFixed(1)}px`, "--ly": `${w.ly.toFixed(1)}px` } as CSSProperties}
                  onClick={() => fire(w.item)}
                  onPointerEnter={() => play("tick")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      fire(w.item);
                    }
                  }}
                >
                  <path className="w-bg" d={w.d} />
                  {Icon && <Icon className="w-icon" size={20} x={w.cx - 10} y={w.cy - (two ? 27 : 21)} />}
                  {Icon ? (
                    w.lines.map((line, li) => (
                      <text key={li} className="w-label" x={w.cx} y={w.cy + (two ? 8 : 13) + li * 13} textAnchor="middle">
                        {line}
                      </text>
                    ))
                  ) : (
                    <>
                      <text className="w-label is-code" x={w.cx} y={w.cy + (w.item.sub ? 0 : 4.5)} textAnchor="middle">
                        {w.item.label}
                      </text>
                      {w.item.sub && (
                        <text className="w-sub" x={w.cx} y={w.cy + 13} textAnchor="middle">
                          {w.item.sub}
                        </text>
                      )}
                    </>
                  )}
                </g>
              );
            })}
          </g>
          <g
            className="orbit-hub"
            role="button"
            tabIndex={0}
            aria-label="Close Orbit"
            onClick={close}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                close();
              }
            }}
          >
            <circle className="hub-bg" r={HUB} />
            <circle className="hub-glow" r={54} fill="url(#orbit-hub-glow)" />
            <LogoMark size={40} x={-20} y={-20} />
          </g>
        </svg>
      </div>

      <div className="orbit-foot">
        <Segmented
          className="orbit-bar"
          ariaLabel="Orbit section"
          value={section}
          onChange={switchTo}
          options={SECTIONS.map((s) => ({ value: s, label: SECTION_LABEL[s], kbd: MOD_LABEL[settings.orbitKeys[s]] }))}
        />
        <div className="orbit-meta" aria-live="polite">
          <span>
            {typeLabel} · {sizeLabel}
          </span>
          <em aria-hidden="true">|</em>
          <span>
            {section} · {count} actions
          </span>
        </div>
      </div>
    </div>
  );
}
