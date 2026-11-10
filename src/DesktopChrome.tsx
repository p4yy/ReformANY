import { useState, type ReactNode } from "react";
import {
  Archive, BookOpen, Captions, ChevronLeft, ChevronRight, Clapperboard, Clock3,
  Eye, FileSpreadsheet, FileText, Layers3, Palette, Settings2, Wrench,
  type LucideIcon,
} from "lucide-react";
import { appIcon } from "./brand";
import { t, type LanguageCode, type LangKey } from "./localization";

export type DesktopPage =
  | "convert" | "media" | "mediaTools" | "archives" | "documents"
  | "subtitles" | "spreadsheets" | "preview" | "ebooks"
  | "engines" | "activity" | "appearance" | "files" | "guide";

const workspace: ReadonlyArray<{ id: DesktopPage; icon: LucideIcon; label: string; translation?: LangKey }> = [
  { id: "convert", icon: Layers3, label: "Images", translation: "images" },
  { id: "media", icon: Clapperboard, label: "Audio & video", translation: "media" },
  { id: "mediaTools", icon: Wrench, label: "Media tools" },
  { id: "archives", icon: Archive, label: "Archives", translation: "archives" },
  { id: "documents", icon: FileText, label: "Documents", translation: "documents" },
  { id: "subtitles", icon: Captions, label: "Subtitles" },
  { id: "spreadsheets", icon: FileSpreadsheet, label: "Spreadsheets" },
  { id: "preview", icon: Eye, label: "Preview" },
  { id: "ebooks", icon: BookOpen, label: "E-books" },
];
const preferences: ReadonlyArray<{ id: DesktopPage; icon: LucideIcon; label: string }> = [
  { id: "appearance", icon: Palette, label: "Appearance" },
  { id: "files", icon: FileText, label: "Files & jobs" },
  { id: "engines", icon: Wrench, label: "Engines" },
];
const SIDEBAR_STORAGE_KEY = "reformany:sidebar-collapsed";

export function isWorkspacePage(page: DesktopPage): boolean {
  return workspace.some(item => item.id === page);
}
export function isPreferencesPage(page: DesktopPage): boolean {
  return preferences.some(item => item.id === page);
}

function NavButton({ icon: Icon, active, label, collapsed, children, onClick }: {
  icon: LucideIcon; active: boolean; label: string; collapsed: boolean;
  children?: ReactNode; onClick: () => void;
}) {
  return <button type="button"
    className={"nav-button" + (active ? " selected" : "")}
    aria-label={label} title={collapsed ? label : undefined}
    aria-current={active ? "page" : undefined} onClick={onClick}>
    <Icon size={18} strokeWidth={1.8} aria-hidden="true"/>
    <span className="nav-button-label">{label}{children}</span>
  </button>;
}

export default function DesktopChrome({ page, navigate, historyCount, language }: {
  page: DesktopPage;
  navigate: (page: DesktopPage) => void;
  historyCount: number;
  language: LanguageCode;
}) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true"; }
    catch { return false; }
  });
  const toggle = () => {
    setCollapsed(previous => {
      try { localStorage.setItem(SIDEBAR_STORAGE_KEY, String(!previous)); }
      catch { /* storage may be unavailable */ }
      return !previous;
    });
  };
  const inWorkspace = isWorkspacePage(page);
  const inPreferences = isPreferencesPage(page);

  return <aside className={"sidebar reformany-sidebar" + (collapsed ? " is-collapsed" : "")}
    aria-label="ReformANY navigation">
    <div className="sidebar-heading">
      <div className="brand">
        <span className="brand-mark"><img src={appIcon} alt="" width="34" height="34"/></span>
        <span className="brand-wordmark">Reform<span className="brand-any">ANY</span></span>
      </div>
      <button className="sidebar-toggle" type="button" onClick={toggle}
        aria-label={collapsed ? "Expand navigation sidebar" : "Collapse navigation sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed}>
        {collapsed ? <ChevronRight size={18} aria-hidden="true"/> :
          <ChevronLeft size={18} aria-hidden="true"/>}
      </button>
    </div>
    <div className="sidebar-scroll">
      <nav className="primary-navigation" aria-label="Primary navigation">
        <NavButton icon={Layers3} label={t(language,"workspace")} collapsed={collapsed}
          active={inWorkspace} onClick={() => navigate("convert")}/>
        <NavButton icon={Clock3} label={t(language,"activity")} collapsed={collapsed}
          active={page === "activity"} onClick={() => navigate("activity")}>
          {historyCount > 0 && <span className="nav-count">{historyCount}</span>}
        </NavButton>
        <NavButton icon={BookOpen} label="Guide" collapsed={collapsed}
          active={page === "guide"} onClick={() => navigate("guide")}/>
        <NavButton icon={Settings2} label={t(language,"preferences")} collapsed={collapsed}
          active={inPreferences} onClick={() => navigate("appearance")}/>
      </nav>
      <div className="sidebar-divider"/>
      <div className="nav-label">Converters</div>
      <nav className="workspace-navigation" aria-label="Workspace tools">
        {workspace.map(item => <NavButton key={item.id} icon={item.icon}
          label={item.translation ? t(language,item.translation) : item.label}
          collapsed={collapsed} active={page === item.id}
          onClick={() => navigate(item.id)}/>)}
      </nav>
      <div className="sidebar-divider"/>
      <div className="nav-label">Settings</div>
      <nav className="preferences-navigation" aria-label="Preferences">
        {preferences.map(item => <NavButton key={item.id} icon={item.icon}
          label={item.label} collapsed={collapsed} active={page === item.id}
          onClick={() => navigate(item.id)}/>)}
      </nav>
    </div>
  </aside>;
}
