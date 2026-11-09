import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { open } from "@tauri-apps/plugin-dialog";
import { getLanguage, setDocumentLanguage, t } from "./localization";
import { playOrbitHover, unlockOrbitAudio } from "./orbitAudio";
import { readOrbitMousePreferences, shortcutFromKeyboard, type OrbitSection } from "./orbitMousePreferences";
import { appIcon } from "./brand";
import OrbitActionDialog from "./OrbitActionDialog";
import PdfPageDialog, {type PdfPageAction, type PdfPageRequest} from "./PdfPageDialog";
import { convertPdfToPageImages, convertPdfToLayoutDocx } from "./pdfPageRender";
import PdfMarkDialog, {type PdfMark} from "./PdfMarkDialog";
import PdfArrangeDialog, {type PageEdit} from "./PdfArrangeDialog";
import PdfPasswordDialog, {type PdfPasswordRequest} from "./PdfPasswordDialog";
import ShredDialog from "./ShredDialog";
import OrbitNotice from "./OrbitNotice";
import { resolvePreferredDestination } from "./outputLocation";
import { orbitPoint, roundedOrbitSlice, orbitSectorAngles } from "./orbitGeometry";
import {
  Archive, ArrowRightLeft, Bluetooth, Check, CheckCircle2, Clapperboard,
  Copy, FileImage, FileSpreadsheet, FileText, FolderOpen,
  Layers3, LoaderCircle, LockKeyhole, Music2, Package, PanelsTopLeft,
  Pencil, Scissors, ShieldCheck, Smartphone, SquareTerminal, Wrench, Zap,
  type LucideIcon,
} from "lucide-react";

type OrbitFile = {
  path: string;
  name: string;
  bytes: number;
  detected: string | null;
  error: string | null;
};
type Phase = "ready" | "processing" | "completed" | "failed";
type Tab = "convert" | "tools" | "actions";
type EngineStatus = { ffmpeg: boolean; ffprobe: boolean; sevenZip: boolean; winrar: boolean };
type EngineProgressEvent = { id: string; percent: number | null; phase: string };
type EventPayload = {
  id: string;
  status: "processing" | "completed" | "failed" | "cancelled" | "batch-finished";
  outputPath: string | null;
  error: string | null;
};
const imageFormats = ["PNG", "JPEG", "WebP", "BMP", "GIF", "TIFF", "ICO", "TGA", "QOI", "AVIF"];
const audioFormats = ["MP3", "M4A", "WAV", "FLAC", "OGG", "Opus", "AIFF", "WMA", "AC3"];
const videoFormats = ["MP4", "MP4 H.265", "MOV", "MKV", "WebM", "AVI", "WMV", "GIF"];
type FileKind = "image" | "audio" | "video" | "archive" | "pdf" | "office" | "spreadsheet" | "subtitle" | "ebook" | "shortcut" | "application" | "folder" | "other";
function getKind(file: OrbitFile | null): FileKind {
  const value = (file?.detected || "").toLowerCase();
  const extension = file?.name.split(".").pop()?.toLowerCase() || "";
  if (value === "folder") return "folder";
  // Prefer exact extensions, including data/ebook files from older launchers.
  if (["csv", "tsv", "json", "xls", "xlsx", "ods"].includes(extension)) return "spreadsheet";
  if (["srt", "vtt"].includes(extension)) return "subtitle";
  if (["epub", "mobi", "fb2", "fbz", "azw", "azw3", "cbz", "cbr", "cb7", "htmlz"].includes(extension)) return "ebook";
  if (value === "pdf") return "pdf";
  if (value === "office" || ["txt", "htm", "html", "md", "markdown", "doc", "docx", "odt", "rtf"].includes(extension)) return "office";
  if (["spreadsheet", "subtitle", "ebook"].includes(value)) return value as FileKind;
  if (value === "shortcut") return "shortcut";
  if (value === "application") return "application";
  if (imageFormats.some(x => x.toLowerCase() === value) ||
      ["ico", "tga", "qoi", "svg", "image"].includes(value)) return "image";
  if (value === "audio" || value === "video" || value === "archive") return value;
  // Compatibility for older installed shell launchers that return "File".
  if (extension === "pdf") return "pdf";
  if (["lnk", "url"].includes(extension)) return "shortcut";
  if (["exe", "msi", "msix", "bat", "cmd"].includes(extension)) return "application";
  return "other";
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}


type OrbitAction = { label: string; run: () => void; unavailable?: string; danger?: boolean };

function orbitActionIcon(label: string, tab: Tab, kind: FileKind): LucideIcon {
  const value = label.toLowerCase();
  if (value.includes("password")) return LockKeyhole;
  if (value.includes("split")) return Scissors;
  if (value.includes("copy path") || value.includes("copy file") || value.includes("copy shortcut")) return Copy;
  if (value.includes("rename")) return Pencil;
  if (value.includes("terminal")) return SquareTerminal;
  if (value.includes("hover")) return PanelsTopLeft;
  if (value.includes("bluetooth")) return Bluetooth;
  if (value.includes("show") || value.includes("folder")) return FolderOpen;
  if (value.includes("extract") || value.includes("archive")) return Archive;
  if (value.includes("join")) return Layers3;
  if (value.includes("unblock")) return ShieldCheck;
  if (value.includes("phone")) return Smartphone;
  if (tab === "convert" && kind === "image") return FileImage;
  if (tab === "convert" && kind === "audio") return Music2;
  if (tab === "convert" && kind === "video") return Clapperboard;
  if (tab === "convert" && kind === "spreadsheet") return FileSpreadsheet;
  if (tab === "convert" && ["pdf", "office", "subtitle", "ebook"].includes(kind)) return FileText;
  if (value === "7z" || value === "zip") return Package;
  return tab === "convert" ? ArrowRightLeft : tab === "tools" ? Wrench : Zap;
}

/** Sector geometry, icon spacing and focus behavior follow the uploaded React
 * RadialMenu implementation. Items remain real Tauri commands, not sample data. */
