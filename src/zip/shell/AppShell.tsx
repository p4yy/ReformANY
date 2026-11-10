import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { Monitor, Moon, Orbit, PanelLeft, Sun, Volume2 } from "lucide-react";
import { ToastViewport } from "../components/Toasts";
import { LogoMark } from "../components/ui";
import { useActivity } from "../lib/activity";
import { installCloseToTray, isTauri, win, pickPaths, invoke } from "../lib/bridge";
import { useSettings } from "../lib/settings";
import { play } from "../lib/sound";
import { cx, reducedMotion } from "../lib/util";
import Activity from "../modules/Activity";
import Archives from "../modules/Archives";
import AudioVideo from "../modules/AudioVideo";
import Documents from "../modules/Documents";
import Ebooks from "../modules/Ebooks";
import Guide from "../modules/Guide";
import Images from "../modules/Images";
import MediaTools from "../modules/MediaTools";
import PrefsAppearance from "../modules/PrefsAppearance";
import PrefsEngines from "../modules/PrefsEngines";
import PrefsFiles from "../modules/PrefsFiles";
import Preview from "../modules/Preview";
import Spreadsheets from "../modules/Spreadsheets";
import Subtitles from "../modules/Subtitles";
import { OrbitStage } from "../orbit/OrbitStage";
import { CommandPalette, type Command } from "./CommandPalette";
import { NAV, ShellContext, isPageId, type PageId } from "./nav";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";

const PAGES: Record<PageId, ComponentType> = {
  images: Images,
  av: AudioVideo,
  media: MediaTools,
  archives: Archives,
  documents: Documents,
  subtitles: Subtitles,
  sheets: Spreadsheets,
  preview: Preview,
  ebooks: Ebooks,
  activity: Activity,
  guide: Guide,
  appearance: PrefsAppearance,
  files: PrefsFiles,
  engines: PrefsEngines,
};

