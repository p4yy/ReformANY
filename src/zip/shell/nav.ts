import { createContext, useContext } from "react";
import {
  BookOpen,
  Captions,
  Clapperboard,
  Compass,
  Cpu,
  FileArchive,
  FileText,
  FolderSync,
  History,
  Images,
  Palette,
  ScanEye,
  Sheet,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type PageId =
  | "images"
  | "av"
  | "media"
  | "archives"
  | "documents"
  | "subtitles"
  | "sheets"
  | "preview"
  | "ebooks"
  | "activity"
  | "guide"
  | "appearance"
  | "files"
  | "engines";

export interface NavDef {
  id: PageId;
  icon: LucideIcon;
  group: "workspace" | "app" | "preferences";
}

export const NAV: NavDef[] = [
  { id: "images", icon: Images, group: "workspace" },
  { id: "av", icon: Clapperboard, group: "workspace" },
  { id: "media", icon: Wrench, group: "workspace" },
  { id: "archives", icon: FileArchive, group: "workspace" },
  { id: "documents", icon: FileText, group: "workspace" },
  { id: "subtitles", icon: Captions, group: "workspace" },
  { id: "sheets", icon: Sheet, group: "workspace" },
  { id: "preview", icon: ScanEye, group: "workspace" },
  { id: "ebooks", icon: BookOpen, group: "workspace" },
  { id: "activity", icon: History, group: "app" },
  { id: "guide", icon: Compass, group: "app" },
  { id: "appearance", icon: Palette, group: "preferences" },
  { id: "files", icon: FolderSync, group: "preferences" },
  { id: "engines", icon: Cpu, group: "preferences" },
];

export const isPageId = (v: string): v is PageId => NAV.some((n) => n.id === v);

export interface ShellApi {
  active: PageId;
  navigate: (id: PageId) => void;
  openOrbit: () => void;
}

export const ShellContext = createContext<ShellApi>({ active: "images", navigate: () => {}, openOrbit: () => {} });
export const useShell = () => useContext(ShellContext);
