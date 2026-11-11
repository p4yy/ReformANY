import {
  Blocks,
  Bluetooth,
  Copy,
  FileLock2,
  FileOutput,
  FolderOpen,
  ImageDown,
  LayoutGrid,
  Link2,
  Lock,
  PencilLine,
  RotateCw,
  ScanEye,
  Scissors,
  Signature,
  SquareSplitHorizontal,
  SquareTerminal,
  Stamp,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { activity } from "../lib/activity";
import { CMD, invoke, isTauri } from "../lib/bridge";
import type { Section } from "../lib/settings";
import { toast } from "../components/Toasts";

export type Kind = "image" | "video" | "audio" | "pdf" | "folder" | "text";
export type DialogKind = "shred" | "rename" | "watermark" | "split" | "hover" | "arrange";

export interface OrbitContext {
  kind: Kind;
  name: string;
  ext: string;
  size: number | null;
  path: string;
  pages?: number;
  items?: number;
}

export interface OrbitItem {
  id: string;
  label: string;
  sub?: string;
  icon?: LucideIcon;
  /** 0 = inner (or only) ring, 1 = outer ring */
  ring?: 0 | 1;
  danger?: boolean;
  dialog?: DialogKind;
}

const fmt = (labels: string[], ring: 0 | 1 = 0): OrbitItem[] =>
  labels.map((l) => {
    const [label, sub] = l.split("|");
    return { id: `to-${l.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, label, sub, ring };
  });

const MEDIA: OrbitItem[] = [
  ...fmt(["MP4", "H.265", "AVI", "MOV", "WebM", "MKV"], 0),
  ...fmt(["WMV", "GIF", "AC3", "MP3", "WMA", "AIFF", "M4A", "Opus", "WAV", "OGG", "FLAC"], 1),
];

const CONVERT: Record<Kind, OrbitItem[]> = {
  image: fmt(["PNG", "TIFF", "PDF", "JPEG", "ICO", "TGA", "WebP", "BMP", "GIF", "QOI", "AVIF"]),
  video: MEDIA,
  audio: MEDIA,
  pdf: fmt(["DOCX|Editable", "TXT", "MD", "HTML", "DOCX|Layout", "PNG", "JPG"]),
  folder: fmt(["ZIP", "7Z", "TAR", "RAR"]),
  text: fmt(["PDF", "DOCX", "HTML", "MD", "TXT"]),
};

const passwordZip: OrbitItem = { id: "password-zip", label: "Password ZIP", icon: FileLock2 };
const moreTools: OrbitItem = { id: "more-tools", label: "More tools", icon: Blocks };
const splitBinary: OrbitItem = { id: "split-binary", label: "Split binary file", icon: SquareSplitHorizontal };
const FILE_TOOLS = [passwordZip, moreTools, splitBinary];

const TOOLS: Record<Kind, OrbitItem[]> = {
  image: FILE_TOOLS,
  video: FILE_TOOLS,
  audio: FILE_TOOLS,
  pdf: [
    { id: "sign", label: "Sign", icon: Signature },
    { id: "split-pages", label: "Split PDF", icon: Scissors, dialog: "split" },
    { id: "extract-pages", label: "Extract pages", icon: FileOutput },
    { id: "rotate-90", label: "Rotate 90°", icon: RotateCw },
    { id: "extract-images", label: "Extract images", icon: ImageDown },
    { id: "password", label: "Password", icon: Lock },
    { id: "arrange-pages", label: "Arrange pages", icon: LayoutGrid, dialog: "arrange" },
    { id: "watermark", label: "Watermark", icon: Stamp, dialog: "watermark" },
  ],
  folder: [moreTools, passwordZip],
  text: FILE_TOOLS,
};

const rename: OrbitItem = { id: "rename", label: "Rename", icon: PencilLine, dialog: "rename" };
const copyPath: OrbitItem = { id: "copy-path", label: "Copy path", icon: Link2 };
const terminal: OrbitItem = { id: "terminal", label: "Terminal", icon: SquareTerminal };
const shred: OrbitItem = { id: "shred", label: "Shred", icon: Trash2, danger: true, dialog: "shred" };

const FILE_ACTIONS: OrbitItem[] = [
  rename,
  copyPath,
  terminal,
  { id: "hover", label: "HoveR", icon: ScanEye, dialog: "hover" },
  { id: "show-file", label: "Show file", icon: FolderOpen },
  shred,
  { id: "copy-file", label: "Copy file", icon: Copy },
  { id: "bluetooth", label: "Bluetooth", icon: Bluetooth },
];
const FOLDER_ACTIONS: OrbitItem[] = [rename, copyPath, terminal, { id: "open-folder", label: "Open folder", icon: FolderOpen }, shred];

export function wedgesFor(kind: Kind, section: Section): OrbitItem[] {
  if (section === "convert") return CONVERT[kind];
  if (section === "tools") return TOOLS[kind];
  return kind === "folder" ? FOLDER_ACTIONS : FILE_ACTIONS;
}

/** Stand-ins for "the file under the pointer" when there is no Explorer (browser preview). */
export const SAMPLES: Record<Kind, OrbitContext> = {
  image: { kind: "image", name: "harbor-dawn.png", ext: "png", size: 175 * 1024, path: "C:\\Users\\you\\Pictures\\Exports\\harbor-dawn.png" },
  video: { kind: "video", name: "site-walkthrough.mov", ext: "mov", size: 248.6 * 1024 * 1024, path: "C:\\Users\\you\\Videos\\Site visit\\site-walkthrough.mov" },
  audio: { kind: "audio", name: "interview-take-03.wav", ext: "wav", size: 41.2 * 1024 * 1024, path: "C:\\Users\\you\\Music\\Recordings\\interview-take-03.wav" },
  pdf: { kind: "pdf", name: "lease-agreement-2025.pdf", ext: "pdf", size: 2.4 * 1024 * 1024, pages: 12, path: "C:\\Users\\you\\Documents\\Contracts\\lease-agreement-2025.pdf" },
  folder: { kind: "folder", name: "Q3 deliverables", ext: "", size: null, items: 38, path: "C:\\Users\\you\\Desktop\\Q3 deliverables" },
  text: { kind: "text", name: "meeting-notes.txt", ext: "txt", size: 1536, path: "C:\\Users\\you\\Documents\\meeting-notes.txt" },
};

/**
 * Send an Orbit action to the backend. In the browser preview there is no file on
 * disk, so the action is recorded as a dry run and says so.
 */
export async function commit(
  action: string,
  context: OrbitContext,
  payload: Record<string, unknown>,
  copy: { title: string; previewBody: string },
): Promise<boolean> {
  if (isTauri) {
    try {
      await invoke(CMD.orbitAction, { action, path: context.path, ...payload });
      toast({ tone: "success", title: copy.title, body: context.name });
      return true;
    } catch (e) {
      toast({ tone: "danger", title: "Action failed", body: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }
  activity.add({ module: "Orbit", title: `${copy.title} · ${context.name}`, detail: "Dry run on a sample selection · nothing written", status: "dry" });
  toast({ tone: "info", title: copy.title, body: copy.previewBody });
  return true;
}