const WORKSPACE = NAV.filter((n) => n.group === "workspace");
const fromHash = (): PageId => {
  const id = window.location.hash.replace(/^#\/?/, "");
  return isPageId(id) ? id : "images";
};

function useViewportWidth() {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

export default function AppShell() {
  const { settings, update, t } = useSettings();
  const entries = useActivity();
  const width = useViewportWidth();

  const [active, setActive] = useState<PageId>(fromHash);
  const [leaving, setLeaving] = useState<PageId | null>(null);
  const [visited, setVisited] = useState<Set<PageId>>(() => new Set([fromHash()]));
  const [palette, setPalette] = useState(false);
  const [orbit, setOrbit] = useState(false);
  const [ring, setRing] = useState<{ x: number; y: number } | null>(null);
  const [altHeld, setAltHeld] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [away, setAway] = useState<null | "tray" | "closed">(null);
  const [seenAt, setSeenAt] = useState(() => Date.now());

  const activeRef = useRef(active);
  const leaveTimer = useRef(0);
  const pointer = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const live = useRef({ settings, busy: false, blocked: false });
  live.current.settings = settings;
  live.current.blocked = orbit || !!away;

  const navigate = useCallback((id: PageId) => {
    setDrawer(false);
    const prev = activeRef.current;
    if (prev === id) return;
    activeRef.current = id;
    setLeaving(prev);
    setActive(id);
    setVisited((v) => (v.has(id) ? v : new Set(v).add(id)));
    window.history.replaceState(null, "", `#/${id}`);
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setLeaving(null), 210);
  }, []);

  // In the desktop app the shake gesture opens Orbit; here a button/shortcut stands in,
  // with the same pointer ring the gesture shows while it is being recognised.
  const openOrbit = useCallback(() => {
    if (live.current.busy || live.current.blocked) return;
    // Native Orbit is a separate topmost, transparent Windows window, not an
    // overlay inside the main application. Reuse the same Rust launch command
    // used by Explorer, so desktop context and keyboard focus remain correct.
    if (isTauri) {
      void pickPaths({ multiple: false, directory: false, title: 'Choose a file for Orbit' })
        .then(paths => paths?.[0] ? invoke('orbit_launch_file', { path: paths[0] }) : undefined)
        .catch(error => import('../components/Toasts').then(({toast}) => toast({ tone: 'danger', title: 'Orbit could not open', body: String(error) })));
      return;
    }
    setPalette(false);
    if (live.current.settings.pointerRing && !reducedMotion()) {
      live.current.busy = true;
      setRing({ ...pointer.current });
      window.setTimeout(() => {
        live.current.busy = false;
        setRing(null);
        setOrbit(true);
      }, 340);
    } else setOrbit(true);
  }, []);

  const toggleSidebar = useCallback(() => update({ sidebarCollapsed: !live.current.settings.sidebarCollapsed }), [update]);

  useEffect(() => {
    const onHash = () => navigate(fromHash());
    const onMove = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("pointermove", onMove);
    };
  }, [navigate]);

  // Global shortcuts: Ctrl+K palette, Ctrl+B sidebar, Ctrl+Shift+Space Orbit, Alt overlay, Alt+digit.
  useEffect(() => {
    let altTimer = 0;
    const clearAlt = () => {
      window.clearTimeout(altTimer);
      setAltHeld(false);
    };
    const down = (e: KeyboardEvent) => {
      if (live.current.blocked) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (mod && key === "b") {
        e.preventDefault();
        toggleSidebar();
      } else if (mod && e.shiftKey && e.code === "Space") {
        e.preventDefault();
        openOrbit();
      } else if (e.key === "Alt" && !e.ctrlKey) {
        e.preventDefault();
        if (!e.repeat) altTimer = window.setTimeout(() => setAltHeld(true), 320);
      } else if (e.altKey && !mod && /^Digit\d$/.test(e.code)) {
        e.preventDefault();
        const n = Number(e.code.slice(5));
        const target = n === 0 ? "activity" : WORKSPACE[n - 1]?.id;
        if (target) navigate(target);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        e.preventDefault();
        clearAlt();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clearAlt);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clearAlt);
      window.clearTimeout(altTimer);
    };
  }, [navigate, openOrbit, toggleSidebar]);

  // Close-to-tray on desktop: every close request hides the window instead.
  useEffect(() => {
    let off = () => {};
    let dead = false;
    installCloseToTray(() => live.current.settings.closeToTray).then((u) => (dead ? u() : (off = u)));
    return () => {
      dead = true;
      off();
    };
  }, []);

  const onClose = () => {
    if (isTauri) void (settings.closeToTray ? win.hide() : win.quit());
    else setAway(settings.closeToTray ? "tray" : "closed");
  };

  useEffect(() => {
    if (active === "activity") setSeenAt(Date.now());
  }, [active, entries.length]);
  const unseen = active === "activity" ? 0 : entries.filter((e) => e.at > seenAt).length;

  const narrow = width < 720;
  const collapsed = !narrow && (width < 1040 || settings.sidebarCollapsed);

  const commands = useMemo<Command[]>(
    () => [
      ...NAV.map((n, i) => ({
        id: `go-${n.id}`,
        label: t(n.id),
        group: t(n.group),
        icon: n.icon,
        hint: n.group === "workspace" ? `Alt ${i + 1}` : n.id === "activity" ? "Alt 0" : undefined,
        run: () => navigate(n.id),
      })),
      { id: "orbit", label: "Summon Orbit", group: "Actions", icon: Orbit, hint: "Ctrl Shift Space", run: openOrbit },
      { id: "sidebar", label: "Toggle sidebar", group: "Actions", icon: PanelLeft, hint: "Ctrl B", run: toggleSidebar },
      { id: "sound", label: "Play Orbit test sound", group: "Actions", icon: Volume2, run: () => play("confirm", true) },
      { id: "theme-dark", label: "Theme: Dark", group: "Theme", icon: Moon, run: () => update({ theme: "dark" }) },
      { id: "theme-light", label: "Theme: Light", group: "Theme", icon: Sun, run: () => update({ theme: "light" }) },
      { id: "theme-system", label: "Theme: System", group: "Theme", icon: Monitor, run: () => update({ theme: "system" }) },
    ],
    [t, navigate, openOrbit, toggleSidebar, update],
  );

  const api = useMemo(() => ({ active, navigate, openOrbit }), [active, navigate, openOrbit]);

  return (
    <ShellContext.Provider value={api}>
      <div className="shell" data-hidden={!!away} inert={orbit || palette || !!away}>
        <TitleBar onPalette={() => setPalette(true)} onOrbit={openOrbit} onMenu={() => setDrawer((d) => !d)} onClose={onClose} />
        <div className="body" data-collapsed={collapsed} data-drawer={drawer}>
          <Sidebar
            active={active}
            onNavigate={navigate}
            collapsed={collapsed}
            canToggle={width >= 1040}
            onToggle={toggleSidebar}
            altHints={altHeld}
            badges={{ activity: unseen }}
          />
          <div className="drawer-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />
          <main className="main" id="main">
            {NAV.map((n) => {
              if (!visited.has(n.id)) return null;
              const Page = PAGES[n.id];
              const isActive = n.id === active;
              const isLeaving = n.id === leaving;
              return (
                <section
                  key={n.id}
                  className={cx("page", isActive && "page-in", isLeaving && "page-out")}
                  hidden={!isActive && !isLeaving}
                  aria-hidden={!isActive}
                  aria-label={t(n.id)}
                >
                  <div className="page-inner">
                    <Page />
                  </div>
                </section>
              );
            })}
          </main>
        </div>
      </div>

      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}

      {altHeld && !palette && !orbit && (
        <div className="alt-overlay" role="status">
          <span><span className="kbd">Alt 1–9</span> Workspace modules</span>
          <span><span className="kbd">Alt 0</span> Activity</span>
          <span><span className="kbd">Ctrl K</span> Command palette</span>
          <span><span className="kbd">Ctrl B</span> Sidebar</span>
          <span><span className="kbd">Ctrl Shift Space</span> Orbit</span>
        </div>
      )}

      {ring && (
        <svg className="pointer-ring" style={{ left: ring.x, top: ring.y }} viewBox="0 0 44 44" aria-hidden="true">
          <circle cx="22" cy="22" r="18" />
        </svg>
      )}

      {orbit && <OrbitStage onClose={() => setOrbit(false)} onNavigate={navigate} />}

      {away && (
        <div className="tray-state" role="dialog" aria-modal="true" aria-labelledby="away-title">
          <div className="card flex max-w-[26rem] flex-col items-center gap-3 !p-6 text-center">
            <LogoMark size={32} />
            <h2 id="away-title" className="font-serif text-[1.75rem] leading-tight">
              {away === "tray" ? "Hidden to the tray" : "Window closed"}
            </h2>
            <p className="text-soft text-pretty">
              {away === "tray"
                ? "ReformANY is still running, so Orbit stays one shake away. On Windows you bring the window back from the tray icon."
                : "Close to tray is off, so closing the window quits ReformANY and Orbit with it."}
            </p>
            <button type="button" className="btn btn-primary" autoFocus onClick={() => setAway(null)}>
              {away === "tray" ? "Restore window" : "Reopen ReformANY"}
            </button>
            <p className="mono text-[0.6875rem] text-muted">Browser preview of the close behaviour</p>
          </div>
        </div>
      )}

      <ToastViewport />
    </ShellContext.Provider>
  );
}
