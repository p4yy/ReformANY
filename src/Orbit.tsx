import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { open } from "@tauri-apps/plugin-dialog";
import { getLanguage, setDocumentLanguage, t } from "./localization";
import { playOrbitHover, unlockOrbitAudio } from "./orbitAudio";
import { readOrbitMousePreferences } from "./orbitMousePreferences";
import { appIcon } from "./brand";
import { CheckCircle2, LoaderCircle } from "lucide-react";

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
type EventPayload = {
  id: string;
  status: "processing" | "completed" | "failed" | "cancelled" | "batch-finished";
  outputPath: string | null;
  error: string | null;
};
const imageFormats = ["PNG", "JPEG", "WebP", "BMP", "GIF", "TIFF", "ICO", "TGA", "QOI", "AVIF"];
const audioFormats = ["MP3", "WAV", "FLAC", "M4A", "OGG", "Opus"];
const videoFormats = ["MP4", "WebM", "MKV", "MOV", "AVI"];
type FileKind = "image" | "audio" | "video" | "archive" | "pdf" | "office" | "shortcut" | "application" | "folder" | "other";
function getKind(file: OrbitFile | null): FileKind {
  const value = (file?.detected || "").toLowerCase();
  const extension = file?.name.split(".").pop()?.toLowerCase() || "";
  if (value === "folder") return "folder";
  if (value === "pdf") return "pdf";
  if (value === "office") return "office";
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


type OrbitAction = { label: string; run: () => void };
const ORBIT_CENTER = 280;
function orbitPoint(radius: number, degrees: number) {
  const angle = (degrees - 90) * Math.PI / 180;
  return { x: ORBIT_CENTER + Math.cos(angle) * radius, y: ORBIT_CENTER + Math.sin(angle) * radius };
}
function orbitSlice(inner: number, outer: number, start: number, end: number) {
  const outerStart = orbitPoint(outer, start);
  const outerEnd = orbitPoint(outer, end);
  const innerEnd = orbitPoint(inner, end);
  const innerStart = orbitPoint(inner, start);
  const large = end - start > 180 ? 1 : 0;
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outer} ${outer} 0 ${large} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${inner} ${inner} 0 ${large} 0 ${innerStart.x} ${innerStart.y} Z`,
  ].join(" ");
}
function OrbitRing({ items, inner, outer, label }: {
  items: OrbitAction[]; inner: number; outer: number; label: string;
}) {
  return <g aria-label={label}>
    {items.map((item, index) => {
      const sector = 360 / items.length;
      // One-action rings render as a deliberate top arc, not a nearly
      // complete 360° click target with a barely visible seam.
      const start = items.length === 1 ? -68 : index * sector + 1.15;
      const end = items.length === 1 ? 68 : (index + 1) * sector - 1.15;
      const midpoint = orbitPoint((inner + outer) / 2, (start + end) / 2);
      const words = item.label.split(" ");
      const split = words.length > 1 && item.label.length > 11;
      const halves = split ? [
        words.slice(0, Math.ceil(words.length / 2)).join(" "),
        words.slice(Math.ceil(words.length / 2)).join(" "),
      ] : [item.label];
      return <g key={item.label} className="orbit-segment" role="button" tabIndex={0}
        aria-label={item.label} onClick={item.run}
        onPointerEnter={() => playOrbitHover()}
        onKeyDown={event => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            item.run();
          }
        }}>
        <title>{item.label}</title>
        <path d={orbitSlice(inner, outer, start, end)} />
        <text x={midpoint.x} y={midpoint.y} textAnchor="middle" dominantBaseline="middle">
          {halves.map((part, position) =>
            <tspan key={part} x={midpoint.x}
              dy={position === 0 ? (halves.length === 2 ? -6 : 0) : 15}>{part}</tspan>)}
        </text>
      </g>;
    })}
  </g>;
}

export default function Orbit() {
  const [file, setFile] = useState<OrbitFile | null>(null);
  const [mousePreferences] = useState(readOrbitMousePreferences);
  const [tab, setTab] = useState<Tab>(() => readOrbitMousePreferences().firstSection);
  const [engines, setEngines] = useState<EngineStatus | null>(null);
  const [officeReady, setOfficeReady] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [partSize, setPartSize] = useState("100");
  const [passwording, setPasswording] = useState(false);
  const [archivePassword, setArchivePassword] = useState("");
  const [newName, setNewName] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>("ready");
  const [output, setOutput] = useState<string | null>(null);
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

  useEffect(() => {
    // WebView2 screen dimensions are in CSS/logical pixels. Native Tauri
    // window sizes use the same units through LogicalSize.
    // Keep the entire circle, section tabs and status visible above the taskbar.
    const availableWidth = Math.max(320, window.screen.availWidth - 32);
    const availableHeight = Math.max(350, window.screen.availHeight - 32);
    const factor = Math.min(1, availableWidth / 580, availableHeight / 622);
    document.documentElement.style.setProperty("--orbit-fit", String(factor));
    if (factor < 0.999) {
      void getCurrentWindow().setSize(new LogicalSize(
        Math.round(580 * factor), Math.round(622 * factor),
      )).catch(() => { /* The original window remains usable if resizing is denied. */ });
    }
    return () => { document.documentElement.style.removeProperty("--orbit-fit"); };
  }, []);

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

    invoke<string | null>("orbit_preview")
      .then(src => { if (mounted) setPreview(src); })
      .catch(() => { /* Preview failure does not prevent conversion. */ });

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
        event.preventDefault();
        void close();
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
      } else if (!ignoreInitialFocus.current && !nativeDialogOpen.current) {
        void windowHandle.close();
      }
    });

    return () => {
      mounted = false;
      void subscribed.then(unlisten => unlisten());
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
    try {
      if (kind === "image") {
        batchId.current = await invoke<string>("convert_batch", {
          files: [{ id, path: file.path, target: target.toLowerCase(),
            quality: 88, matte: "white", options: {} }],
          destination: null,
        });
      } else if (kind === "video" || kind === "audio") {
        const result = await invoke<string>("media_convert", {
          job: { path: file.path, target: target.toLowerCase(), destination: null,
            profile: "standard", startSeconds: null, durationSeconds: null },
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

  async function convertDocument(target: "txt" | "md" | "html" | "pdf") {
    if (!file || file.error || phase === "processing") return;
    const isPdf = kind === "pdf";
    if (!isPdf && (kind !== "office" || target !== "pdf" || !officeReady)) return;
    setSelected(target.toUpperCase());
    setPhase("processing");
    setOutput(null);
    setError(null);
    setNote(null);
    try {
      const result = isPdf
        ? await invoke<string>("pdf_to_text_format", {
            path: file.path, target, destination: null,
          })
        : await invoke<string>("office_to_pdf", { path: file.path, destination: null });
      setOutput(result);
      setPhase("completed");
    } catch (reason) {
      setError(String(reason));
      setPhase("failed");
    }
  }

  async function archive(action: "zip" | "7z" | "extract") {
    if (!file || phase === "processing") return;
    setSelected(action === "extract" ? "Extract" : action.toUpperCase());
    setPhase("processing");
    setError(null);
    setOutput(null);
    setNote(null);
    try {
      if (action === "extract") {
        const result = await invoke<string>("archive_extract", {
          job: { path: file.path, destination: null, password: null },
        });
        setOutput(result);
      } else {
        const name = (isFolder ? file.name : file.name.replace(/\.[^.]+$/, "")) || "Archive";
        const result = await invoke<{ outputPaths: string[] }>("archive_create", {
          job: { paths: [file.path], destination: null, name,
            format: action, password: null, splitMegabytes: null, level: 5 },
        });
        setOutput(result.outputPaths[0] || null);
      }
      setPhase("completed");
    } catch (reason) {
      setError(String(reason));
      setPhase("failed");
    }
  }

  async function act(action: "copy" | "folder" | "terminal" | "bluetooth" | "copyFile" | "float") {
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
      } else if (action === "float") {
        await invoke("float_file", { path: file.path });
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
    const size = Number(partSize);
    if (!Number.isInteger(size) || size < 1 || size > 4096) {
      setError("Part size must be between 1 and 4096 MB");
      return;
    }
    setSplitting(false); setPhase("processing"); setSelected("Split");
    setError(null); setNote(null); setOutput(null);
    try {
      const result = await invoke<{ manifestPath: string }>("file_split", {
        path: file.path, destination: null, partMegabytes: size,
      });
      setOutput(result.manifestPath); setPhase("completed");
    } catch (reason) { setError(String(reason)); setPhase("failed"); }
  }

  async function joinParts() {
    if (!file || !file.name.endsWith(".reformany.parts.json")) return;
    setPhase("processing"); setSelected("Join"); setError(null); setNote(null); setOutput(null);
    try {
      const result = await invoke<string>("file_join", {
        manifestPath: file.path, destination: null,
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
        job: { paths: [file.path], destination: null, name, format: "zip",
          password: archivePassword, splitMegabytes: null, level: 5 },
      });
      setOutput(result.outputPaths[0] || null); setPhase("completed");
    } catch (reason) { setError(String(reason)); setPhase("failed"); }
    finally { setArchivePassword(""); }
  }

  async function rename() {
    if (!file) return;
    setError(null);
    try {
      const result = await invoke<{ path: string; name: string }>("rename_file", {
        path: file.path, newName,
      });
      setFile({ ...file, path: result.path, name: result.name });
      setRenaming(false);
      setNote("Renamed successfully");
    } catch (reason) { setError(String(reason)); }
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
    if (batchId.current) {
      try { await invoke("cancel_batch", { batchId: batchId.current }); }
      catch (reason) { setError(String(reason)); }
    }
  }

  const canConvert = Boolean(file && file.detected && !file.error && !loading);
  const allTargets = kind === "image" ? imageFormats
    : kind === "audio" ? audioFormats
    : kind === "video" ? videoFormats : [];
  const detectedFormat = (file?.detected || "").toLowerCase();
  const targets = allTargets.filter(format => format.toLowerCase() !== detectedFormat);
  const mediaReady = (kind !== "audio" && kind !== "video") || Boolean(engines?.ffmpeg && engines?.ffprobe);
  const description = file?.error ?? (loading ? "Reading file…"
    : kind === "pdf" ? "PDF · Choose TXT, Markdown or HTML"
    : kind === "office" ? officeReady ? "Office · Convert to PDF" : "PDF export requires LibreOffice"
    : kind === "shortcut" ? "Shortcut · Use Actions to manage it"
    : kind === "application" ? "Application · Use Actions to manage it"
    : kind === "archive" ? "Archive · Use Tools to extract"
    : isFolder ? "Folder · Use Tools to package it"
    : "No direct conversion for this file type");

  // Show only actions with implemented local command handlers for this file type.
  // No dummy PDF-to-DOCX or unsupported shortcut conversions are advertised.
  const documentFormats: OrbitAction[] = kind === "pdf" && canConvert ? [
    { label: "TXT", run: () => void convertDocument("txt") },
    { label: "Markdown", run: () => void convertDocument("md") },
    { label: "HTML", run: () => void convertDocument("html") },
  ] : kind === "office" && canConvert && officeReady ? [
    { label: "PDF", run: () => void convertDocument("pdf") },
  ] : [];

  const innerActions: OrbitAction[] = tab === "convert"
    ? documentFormats.length ? documentFormats
      : (canConvert && mediaReady ? targets.slice(0, 5).map(target => ({
          label: target, run: () => void convert(target),
        })) : [])
    : tab === "tools" ? [
        ...(kind === "archive"
          ? ((isNativeZip || engines?.sevenZip) && canConvert
            ? [{ label: "Extract", run: () => void archive("extract") }] : [])
          : canConvert ? [
              { label: "ZIP", run: () => void archive("zip") },
              ...(engines?.sevenZip ? [{ label: "7z", run: () => void archive("7z") }] : []),
            ] : []),
      ] : file && !file.error ? [
        { label: "Rename", run: () => { setNewName(file.name); setRenaming(true); } },
        { label: "Copy path", run: () => void act("copy") },
        { label: "Terminal", run: () => void act("terminal") },
        ...(!isFolder && kind !== "shortcut" && kind !== "application"
          ? [{ label: "Float", run: () => void act("float") }] : []),
      ] : [];
  const outerActions: OrbitAction[] = tab === "convert"
    ? (canConvert && mediaReady ? targets.slice(5).map(target => ({
        label: target, run: () => void convert(target),
      })) : [])
    : tab === "tools" ? [
        { label: kind === "pdf" || kind === "office" ? "Document tools" : "More tools", run: () => void openWorkspace() },
        ...(file && !file.error ? [{ label: isFolder ? "Open folder" : "Show file", run: () => void act("folder") }] : []),
        ...(file && !file.error && !isFolder && kind !== "shortcut" && kind !== "application" ? [{
          label: "Split into parts", run: () => setSplitting(true),
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
        ...(!isFolder ? [
          { label: kind === "shortcut" ? "Copy shortcut" : "Copy file", run: () => void act("copyFile") },
          ...(kind !== "shortcut" && kind !== "application"
            ? [{ label: "Bluetooth", run: () => void act("bluetooth") }] : []),
        ] : []),
      ] : [];

  const message = error || note || (phase === "ready" && tab === "convert" && innerActions.length === 0
    ? (canConvert && !mediaReady ? "FFmpeg and FFprobe are required for media conversion." : description)
    : null);
  const ringVisible = (phase === "ready" || phase === "failed") && !renaming && !splitting && !passwording;

  return (
    <div className="orbit-frame" onPointerDown={event => {
      // Transparent corners are part of the native rectangular window.
      // Dismiss them explicitly without swallowing clicks on the three section tabs.
      if ((event.target as Element).closest(".orbit-section-tabs")) return;
      const disc = event.currentTarget.querySelector(".orbit-disc");
      if (!disc) return;
      const rect = disc.getBoundingClientRect();
      const distance = Math.hypot(event.clientX - rect.left - rect.width / 2,
        event.clientY - rect.top - rect.height / 2);
      if (distance > rect.width * (264 / 560) + 1) void close();
    }}>
      <section className="orbit-disc" aria-label="ReformANY Orbit file menu"
        onWheel={handleWheel} onPointerMove={handlePointerMove}
        onPointerLeave={() => setCursor(null)} onPointerDownCapture={unlockOrbitAudio}>
        {ringVisible && <svg className="orbit-rings" viewBox="0 0 560 560"
          role="group" aria-label={tab === "convert" ? "Convert to format" : tab === "tools" ? "File tools" : "File actions"}>
          {outerActions.length > 0 && <OrbitRing items={outerActions} inner={187} outer={264} label="Outer actions" />}
          {innerActions.length > 0 && <OrbitRing items={innerActions} inner={106} outer={179} label="Inner actions" />}
          <circle className="orbit-hub-outline" cx="280" cy="280" r="99" />
        </svg>}
        <div className="orbit-hub">
          {splitting ? <form className="orbit-rename" onSubmit={event => {event.preventDefault(); void splitFile();}}>
            <label htmlFor="orbit-part-size">Part size (MB)</label>
            <input id="orbit-part-size" autoFocus type="number" min="1" max="4096" step="1"
              value={partSize} onChange={event => setPartSize(event.target.value)}/>
            <div className="orbit-rename-buttons">
              <button type="submit">Split</button>
              <button type="button" onClick={() => setSplitting(false)}>Cancel</button>
            </div>
          </form> : passwording ? <form className="orbit-rename" onSubmit={event => {event.preventDefault(); void encryptedZip();}}>
            <label htmlFor="orbit-zip-password">ZIP password</label>
            <input id="orbit-zip-password" autoFocus type="password" autoComplete="new-password"
              value={archivePassword} onChange={event => setArchivePassword(event.target.value)}
              minLength={1} maxLength={256} required/>
            <div className="orbit-rename-buttons">
              <button type="submit">Create</button>
              <button type="button" onClick={() => {setPasswording(false);setArchivePassword("");}}>Cancel</button>
            </div>
          </form> : renaming ? <form className="orbit-rename" onSubmit={event => {event.preventDefault(); void rename();}}>
            <label htmlFor="orbit-rename-file">Rename file</label>
            <input id="orbit-rename-file" autoFocus value={newName} onChange={event => setNewName(event.target.value)} />
            <div className="orbit-rename-buttons">
              <button type="submit">Save</button>
              <button type="button" onClick={() => setRenaming(false)}>Cancel</button>
            </div>
          </form> : phase === "processing" ? <>
            <LoaderCircle size={26} className="orbit-spinner" aria-hidden="true" />
            <strong>{selected} · Working</strong>
            <span className="orbit-hub-subtitle">Processing locally</span>
            {kind === "image" && <button className="orbit-hub-close" onClick={() => void cancel()}>Cancel</button>}
          </> : phase === "completed" ? <>
            <CheckCircle2 size={27} className="orbit-done-icon" aria-hidden="true" />
            <strong>Done</strong>
            <span className="orbit-hub-subtitle" title={output || ""}>{output?.split(/[\\/]/).pop()}</span>
            <button className="orbit-hub-close" onClick={() => void reveal()}>Show result</button>
            <button className="orbit-hub-close" onClick={() => {setPhase("ready"); setError(null);}}>Again</button>
          </> : <>
            <img className="orbit-logo" src={preview || appIcon} alt={preview ? "Selected file preview" : ""} />
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
      <nav className="orbit-section-tabs" aria-label="Orbit sections">
        {(["convert", "tools", "actions"] as Tab[]).map(value =>
          <button key={value} className={tab === value ? "is-active" : ""}
            disabled={phase === "processing"} onClick={() => {
              setTab(value);setError(null);setNote(null);setRenaming(false);setSplitting(false);setPasswording(false);setArchivePassword("");setPhase("ready");
            }}>
            {t(getLanguage(), value === "convert" ? "convert" : value === "tools" ? "tools" : "actions")}
          </button>)}
      </nav>
      <div className={error ? "orbit-message orbit-message-error" : "orbit-message"}
        role={error ? "alert" : "status"} aria-live="polite">{message || (file ? (isFolder ? "Folder" : file.detected || "File") + " · " + formatSize(file.bytes) : "Local · No uploads")}</div>
    </div>
  );
}
