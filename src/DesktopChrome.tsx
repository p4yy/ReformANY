import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Archive, BookOpen, Captions, ChevronLeft, ChevronRight, Clapperboard, Clock3, Eye, FileSpreadsheet,
  FileText, Layers3, Palette, Settings2, Wrench,
  type LucideIcon,
} from "lucide-react";
import { appIcon } from "./brand";
import { t, type LanguageCode, type LangKey } from "./localization";

export type DesktopPage =
  | "convert" | "media" | "mediaTools" | "archives" | "documents"
  | "subtitles" | "spreadsheets" | "preview" | "ebooks"
  | "engines" | "activity" | "appearance" | "files" | "guide";

const workspace: ReadonlyArray<{ id: DesktopPage; icon: LucideIcon; label: string; translation?: LangKey }> = [
  { id: "convert", icon: Layers3, label: "images", translation: "images" },
  { id: "media", icon: Clapperboard, label: "media", translation: "media" },
  { id: "mediaTools", icon: Wrench, label: "Media tools" },
  { id: "archives", icon: Archive, label: "archives", translation: "archives" },
  { id: "documents", icon: FileText, label: "documents", translation: "documents" },
  { id: "subtitles", icon: Captions, label: "Subtitles" },
  { id: "spreadsheets", icon: FileSpreadsheet, label: "Spreadsheets" },
  { id: "preview", icon: Eye, label: "Preview" },
  { id: "ebooks", icon: BookOpen, label: "E-books" },
];
const settings: ReadonlyArray<{ id: DesktopPage; icon: LucideIcon; label: string }> = [
  { id: "appearance", icon: Palette, label: "Appearance" },
  { id: "files", icon: FileText, label: "Files & jobs" },
  { id: "engines", icon: Wrench, label: "Engines" },
];

export function isWorkspacePage(page: DesktopPage): boolean {
  return workspace.some(item => item.id === page);
}
export function isPreferencesPage(page: DesktopPage): boolean {
  return page === "appearance" || page === "files" || page === "engines";
}

function NavButton({ icon: Icon, active, children, onClick }: {
  icon: LucideIcon; active: boolean; children: ReactNode; onClick: () => void;
}) {
  return <button type="button" className={`nav-button ${active ? "selected" : ""}`}
    aria-current={active ? "page" : undefined} onClick={onClick}>
    <Icon size={17} strokeWidth={1.85} aria-hidden="true" />
    <span className="nav-button-label">{children}</span>
  </button>;
}

function WorkspaceToolbar({ page, navigate, language }: {
  page: DesktopPage;
  navigate: (page: DesktopPage) => void;
  language: LanguageCode;
}) {
  const viewport = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const syncEdges = useCallback(() => {
    const element = viewport.current;
    if (!element) return;
    const available = Math.max(0, element.scrollWidth - element.clientWidth);
    // Chromium/WebView2 uses negative scrollLeft for RTL navigation.
    // The arrows always indicate the physical direction of remaining content.
    const rtl = getComputedStyle(element).direction === "rtl";
    const offset = rtl ? -element.scrollLeft : element.scrollLeft;
    const left = rtl ? offset < available - 3 : offset > 3;
    const right = rtl ? offset > 3 : offset < available - 3;
    setEdges(previous => previous.left === left && previous.right === right
      ? previous : { left, right });
  }, []);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    syncEdges();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(syncEdges);
    observer?.observe(element);
    element.addEventListener("scroll", syncEdges, { passive: true });
    window.addEventListener("resize", syncEdges);
    return () => {
      observer?.disconnect();
      element.removeEventListener("scroll", syncEdges);
      window.removeEventListener("resize", syncEdges);
    };
  }, [syncEdges, language]);

  return <div className="workspace-navigation">
    <nav ref={viewport} aria-label="Workspace tools">
      {workspace.map(item => <NavButton key={item.id} icon={item.icon}
        active={page === item.id} onClick={() => navigate(item.id)}>
        {item.translation ? t(language, item.translation) : item.label}
      </NavButton>)}
    </nav>
    <button type="button" aria-label="Scroll workspace tools left"
      className={`workspace-scroll workspace-scroll-prev ${edges.left ? "is-visible" : ""}`}
      disabled={!edges.left} onClick={() => viewport.current?.scrollBy({ left: -230, behavior: "smooth" })}>
      <ChevronLeft size={16} aria-hidden="true"/>
    </button>
    <button type="button" aria-label="Scroll workspace tools right"
      className={`workspace-scroll workspace-scroll-next ${edges.right ? "is-visible" : ""}`}
      disabled={!edges.right} onClick={() => viewport.current?.scrollBy({ left: 230, behavior: "smooth" })}>
      <ChevronRight size={16} aria-hidden="true"/>
    </button>
  </div>;
}

export default function DesktopChrome({ page, navigate, historyCount, language }: {
  page: DesktopPage;
  navigate: (page: DesktopPage) => void;
  historyCount: number;
  language: LanguageCode;
}) {
  const inWorkspace = isWorkspacePage(page);
  const inSettings = isPreferencesPage(page);
  return <aside className="sidebar" aria-label="ReformANY navigation">
    <div className="brand">
      <span className="brand-mark"><img src={appIcon} alt="" width="34" height="34" /></span>
      <span>Reform<span className="brand-any">ANY</span></span>
    </div>
    <nav className="primary-navigation" aria-label="Primary navigation">
      <NavButton icon={Layers3} active={inWorkspace} onClick={() => navigate("convert")}>{t(language, "workspace")}</NavButton>
      <NavButton icon={Clock3} active={page === "activity"} onClick={() => navigate("activity")}>
        {t(language, "activity")} {historyCount > 0 && <span className="nav-count">{historyCount}</span>}
      </NavButton>
      <NavButton icon={BookOpen} active={page === "guide"} onClick={() => navigate("guide")}>Guide</NavButton>
      <NavButton icon={Settings2} active={inSettings} onClick={() => navigate("appearance")}>{t(language, "preferences")}</NavButton>
    </nav>
    {inWorkspace ? <WorkspaceToolbar page={page} navigate={navigate} language={language}/>
      : inSettings ? <nav aria-label="Preferences">
      {settings.map(item => <NavButton key={item.id} icon={item.icon}
        active={page === item.id} onClick={() => navigate(item.id)}>{item.label}</NavButton>)}
    </nav> : <div className="subnav-context">
      {page === "activity" ? "Recent conversions" : "Getting started"}
    </div>}
  </aside>;
}
