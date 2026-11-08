import type { ReactNode } from "react";
import {
  Archive, BookOpen, Captions, Clapperboard, Clock3, Eye, FileSpreadsheet,
  FileText, Layers3, Palette, Settings2, Wrench,
  type LucideIcon,
} from "lucide-react";
import { appIcon } from "./brand";
import { t, type LanguageCode, type LangKey } from "./localization";

export type DesktopPage =
  | "convert" | "media" | "mediaTools" | "archives" | "documents"
  | "subtitles" | "spreadsheets" | "preview" | "ebooks"
  | "engines" | "activity" | "appearance" | "guide";

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
  { id: "engines", icon: Wrench, label: "Engines" },
];

export function isWorkspacePage(page: DesktopPage): boolean {
  return workspace.some(item => item.id === page);
}
export function isPreferencesPage(page: DesktopPage): boolean {
  return page === "appearance" || page === "engines";
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
    {inWorkspace ? <nav aria-label="Workspace tools">
      {workspace.map(item => <NavButton key={item.id} icon={item.icon}
        active={page === item.id} onClick={() => navigate(item.id)}>
        {item.translation ? t(language, item.translation) : item.label}
      </NavButton>)}
    </nav> : inSettings ? <nav aria-label="Preferences">
      {settings.map(item => <NavButton key={item.id} icon={item.icon}
        active={page === item.id} onClick={() => navigate(item.id)}>{item.label}</NavButton>)}
    </nav> : <div className="subnav-context">
      {page === "activity" ? "Recent conversions" : "Getting started"}
    </div>}
  </aside>;
}
