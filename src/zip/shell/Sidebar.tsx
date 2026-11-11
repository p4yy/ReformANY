import { useLayoutEffect, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useSettings } from "../lib/settings";
import { NAV, type NavDef, type PageId } from "./nav";

export function Sidebar({
  active,
  onNavigate,
  collapsed,
  canToggle,
  onToggle,
  altHints,
  badges,
}: {
  active: PageId;
  onNavigate: (id: PageId) => void;
  collapsed: boolean;
  canToggle: boolean;
  onToggle: () => void;
  altHints: boolean;
  badges: Partial<Record<PageId, number>>;
}) {
  const { t, settings } = useSettings();
  const navRef = useRef<HTMLElement>(null);
  const [ind, setInd] = useState<{ y: number; h: number } | null>(null);

  // FLIP-style shared indicator: one element glides to the active item.
  useLayoutEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const measure = () => {
      const cur = el.querySelector<HTMLElement>('[aria-current="page"]');
      if (cur) setInd({ y: cur.offsetTop, h: cur.offsetHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, collapsed, settings.language]);

  const item = (n: NavDef, hint?: number) => {
    const badge = badges[n.id];
    return (
      <button
        key={n.id}
        type="button"
        className="nav-item px-3.5"
        aria-current={active === n.id ? "page" : undefined}
        aria-label={t(n.id)}
        title={collapsed ? t(n.id) : undefined}
        onClick={() => onNavigate(n.id)}
      >
        <n.icon size={16} />
        <span className="nav-label">{t(n.id)}</span>
        {altHints && hint != null ? (
          <span className="alt-hint" aria-hidden="true">
            {hint}
          </span>
        ) : badge ? (
          <span className="nav-badge" title={`${badge} new`}>
            {badge}
          </span>
        ) : null}
      </button>
    );
  };

  const workspace = NAV.filter((n) => n.group === "workspace");
  const app = NAV.filter((n) => n.group === "app");
  const prefs = NAV.filter((n) => n.group === "preferences");

  return (
    <aside className="sidebar" id="sidebar">
      <nav ref={navRef} className="nav" aria-label="Primary">
        {ind && <span className="nav-ind" aria-hidden="true" style={{ transform: `translateY(${ind.y}px)`, height: ind.h }} />}
        <p className="nav-group">{t("workspace")}</p>
        {workspace.map((n, i) => item(n, i + 1))}
        <div className="nav-rule" />
        {app.map((n, i) => item(n, i === 0 ? 0 : undefined))}
        <div className="nav-rule" />
        <p className="nav-group">{t("preferences")}</p>
        {prefs.map((n) => item(n))}
      </nav>
      <div className="sidebar-foot">
        {canToggle ? (
          <button
            type="button"
            className="nav-item px-3.5"
            onClick={onToggle}
            aria-label={t(collapsed ? "expand" : "collapse")}
            aria-expanded={!collapsed}
            aria-controls="sidebar"
            title={`${t(collapsed ? "expand" : "collapse")} (Ctrl+B)`}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            <span className="nav-label foot-label">{t("collapse")}</span>
            <span className="kbd foot-label">Ctrl B</span>
          </button>
        ) : (
          <span className="foot-label mono px-3.5 text-[0.65625rem] uppercase tracking-[0.14em] text-muted">Local only</span>
        )}
      </div>
    </aside>
  );
}