function OrbitRing({ items, inner, outer, label, tab, kind }: {
  items: OrbitAction[]; inner: number; outer: number;
  label: string; tab: Tab; kind: FileKind;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState(0);
  if (!items.length) return null;
  return <svg className="orbit-ref-svg" viewBox="0 0 560 560" role="menu" aria-label={label}>
    {items.map((item, index) => {
      const { start, end } = orbitSectorAngles(items.length, index);
      const point = orbitPoint(inner + (outer - inner) * .53, (start + end) / 2);
      const words = item.label.split(" ");
      const multiLine = words.length > 1 && item.label.length > 10;
      const lines = multiLine ? [
        words.slice(0, Math.ceil(words.length / 2)).join(" "),
        words.slice(Math.ceil(words.length / 2)).join(" "),
      ] : [item.label];
      const iconSize = outer > 200 ? 20 : 23;
      const iconY = point.y - (lines.length * 17 + iconSize + 9) / 2;
      const Icon = hovered === item.label ? Check : orbitActionIcon(item.label, tab, kind);
      // Hover or keyboard focus highlights a single wedge; an idle menu stays neutral.
      const isActive = hovered === item.label;
      const disabled = Boolean(item.unavailable);
      return <g key={item.label}
        className="orbit-ref-sector"
        data-active={isActive && !disabled}
        data-disabled={disabled}
        data-danger={Boolean(item.danger)}
        data-ring={outer > 200 ? "outer" : "inner"}
        role="menuitem" tabIndex={disabled ? -1 : index === focused ? 0 : -1}
        aria-label={disabled ? `${item.label}: ${item.unavailable}` : item.label}
        aria-disabled={disabled} aria-description={item.unavailable || undefined}
        onClick={disabled ? undefined : item.run}
        onPointerEnter={() => { if (disabled) return; setHovered(item.label); setFocused(index); playOrbitHover(); }}
        onPointerLeave={() => setHovered(null)}
        onFocus={() => { if (!disabled) setFocused(index); }}
        onKeyDown={event => {
          if (disabled) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault(); item.run();
          } else if (event.key === "ArrowRight" || event.key === "ArrowDown" ||
            event.key === "ArrowLeft" || event.key === "ArrowUp") {
            event.preventDefault();
            const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
            let next = index;
            do { next = (next + direction + items.length) % items.length; }
            while (next !== index && items[next].unavailable);
            setFocused(next);
            (event.currentTarget.parentElement?.querySelectorAll<SVGGElement>('[role="menuitem"]')[next])?.focus();
          }
        }}>
        <title>{item.unavailable ? `${item.label} — ${item.unavailable}` : item.label}</title>
        <path className="orbit-ref-sector-surface" d={roundedOrbitSlice(inner, outer, start, end)}/>
        <g pointerEvents="none" aria-hidden="true" className="orbit-ref-sector-content">
          <Icon x={point.x - iconSize / 2} y={iconY} width={iconSize} height={iconSize} strokeWidth={1.55}/>
          <text className="orbit-ref-sector-label" x={point.x}
            y={iconY + iconSize + 21} textAnchor="middle">
            {lines.map((line, i) => <tspan key={i} x={point.x} dy={i ? 17 : 0}>{line}</tspan>)}
          </text>
        </g>
      </g>;
    })}
  </svg>;
}

export default function Orbit() {
  const [file, setFile] = useState<OrbitFile | null>(null);
  const [mousePreferences] = useState(readOrbitMousePreferences);
  const [tab, setTab] = useState<Tab>("convert");
  const [engines, setEngines] = useState<EngineStatus | null>(null);
  const [officeReady, setOfficeReady] = useState(false);
  const [calibreReady, setCalibreReady] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameBusy, setRenameBusy] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [partSize, setPartSize] = useState("5");
  const [pdfSplitMode, setPdfSplitMode] = useState<"size" | "parts" | "pages">("size");
  const [pdfDialog, setPdfDialog] = useState<PdfPageAction | null>(null);
  const [pdfCount, setPdfCount] = useState<number | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfMarkMode, setPdfMarkMode] = useState<"watermark"|"signature"|null>(null);
  const [arrangingPages, setArrangingPages] = useState(false);
  const [pdfPasswording, setPdfPasswording] = useState(false);
  const [shredding, setShredding] = useState(false);
  const [shredBusy, setShredBusy] = useState(false);
  const [shredError, setShredError] = useState<string|null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [passwording, setPasswording] = useState(false);
  const [archivePassword, setArchivePassword] = useState("");
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(true);
  const [phase, setPhaseState] = useState<Phase>("ready");
  // The native Orbit window must outlive the job even when Explorer takes focus.
  // Keep a synchronously updated ref: onFocusChanged is registered once.
  const phaseRef = useRef<Phase>("ready");
  const setPhase = (next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  };
  const [output, setOutput] = useState<string | null>(null);
  const [mediaProgress, setMediaProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const batchId = useRef<string | null>(null);
  const wheelSum = useRef(0);
  const nativeDialogOpen = useRef(false);
  const ignoreInitialFocus = useRef(true);
  const lastWheelAction = useRef(0);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const kind = getKind(file);
  const isFolder = file?.detected === "Folder";
  const isNativeZip = kind === "archive" && file?.name.toLowerCase().endsWith(".zip");
  const toolEditorOpen = renaming || splitting || passwording || Boolean(pdfDialog)
    || Boolean(pdfMarkMode) || arrangingPages || pdfPasswording || shredding;
  const toolEditorIsLarge = Boolean(pdfDialog) || Boolean(pdfMarkMode)
    || arrangingPages || pdfPasswording;
  const radialPosition = useRef<{ x: number; y: number } | null>(null);
  const toolEditorOpenRef = useRef(toolEditorOpen);
  toolEditorOpenRef.current = toolEditorOpen;

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      const choice = localStorage.getItem("reformany.theme");
      const dark = choice === "dark" || (choice !== "light" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    sync();
    media.addEventListener("change", sync);
    window.addEventListener("storage", sync);
    return () => {
      media.removeEventListener("change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    // WebView2 screen dimensions are in CSS/logical pixels. Native Tauri
    // window sizes use the same units through LogicalSize.
    // Keep the entire circle, section tabs and status visible above the taskbar.
    const availableWidth = Math.max(320, window.screen.availWidth - 32);
    const availableHeight = Math.max(350, window.screen.availHeight - 32);
    // Compact native Orbit window, scaling the original better.zip geometry.
    // Wheel plus dock, scaled as a single transparent native window.
    const factor = Math.min(420 / 560, availableWidth / 560, availableHeight / 640);
    document.documentElement.style.setProperty("--orbit-fit", String(factor));
    void getCurrentWindow().setSize(new LogicalSize(
      Math.round(560 * factor), Math.round(640 * factor),
    )).catch(() => { /* Keep the original size if Windows rejects the update. */ });
    return () => { document.documentElement.style.removeProperty("--orbit-fit"); };
  }, []);

  useEffect(() => {
    // Keep the radial launcher compact. Substantial editors become native,
    // independently resizable Windows surfaces with real title-bar dragging.
    // Return to the original compact Orbit position when the editor closes.
    document.documentElement.dataset.orbitEditor = toolEditorOpen ? "true" : "false";
    const win = getCurrentWindow();
    let stale = false;
    const resize = async () => {
      try {
        const fit = Math.min(420 / 560,
          Math.max(320, window.screen.availWidth - 32) / 560,
          Math.max(350, window.screen.availHeight - 32) / 640);
        if (toolEditorOpen) {
          if (radialPosition.current === null) {
            const position = await win.outerPosition();
            radialPosition.current = { x: position.x, y: position.y };
          }
          if (stale) return;
          // The native titlebar is intentional: drag, resize and Alt+F4
          // work exactly as in other Windows apps.
          await win.setResizable(true);
          await win.setDecorations(true);
          if (stale) return;
          const preferred = toolEditorIsLarge ? { w: 960, h: 700 } : { w: 760, h: 560 };
          const width = Math.min(preferred.w, Math.max(480, window.screen.availWidth - 48));
          const height = Math.min(preferred.h, Math.max(430, window.screen.availHeight - 72));
          await win.setSize(new LogicalSize(width, height));
          if (!stale) await win.center();
        } else {
          // Revert only when switching out of an editor, not on initial mount.
          if (radialPosition.current === null) return;
          await win.setResizable(false);
          await win.setDecorations(false);
          await win.setSize(new LogicalSize(Math.round(560 * fit), Math.round(640 * fit)));
          const old = radialPosition.current;
          radialPosition.current = null;
          if (!stale) await win.setPosition(new PhysicalPosition(old.x, old.y));
        }
      } catch (cause) {
        if (!stale) setError("Cannot resize Orbit tool window: " + String(cause));
      }
    };
    void resize();
    return () => { stale = true; };
  }, [toolEditorOpen, toolEditorIsLarge]);

  useEffect(() => {
    let mounted = true;
    setDocumentLanguage(getLanguage());
    invoke<OrbitFile | null>("orbit_context")
      .then(info => { if (mounted) setFile(info); })
      .catch(reason => { if (mounted) setError(String(reason)); })
      .finally(() => { if (mounted) setLoading(false); });

    invoke<EngineStatus>("engine_status")
      .then(status => { if (mounted) setEngines(status); })
      .catch(() => { /* External tools remain unavailable. */ });
    invoke<boolean>("office_available")
      .then(ready => { if (mounted) setOfficeReady(ready); })
      .catch(() => { /* Office conversion stays unavailable. */ });
    invoke<boolean>("ebook_engine_available")
      .then(ready => { if (mounted) setCalibreReady(ready); })
      .catch(() => { /* Optional e-book routes stay unavailable. */ });

    const mediaSubscribed = listen<EngineProgressEvent>("reformany:engine-progress", ({ payload }) => {
      if (payload.id !== requestId.current) return;
      if (payload.phase === "encoding") setMediaProgress(payload.percent);
      if (payload.phase === "completed") setMediaProgress(100);
    });
    const subscribed = listen<EventPayload>("reformany:conversion", ({ payload }) => {
      if (payload.id !== requestId.current) return;
      if (payload.status === "processing") {
        setPhase("processing");
      } else if (payload.status === "completed") {
        setOutput(payload.outputPath);
        setPhase("completed");
        batchId.current = null;
      } else if (payload.status === "failed" || payload.status === "cancelled") {
        setPhase("failed");
        setError(payload.error ?? (payload.status === "cancelled" ? "Conversion cancelled" : "Conversion failed"));
        batchId.current = null;
      }
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!document.querySelector("[data-orbit-dialog]")) {
          event.preventDefault();
          void close();
        }
        return;
      }
      if (phaseRef.current === "processing" || document.querySelector("[data-orbit-dialog]")) return;
      const shortcut=shortcutFromKeyboard(event);
      if (!shortcut) return;
      for (const section of ["convert","tools","actions"] as OrbitSection[]) {
        if (mousePreferences.shortcuts[section] === shortcut) {
          event.preventDefault();
          setTab(section);
          setError(null);setNote(null);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    const activationGuard = window.setTimeout(() => { ignoreInitialFocus.current = false; }, 350);
    // Windows transparency does not make the rectangle click-through.
    // Dismiss when another desktop window takes focus, even if Escape was not pressed.
    // Skip the initial window activation and dialogs opened by an Orbit action.
    const windowHandle = getCurrentWindow();
    const focusListener = windowHandle.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        ignoreInitialFocus.current = false;
      } else if (!ignoreInitialFocus.current && !nativeDialogOpen.current && !toolEditorOpenRef.current && phaseRef.current !== "processing") {
        void windowHandle.close();
      }
    });

    return () => {
      mounted = false;
      void subscribed.then(unlisten => unlisten());
      void mediaSubscribed.then(unlisten => unlisten());
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(activationGuard);
      void focusListener.then(unlisten => unlisten());
    };
  }, []);

  function handleWheel(event: ReactWheelEvent<HTMLElement>) {
    if (!mousePreferences.scrollSections || phase === "processing" || renaming) return;
    if (!Number.isFinite(event.deltaY)) return;
    const now = performance.now();
    if (now - lastWheelAction.current < 240) return;
    const amount = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 100 : event.deltaY;
    if (Math.sign(wheelSum.current) !== Math.sign(amount)) wheelSum.current = 0;
    wheelSum.current += amount;
    if (Math.abs(wheelSum.current) < 42) return;
    const direction = wheelSum.current > 0 ? 1 : -1;
    wheelSum.current = 0;
    lastWheelAction.current = now;
    const sections: Tab[] = ["convert", "tools", "actions"];
    setTab(previous => sections[(sections.indexOf(previous) + direction + sections.length) % sections.length]);
    setError(null);
    setNote(null);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    if (!mousePreferences.pointerSpinner || event.pointerType !== "mouse") return;
    const rect = event.currentTarget.getBoundingClientRect();
    setCursor({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  }

  async function close() {
    // Orbit is a standalone native process when launched from Explorer;
    // closing it during a job would kill FFmpeg before the file is published.
    if (phaseRef.current === "processing") {
      setNote("Conversion is running. Cancel it before closing Orbit.");
      return;
    }
    await getCurrentWindow().close();
  }

  async function convert(target: string) {
    if (!file || file.error || phase === "processing") return;
    const id = crypto.randomUUID();
    requestId.current = id;
    setSelected(target.toUpperCase());
    setPhase("processing");
    setOutput(null);
    setError(null);
    setNote(null);
    setMediaProgress(null);
    try {
      if (kind === "image" && target === "PDF") {
        const result = await invoke<string>("images_to_pdf", {
          paths: [file.path], destination: await resolvePreferredDestination(),
        });
        setOutput(result);
        setPhase("completed");
      } else if (kind === "image") {
        batchId.current = await invoke<string>("convert_batch", {
          files: [{ id, path: file.path, target: target.toLowerCase(),
            quality: 88, matte: "white", options: {} }],
          destination: await resolvePreferredDestination(),
        });
      } else if (kind === "video" || kind === "audio") {
        const result = await invoke<string>("media_convert", {
          job: { path: file.path, target: target === "MP4 H.265" ? "mp4_h265" : target.toLowerCase(), destination: await resolvePreferredDestination(),
            profile: "standard", startSeconds: null, durationSeconds: null, progressId: id },
        });
        setOutput(result);
        setPhase("completed");
      }
    } catch (reason) {
      batchId.current = null;
      setError(String(reason));
      setPhase("failed");
    }
  }

  async function convertDocument(target: "txt" | "md" | "html" | "pdf" | "png" | "jpg" | "docx-editable" | "docx-layout") {
    if (!file || file.error || phase === "processing") return;
    const isPdf = kind === "pdf";
    if (!isPdf && (kind !== "office" || target !== "pdf" || !officeReady)) return;
    setSelected(target.toUpperCase());
    setPhase("processing");
    setOutput(null);
    setError(null);
    setNote(null);
    try {
      if (isPdf && (target === "docx-editable" || target === "docx-layout")) {
        const destination = await resolvePreferredDestination();
        const result = target === "docx-layout"
          ? await convertPdfToLayoutDocx(file.path, destination)
          : await invoke<string>("pdf_docx_editable", {path:file.path,destination});
        if (!result) throw Error("PDF DOCX conversion returned no file");
        setOutput(result);
        setNote(target === "docx-layout"
          ? "Saved visual page-layout DOCX. Page images preserve appearance, but their text is not editable."
          : "Saved a flowing editable-text DOCX. Complex layouts may be simplified.");
      } else if (isPdf && (target === "png" || target === "jpg")) {
        const outputs = await convertPdfToPageImages(
          file.path, target, await resolvePreferredDestination(),
        );
        if (!outputs.length) throw new Error("PDF page renderer returned no images");
        setOutput(outputs[0]);
        setNote(`Saved ${outputs.length} full-page ${target.toUpperCase()} images beside the source or in the selected folder`);
      } else {
        const result = isPdf
          ? await invoke<string>("pdf_to_text_format", {
              path: file.path, target, destination: await resolvePreferredDestination(),
            })
          : await invoke<string>("office_to_pdf", { path: file.path, destination: await resolvePreferredDestination() });
        setOutput(result);
      }
      setPhase("completed");
    } catch (reason) {
      setError(String(reason));
      setPhase("failed");
    }
  }

  async function convertOther(target: string, command: "subtitle_convert" | "spreadsheet_convert" | "ebook_convert_file") {
    if (!file || file.error || phase === "processing") return;
    setSelected(target.toUpperCase());
    setPhase("processing");
    setError(null);
    setOutput(null);
    setNote(null);
    try {
      const result = await invoke<string>(command, {
        job: { path: file.path, target: target.toLowerCase(), destination: await resolvePreferredDestination() },
      });
      setOutput(result);
      setPhase("completed");
    } catch (reason) {
      setError(String(reason));
      setPhase("failed");
    }
  }

  async function archive(action: "zip" | "7z" | "tar" | "rar" | "extract") {
    if (!file || phase === "processing") return;
    setSelected(action === "extract" ? "Extract" : action.toUpperCase());
    setPhase("processing");
    setError(null);
    setOutput(null);
    setNote(null);
    try {
      if (action === "extract") {
        const result = await invoke<string>("archive_extract", {
          job: { path: file.path, destination: await resolvePreferredDestination(), password: null },
        });
        setOutput(result);
      } else {
        const name = (isFolder ? file.name : file.name.replace(/\.[^.]+$/, "")) || "Archive";
        const destination = await resolvePreferredDestination();
        const result = kind === "archive"
          ? await invoke<{ outputPaths: string[] }>("archive_repack", {
              path: file.path, target: action, destination,
            })
          : await invoke<{ outputPaths: string[] }>("archive_create", {
              job: { paths: [file.path], destination, name,
                format: action, password: null, splitMegabytes: null, level: 5 },
            });
        if (!result.outputPaths.length) throw new Error("Archive conversion returned no saved file");
        setOutput(result.outputPaths[0]);
      }
      setPhase("completed");
    } catch (reason) {
      setError(String(reason));
      setPhase("failed");
    }
  }

  async function act(action: "copy" | "folder" | "terminal" | "bluetooth" | "copyFile" | "hover") {
    if (!file) return;
    setNote(null);
    setError(null);
    try {
      if (action === "copy") {
        await navigator.clipboard.writeText(file.path);
        setNote("Path copied");
      } else if (action === "copyFile") {
        nativeDialogOpen.current = true;
        let destination: string | string[] | null;
        try {
          destination = await open({ directory: true, multiple: false });
          await getCurrentWindow().setFocus();
        } finally {
          nativeDialogOpen.current = false;
        }
        if (typeof destination !== "string") return;
        const result = await invoke<string>("copy_file_to", { path: file.path, destination });
        setNote("Copied: " + result.split(/[\\/]/).pop());
      } else if (action === "hover") {
        await invoke("hover_file", { path: file.path });
        await getCurrentWindow().close();
      } else if (action === "folder") {
        await invoke("reveal_output", { path: file.path });
        setNote("Opened in Explorer");
      } else if (action === "terminal") {
        await invoke("open_terminal", { path: file.path });
        setNote("Terminal opened");
      } else {
        const message = await invoke<string>("send_bluetooth", { path: file.path });
        setNote(message);
      }
    } catch (reason) { setError(String(reason)); }
  }


  async function splitFile() {
    if (!file || isFolder) return;
    const value = Number(partSize);
    const min = kind === "pdf" && pdfSplitMode === "parts" ? 2 : 1;
    if (!Number.isInteger(value) || value < min || value > 4096) {
      setError("Choose a valid PDF split setting or binary volume size");
      return;
    }
    setSplitting(false); setPhase("processing"); setSelected(kind === "pdf" ? "Split PDF" : "Split binary file");
    setError(null); setNote(null); setOutput(null);
    try {
      if (kind === "pdf") {
        const result = await invoke<{ outputPaths: string[]; oversizedPages: number[] }>("pdf_split", {
          path: file.path, destination: await resolvePreferredDestination(), mode: pdfSplitMode, value,
        });
        if (!result.outputPaths.length) throw new Error("PDF splitter returned no files");
        setOutput(result.outputPaths[0]);
        setNote(`Created ${result.outputPaths.length} standalone PDFs` +
          (result.oversizedPages.length ? `; pages ${result.oversizedPages.join(", ")} exceed the target size` : ""));
      } else {
        const result = await invoke<{ manifestPath: string }>("file_split", {
          path: file.path, destination: await resolvePreferredDestination(), partMegabytes: value,
        });
        setOutput(result.manifestPath);
        setNote("Binary part files need ReformANY Join Parts; they are not standalone documents.");
      }
      setPhase("completed");
    } catch (reason) { setError(String(reason)); setPhase("failed"); }
  }

  async function extractPdfImages() {
    if (!file || kind !== "pdf" || phaseRef.current === "processing") return;
    setPhase("processing"); setSelected("Extract images");
    setError(null); setNote(null); setOutput(null);
    try {
      const result = await invoke<{outputPaths:string[];skippedUnsupported:number}>("pdf_extract_images",{
        path:file.path, destination:await resolvePreferredDestination(),
      });
      if (!result.outputPaths.length) throw new Error("No extractable embedded images were produced");
      setOutput(result.outputPaths[0]);
      setNote(`Saved ${result.outputPaths.length} embedded image files`+
        (result.skippedUnsupported ? `; ${result.skippedUnsupported} unsupported assets skipped` : ""));
      setPhase("completed");
    } catch (reason) {setError(String(reason));setPhase("failed");}
  }

  async function openPdfTool(action: PdfPageAction) {
    if (!file || kind !== "pdf" || phaseRef.current === "processing") return;
    setPdfDialog(action); setPdfCount(null); setPdfError(null);
    try {
      const count = await invoke<number>("pdf_page_count", {path:file.path});
      if (count < 1) throw new Error("PDF has no pages");
      setPdfCount(count);
    } catch (reason) { setPdfError(String(reason)); }
  }

  async function runPdfTool(request: PdfPageRequest) {
    if (!file || !pdfDialog || pdfBusy) return;
    setPdfBusy(true); setPdfError(null); setPhase("processing");
    setSelected(pdfDialog === "extract" ? "Extract pages" : "Rotate pages");
    setError(null); setNote(null); setOutput(null);
    try {
      const destination = await resolvePreferredDestination();
      const result = pdfDialog === "extract"
        ? await invoke<string>("pdf_extract_pages", {
            path:file.path, pages:request.pages, destination,
          })
        : await invoke<string>("pdf_rotate_pages", {
            path:file.path, pages:request.pages, degrees:request.degrees, destination,
          });
      if (!result) throw new Error("PDF tool returned no output file");
      setOutput(result); setPdfDialog(null); setPhase("completed");
    } catch (reason) {
      setPhase("ready"); setPdfError(String(reason));
    } finally { setPdfBusy(false); }
  }

  async function applyPdfPassword(request:PdfPasswordRequest){
    if(!file||!pdfPasswording||pdfBusy)return;
    setPdfBusy(true);setPdfError(null);
    try{
      const result=await invoke<string>(request.mode==="protect"?"pdf_protect":"pdf_unlock",{
        path:file.path,password:request.password,destination:await resolvePreferredDestination(),
      });
      if(!result)throw new Error("PDF password worker created no document");
      setOutput(result);setSelected(request.mode==="protect"?"Protect PDF":"Unlock PDF");
      setPdfPasswording(false);setPhase("completed");
    }catch(e){setPdfError(String(e));}
    finally{setPdfBusy(false);}
  }
  async function openArrange(){
    if(!file||kind!=="pdf")return;
    setArrangingPages(true);setPdfCount(null);setPdfError(null);
    try{setPdfCount(await invoke<number>("pdf_page_count",{path:file.path}));}
    catch(e){setPdfError(String(e));}
  }
  async function saveArrangedPages(items:PageEdit[]){
    if(!file||!arrangingPages||pdfBusy)return;
    setPdfBusy(true);setPdfError(null);
    try{
      const result=await invoke<string>("pdf_arrange_pages",{
        path:file.path,items,destination:await resolvePreferredDestination(),
      });
      if(!result)throw Error("PDF arrange did not produce an output");
      setOutput(result);setSelected("Arrange Pages");
      setArrangingPages(false);setPhase("completed");
    }catch(cause){setPdfError(String(cause));}
    finally{setPdfBusy(false);}
  }
  async function applyPdfMark(mark:PdfMark){
    if(!file||pdfBusy||!pdfMarkMode)return;
    setPdfBusy(true);setPdfError(null);
    const mode=pdfMarkMode;
    try{
      const result=await invoke<string>("pdf_add_mark",{
        path:file.path,mark,visualSignature:mode==="signature",
        destination:await resolvePreferredDestination(),
      });
      if(!result)throw new Error("PDF marking returned no saved document");
      setOutput(result);setSelected(mode==="signature"?"Visual signature":"Watermark");
      setPdfMarkMode(null);setError(null);setPhase("completed");
    }catch(cause){setPdfError(String(cause));setPhase("ready");}
    finally{setPdfBusy(false);}
  }

  async function confirmShred(){
    if(!file||shredBusy||!shredding)return;
    setShredBusy(true);setShredError(null);setSelected("Shred");
    setPhase("processing");setError(null);setOutput(null);
    try{
      const result=await invoke<{fileCount:number;directories:number}>("shred_confirm",{
        path:file.path,confirmation:"SHRED",
      });
      setFile(null);setShredding(false);setPhase("completed");
      setNote("Permanently deleted "+result.fileCount+" files and "+result.directories+" folders. Secure erasure is not guaranteed on SSDs or cloud storage.");
    }catch(e){setShredError(String(e));setPhase("ready");}
    finally{setShredBusy(false);}
  }

  async function joinParts() {
    if (!file || !file.name.endsWith(".reformany.parts.json")) return;
    setPhase("processing"); setSelected("Join"); setError(null); setNote(null); setOutput(null);
    try {
      const result = await invoke<string>("file_join", {
        manifestPath: file.path, destination: await resolvePreferredDestination(),
      });
      setOutput(result); setPhase("completed");
    } catch (reason) { setError(String(reason)); setPhase("failed"); }
  }

  async function encryptedZip() {
    if (!file || !archivePassword) return;
    setPasswording(false); setPhase("processing"); setSelected("Password ZIP");
    setError(null); setNote(null); setOutput(null);
    try {
      const name = (isFolder ? file.name : file.name.replace(/\.[^.]+$/, "")) || "Archive";
      const result = await invoke<{ outputPaths: string[] }>("archive_create", {
        job: { paths: [file.path], destination: await resolvePreferredDestination(), name, format: "zip",
          password: archivePassword, splitMegabytes: null, level: 5 },
      });
      setOutput(result.outputPaths[0] || null); setPhase("completed");
    } catch (reason) { setError(String(reason)); setPhase("failed"); }
    finally { setArchivePassword(""); }
  }

  async function rename() {
    if (!file || renameBusy) return;
    setRenameBusy(true);
    setError(null);
    setNote(null);
    try {
      const result = await invoke<{ path: string; name: string }>("rename_file", {
        path: file.path, newName,
      });
      setFile({ ...file, path: result.path, name: result.name });
      setRenaming(false);
      setNote("Renamed successfully");
    } catch (reason) {
      // Keep the dialog editable with the actual filesystem error visible.
      setError(String(reason));
    } finally {
      setRenameBusy(false);
    }
  }

  async function reveal() {
    if (!output) return;
    try {
      await invoke("reveal_output", { path: output });
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function openWorkspace() {
    try { await invoke("orbit_open_workspace"); }
    catch (reason) { setError(String(reason)); }
  }

  async function cancel() {
    try {
      if (batchId.current) {
        await invoke("cancel_batch", { batchId: batchId.current });
      } else if ((kind === "video" || kind === "audio") && requestId.current) {
        await invoke("cancel_engine_job", { id: requestId.current });
      }
    } catch (reason) { setError(String(reason)); }
  }

  const canConvert = Boolean(file && file.detected && !file.error && !loading);
  const ext = (file?.name.split(".").at(-1) || "").toLowerCase();
  const detectedFormat = (file?.detected || "").toLowerCase();
  const mediaReady = Boolean(engines?.ffmpeg && engines?.ffprobe);
  const imageTargets = ["PDF", ...imageFormats].filter(format => format.toLowerCase() !== detectedFormat);
  const mediaTargets = (kind === "video" ? [...videoFormats, ...audioFormats] : audioFormats)
    .filter(format => format.toLowerCase() !== ext);
  const spreadsheetTargets = ["CSV", "TSV", "JSON", "XLSX"].filter(v => v.toLowerCase() !== ext);
  const subtitleTargets = ["SRT", "VTT"].filter(v => v.toLowerCase() !== ext);
  const ebookTargets = ["EPUB", "MOBI", "FB2", "AZW3", "DOCX", "PDF", "TXT", "RTF", "HTMLZ"]
    .filter(v => v.toLowerCase() !== ext);

  // A visible conversion choice always routes to a real Rust command. Media
  // formats remain visible but explicitly unavailable until FFmpeg is installed.
  const convertActions: OrbitAction[] = !canConvert ? [] :
    kind === "image" ? imageTargets.map(label => ({
      label, unavailable: label === "PDF" && ext === "svg"
        ? "SVG must first be converted to a raster image" : undefined,
      run: () => void convert(label),
    })) :
    kind === "video" || kind === "audio" ? mediaTargets.map(label => ({
      label, unavailable: mediaReady ? undefined : "Install FFmpeg and FFprobe",
      run: () => void convert(label),
    })) :
    kind === "pdf" ? [
      ...(["TXT", "MD", "HTML", "PNG", "JPG"] as const).map(label => ({
        label, run: () => void convertDocument(label.toLowerCase() as "txt" | "md" | "html" | "png" | "jpg"),
      })),
      {label:"DOCX · Editable",run:()=>void convertDocument("docx-editable")},
      {label:"DOCX · Layout",run:()=>void convertDocument("docx-layout")},
      ...(calibreReady ? ebookTargets.filter(label => !["TXT", "PDF"].includes(label)).map(label => ({
        label, run: () => void convertOther(label, "ebook_convert_file"),
      })) : []),
    ] :
    kind === "office" ? [
      { label: "PDF", unavailable: officeReady && ext !== "md" && ext !== "markdown" ? undefined
        : ext === "md" || ext === "markdown" ? "Markdown rendering is not available yet" : "LibreOffice is required",
        run: () => void convertDocument("pdf") },
      ...(calibreReady && ["docx", "odt", "rtf"].includes(ext)
        ? ebookTargets.filter(label => label !== "PDF").map(label => ({
            label, run: () => void convertOther(label, "ebook_convert_file"),
          })) : []),
    ] :
    kind === "spreadsheet" ? spreadsheetTargets.map(label => ({
      label, run: () => void convertOther(label, "spreadsheet_convert"),
    })) :
    kind === "subtitle" ? subtitleTargets.map(label => ({
      label, run: () => void convertOther(label, "subtitle_convert"),
    })) :
    kind === "ebook" && calibreReady ? ebookTargets.map(label => ({
      label, run: () => void convertOther(label, "ebook_convert_file"),
    })) :
    kind === "archive" || kind === "folder" ? [
      { label: "ZIP", unavailable: kind === "archive" && ext === "zip" ? "Already ZIP" : undefined,
        run: () => void archive("zip") },
      { label: "7Z", unavailable: !engines?.sevenZip ? "Install 7-Zip" :
          kind === "archive" && ext === "7z" ? "Already 7Z" : undefined,
        run: () => void archive("7z") },
      { label: "TAR", unavailable: !engines?.sevenZip ? "Install 7-Zip" :
          kind === "archive" && ext === "tar" ? "Already TAR" : undefined,
        run: () => void archive("tar") },
      ...(engines?.winrar ? [{ label: "RAR", unavailable: kind === "archive" && ext === "rar" ? "Already RAR" : undefined,
        run: () => void archive("rar") }] : []),
    ] : [];

  const description = file?.error ?? (loading ? "Reading file…"
    : kind === "pdf" ? "PDF · Text export"
    : kind === "office" && !officeReady && !calibreReady ? "LibreOffice or Calibre required"
    : kind === "ebook" && !calibreReady ? "Calibre required"
    : (kind === "video" || kind === "audio") && !mediaReady ? "FFmpeg and FFprobe required"
    : kind === "shortcut" || kind === "application" ? "Use Actions"
    : kind === "archive" ? "Choose an available archive format"
    : isFolder ? "Choose an archive format"
    : "No direct conversion for this file type");
  // A PDF tool is never placed in Convert, and a format is never a PDF Tool.
  // Unsupported operations are visibly disabled rather than run as placeholders.
  const pdfTools: OrbitAction[] = kind === "pdf" && canConvert ? [
    { label: "Split Pages", run: () => setSplitting(true) },
    { label: "Extract Pages", run: () => void openPdfTool("extract") },
    { label: "Rotate 90°", run: () => void openPdfTool("rotate") },
    { label: "Extract Images", run: () => void extractPdfImages() },
    { label: "Password", run: () => {setPdfError(null);setPdfPasswording(true);} },
    { label: "Arrange Pages", run: () => void openArrange() },
    { label: "Watermark", run: () => {setPdfError(null);setPdfMarkMode("watermark");} },
    { label: "Sign", run: () => {setPdfError(null);setPdfMarkMode("signature");} },
  ] : [];

  const innerActions: OrbitAction[] = tab === "convert"
    ? convertActions.slice(0, 5)
    : tab === "tools" ? kind === "pdf" ? pdfTools
      : [
        ...(kind === "archive" && (isNativeZip || engines?.sevenZip)
          ? [{label: "Extract archive", run: () => void archive("extract")}] : []),
      ]
    : file && !file.error ? [
      {label: "Rename", run: () => {setNewName(file.name);setRenaming(true);} },
      {label: "Copy path", run: () => void act("copy")},
      {label: "Terminal", run: () => void act("terminal")},
      ...(!isFolder && kind !== "shortcut" && kind !== "application"
        ? [{label: "HoveR", run: () => void act("hover")}] : []),
    ] : [];
  const outerActions: OrbitAction[] = tab === "convert"
    ? convertActions.slice(5)
    : tab === "tools" ? kind === "pdf" ? []
      : [
        {label: "More tools", run: () => void openWorkspace()},
        ...(file && !file.error && !isFolder && kind !== "shortcut" && kind !== "application" ? [{
          label: "Split binary file", run: () => setSplitting(true),
        }] : []),
        ...(file?.name.toLowerCase().endsWith(".reformany.parts.json") ? [{
          label: "Join parts", run: () => void joinParts(),
        }] : []),
        ...(file && !file.error ? [{
          label: "Password ZIP", run: () => setPasswording(true),
        }] : []),
      ]
    : file && !file.error ? [
      { label: isFolder ? "Open folder" : kind === "shortcut" ? "Show shortcut" : "Show file",
        run: () => void act("folder") },
      ...(kind !== "shortcut" && kind !== "application" ? [{
        label: "Shred", danger: true, run: () => {setShredError(null);setShredding(true);},
      }] : []),
      ...(!isFolder ? [
        { label: kind === "shortcut" ? "Copy shortcut" : "Copy file", run: () => void act("copyFile") },
        ...(kind !== "shortcut" && kind !== "application"
          ? [{label: "Bluetooth", run: () => void act("bluetooth")}] : []),
      ] : []),
    ] : [];

  const message = phase === "ready" && tab === "convert" &&
    (convertActions.length === 0 || convertActions.every(a => Boolean(a.unavailable)))
    ? description : null;
  const ringVisible = phase === "ready" || phase === "failed";

  return (
    <div className="orbit-frame" onPointerDown={event => {
      // Transparent corners are part of the native rectangular window.
      // Dismiss them explicitly without swallowing clicks on the three section tabs.
      if ((event.target as Element).closest(".orbit-section-tabs, .orbit-action-dialog")) return;
      const disc = event.currentTarget.querySelector(".orbit-disc");
      if (!disc) return;
      const rect = disc.getBoundingClientRect();
      const distance = Math.hypot(event.clientX - rect.left - rect.width / 2,
        event.clientY - rect.top - rect.height / 2);
      if (distance > rect.width / 2 - 1) void close();
    }}>
      <section className="orbit-disc" aria-label="ReformANY Orbit file menu"
        onWheel={handleWheel} onPointerMove={handlePointerMove}
        onPointerLeave={() => setCursor(null)} onPointerDownCapture={unlockOrbitAudio}>
        {ringVisible && <div key={tab} className="orbit-rings"
          role="group" aria-label={tab === "convert" ? "Convert to format" : tab === "tools" ? "File tools" : "File actions"}>
          {tab === "convert" ? <>
            {outerActions.length > 0 && <OrbitRing items={outerActions} inner={168} outer={246}
              label="Additional formats" tab={tab} kind={kind}/>}
            {innerActions.length > 0 && <OrbitRing items={innerActions} inner={72} outer={161}
              label="Formats" tab={tab} kind={kind}/>}
          </> : <OrbitRing items={[...innerActions, ...outerActions]} inner={72} outer={246}
            label={tab === "tools" ? "Tools" : "Actions"} tab={tab} kind={kind}/>}
          <div className="orbit-hub-outline" aria-hidden="true"/>
        </div>}
        <div className="orbit-hub">
          {(splitting || passwording || renaming) ? <>
            <img className="orbit-logo" src={appIcon} alt="ReformANY"/>
            <strong>{renaming ? "Rename" : splitting ? (kind === "pdf" ? "Split PDF" : "Split binary file") : "Password ZIP"}</strong>
          </> : phase === "processing" ? <>
            <LoaderCircle size={26} className="orbit-spinner" aria-hidden="true" />
            <strong>{selected} · Working</strong>
            <span className="orbit-hub-subtitle">{(kind === "audio" || kind === "video") && mediaProgress !== null ? `${mediaProgress}% · Encoding locally` : "Processing locally"}</span>
            {(kind === "image" || kind === "video" || kind === "audio") && <button className="orbit-hub-close" onClick={() => void cancel()}>Cancel</button>}
          </> : phase === "completed" ? <>
            <CheckCircle2 size={27} className="orbit-done-icon" aria-hidden="true" />
            <strong>Done</strong>
            <span className="orbit-hub-subtitle" title={output || ""}>{output?.split(/[\\/]/).pop()}</span>
            {selected!=="Shred" && <button className="orbit-hub-close" onClick={() => void reveal()}>Show result</button>}
            {selected==="Shred" && <span className="orbit-hub-subtitle">Permanently deleted</span>}
            <button className="orbit-hub-close" onClick={() => {if(selected==="Shred")void close();else {setPhase("ready"); setError(null);}}}>{selected==="Shred"?"Close":"Again"}</button>
          </> : <>
            <img className="orbit-logo" src={appIcon} alt="ReformANY" />
            <strong>{tab === "convert" ? "Convert" : tab === "tools" ? "Tools" : "Actions"}</strong>
            <span className="orbit-hub-subtitle" title={file?.name ?? ""}>
              {file?.name ?? (loading ? "Opening…" : "No file")}
            </span>
            <button type="button" className="orbit-hub-close" onClick={() => void close()}
              aria-label="Close Orbit">Esc · close</button>
          </>}
        </div>
        {phase === "processing" && mousePreferences.pointerSpinner && cursor && <span
          aria-hidden="true" className="orbit-pointer-spinner"
          style={{ left: cursor.x + 14, top: cursor.y + 11 }} />}
      </section>
        <nav className="orbit-section-tabs" aria-label="Orbit sections" role="tablist">
          <span className="orbit-tab-indicator" aria-hidden="true"
            style={{ transform: `translateX(${(["convert", "tools", "actions"] as Tab[]).indexOf(tab) * 100}%)` }}/>
          {(["convert", "tools", "actions"] as Tab[]).map(value =>
            <button type="button" role="tab" aria-selected={tab === value}
              key={value} className={tab === value ? "is-active" : ""}
              disabled={phase === "processing"} onClick={() => {
                setTab(value);setError(null);setNote(null);
                setRenaming(false);setSplitting(false);setPasswording(false);
                setArchivePassword("");setPhase("ready");
              }}>
              {value === "convert" ? <ArrowRightLeft size={15} aria-hidden="true"/> :
                value === "tools" ? <Wrench size={15} aria-hidden="true"/> :
                <Zap size={15} aria-hidden="true"/>}
              <span>{t(getLanguage(), value)}</span>
            </button>)}
        </nav>
        <div className="orbit-message" role="status" aria-live="polite"
          title={message || file?.name || ""}>
          {message || (file ? (isFolder ? "Folder" : file.detected || "File") + " · " + formatSize(file.bytes) : "Local · No uploads")}
        </div>
      {(error || note) && <OrbitNotice key={error || note}
        message={error || note || ""} error={Boolean(error)}
        onDismiss={() => { setError(null);setNote(null); }}/>}
      {shredding && file && <ShredDialog path={file.path} name={file.name}
        busy={shredBusy} error={shredError} onDelete={()=>void confirmShred()}
        onClose={()=>{if(!shredBusy){setShredding(false);setShredError(null);}}}/>}
      {pdfPasswording && file && <PdfPasswordDialog name={file.name} working={pdfBusy}
        error={pdfError} onSave={request=>void applyPdfPassword(request)}
        onClose={()=>{if(!pdfBusy){setPdfPasswording(false);setPdfError(null);}}}/>}
      {arrangingPages && file && pdfCount !== null && <PdfArrangeDialog
        path={file.path} name={file.name} pageCount={pdfCount} working={pdfBusy}
        error={pdfError} onSave={items=>void saveArrangedPages(items)}
        onClose={()=>{if(!pdfBusy){setArrangingPages(false);setPdfError(null);}}}/>}
      {pdfMarkMode && file && <PdfMarkDialog path={file.path} name={file.name}
        signature={pdfMarkMode==="signature"} working={pdfBusy} error={pdfError}
        onClose={() => {if(!pdfBusy){setPdfMarkMode(null);setPdfError(null);}}}
        onSave={mark=>void applyPdfMark(mark)}/>}
      {pdfDialog && file && <PdfPageDialog action={pdfDialog} name={file.name} pageCount={pdfCount}
        working={pdfBusy} error={pdfError} onSubmit={request => void runPdfTool(request)}
        onClose={() => {if (!pdfBusy) {setPdfDialog(null);setPdfError(null);}}}/>}
      {(renaming || splitting || passwording) && file && <OrbitActionDialog
        kind={renaming ? "rename" : splitting ? "split" : "password"}
        splitPdf={kind === "pdf"} splitMode={pdfSplitMode} onSplitMode={setPdfSplitMode}
        name={file.name} bytes={formatSize(file.bytes)}
        busy={renaming && renameBusy} error={error || undefined}
        value={renaming ? newName : splitting ? partSize : archivePassword}
        onValue={renaming ? setNewName : splitting ? setPartSize : setArchivePassword}
        onClose={() => {
          setRenaming(false);setSplitting(false);setPasswording(false);
          setArchivePassword("");setError(null);
        }}
        onSubmit={() => {
          if (renaming) void rename();
          else if (splitting) void splitFile();
          else void encryptedZip();
        }}/>}
    </div>
  );
}
