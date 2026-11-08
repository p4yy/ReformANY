import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { getLanguage, setDocumentLanguage, t } from "./localization";
import { playOrbitHover, unlockOrbitAudio } from "./orbitAudio";
import { readOrbitMousePreferences } from "./orbitMousePreferences";
import { appIcon } from "./brand";
import { ArrowRight, CheckCircle2, FileImage, FolderOpen, LoaderCircle, X, Package, Bluetooth, ClipboardCopy, Pencil, Terminal, Copy, Pin } from "lucide-react";

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
const imageFormats = ["PNG", "JPEG", "WebP", "BMP", "GIF", "TIFF"];
const audioFormats = ["MP3", "WAV", "FLAC", "M4A"];
const videoFormats = ["MP4", "WebM", "MKV", "MOV"];
function getKind(file: OrbitFile | null): "image" | "audio" | "video" | "archive" | "other" {
  const value = (file?.detected || "").toLowerCase();
  if (imageFormats.some(x => x.toLowerCase() === value) || value === "image") return "image";
  if (value === "audio" || value === "video" || value === "archive") return value;
  return "other";
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export default function Orbit() {
  const [file, setFile] = useState<OrbitFile | null>(null);
  const [mousePreferences] = useState(readOrbitMousePreferences);
  const [tab, setTab] = useState<Tab>(() => readOrbitMousePreferences().firstSection);
  const [engines, setEngines] = useState<EngineStatus | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
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
  const lastWheelAction = useRef(0);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const kind = getKind(file);
  const isFolder = file?.detected === "Folder";
  const isNativeZip = kind === "archive" && file?.name.toLowerCase().endsWith(".zip");

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
    return () => {
      mounted = false;
      void subscribed.then(unlisten => unlisten());
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  function handleOrbitHover(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType !== "mouse" || !(event.target instanceof Element)) return;
    const button = event.target.closest("button");
    if (!button || !event.currentTarget.contains(button) || (button as HTMLButtonElement).disabled) return;
    // React pointerover bubbles when entering icons/spans inside the same button.
    if (event.relatedTarget instanceof Node && button.contains(event.relatedTarget)) return;
    playOrbitHover();
  }

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
        const destination = await open({ directory: true, multiple: false });
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
  const targets = kind === "image" ? imageFormats : kind === "audio" ? audioFormats : kind === "video" ? videoFormats : [];
  const mediaReady = kind === "image" || Boolean(engines?.ffmpeg && engines?.ffprobe);
  const description = file?.error ?? (loading ? "Reading file…" : isFolder ? "Open Tools to archive this folder" : "No direct conversion for this type");

  return (
    <div className="orbit-frame">
      <section className="orbit-disc" aria-label="ReformANY Orbit quick converter"
        onPointerOver={handleOrbitHover} onPointerMove={handlePointerMove}
        onPointerLeave={() => setCursor(null)}
        onWheel={handleWheel} onPointerDownCapture={unlockOrbitAudio}>
        <button type="button" className="orbit-close" aria-label="Close Orbit" onClick={() => void close()}>
          <X size={16} strokeWidth={2} />
        </button>

        <header className="orbit-header">
          <img src={appIcon} className="orbit-logo" alt="" />
          <span>ReformANY</span><span className="orbit-tag">Orbit</span>
        </header>

        <div className="orbit-file">
          <div className="orbit-thumbnail">
            {preview ? <img src={preview} alt="Selected image preview" /> : isFolder ? <FolderOpen size={30} strokeWidth={1.6} aria-hidden /> : <FileImage size={30} strokeWidth={1.6} aria-hidden />}
          </div>
          <strong className="orbit-filename" title={file?.name ?? undefined}>{file?.name ?? (loading ? "Opening file…" : "No file selected")}</strong>
          <span className="orbit-meta">
            {isFolder ? "Folder" : file?.detected ? `${file.detected} · ${formatSize(file.bytes)}` : canConvert ? "" : "Quick conversion"}
          </span>
        </div>

        <div className="orbit-divider" role="presentation" />

        <div className="orbit-main">
          {phase === "completed" ? <div className="orbit-result" role="status">
            <div className="orbit-success"><CheckCircle2 size={18}/> Done</div>
            <span className="orbit-result-name" title={output || undefined}>{output?.split(/[\\/]/).pop()}</span>
            <div className="orbit-result-actions">
              <button type="button" onClick={() => void reveal()}><FolderOpen size={15}/> Show result</button>
              <button type="button" onClick={() => {setPhase("ready");setError(null);}}>Again</button>
            </div>
          </div> : phase === "processing" ? <div className="orbit-working" role="status" aria-live="polite">
            <LoaderCircle size={20} className="orbit-spinner" />
            <strong>{selected} · Working…</strong>
            <div className="orbit-indeterminate"><span/></div>
            <small>Processing locally</small>
            {kind === "image" && <button className="orbit-cancel" onClick={() => void cancel()}>Cancel</button>}
          </div> : <>
            {tab === "convert" && <div className="orbit-controls">
              <span className="orbit-legend">QUICK CONVERT</span>
              {targets.length > 0 && canConvert && mediaReady
                ? <div className="orbit-options">
                  {targets.map(target => <button type="button" key={target}
                    className="orbit-option" onClick={() => void convert(target)}>
                      {target}<ArrowRight size={12}/>
                    </button>)}
                </div>
                : <div className="orbit-unavailable">
                    {canConvert && !mediaReady ? "FFmpeg and FFprobe must be installed for media." : description}
                  </div>}
            </div>}
            {tab === "tools" && <div className="orbit-controls">
              <span className="orbit-legend">QUICK TOOLS</span>
              <div className="orbit-options orbit-options-tools">
                {kind === "archive"
                  ? <button className="orbit-option" disabled={!canConvert || !(isNativeZip || engines?.sevenZip)} onClick={() => void archive("extract")}>
                      <Package size={15}/> Extract
                    </button>
                  : <>
                    <button className="orbit-option" disabled={!canConvert} onClick={() => void archive("zip")}><Package size={15}/> ZIP</button>
                    <button className="orbit-option" disabled={!canConvert || !engines?.sevenZip} onClick={() => void archive("7z")}><Package size={15}/> 7z</button>
                  </>}
                <button className="orbit-option" onClick={() => void openWorkspace()}><ArrowRight size={15}/> More</button>
              </div>
              {!engines?.sevenZip && <span className="orbit-inline-note">7-Zip is needed for 7z and non-ZIP archives.</span>}
            </div>}
            {tab === "actions" && <div className="orbit-controls">
              <span className="orbit-legend">FILE ACTIONS</span>
              {renaming ? <form className="orbit-rename" onSubmit={event => {event.preventDefault();void rename();}}>
                <input autoFocus aria-label="New filename" value={newName} onChange={event => setNewName(event.target.value)}/>
                <button type="submit">Save</button>
                <button type="button" onClick={() => setRenaming(false)}>Cancel</button>
              </form> : <div className="orbit-actions-grid">
                <button disabled={!file} onClick={() => {setNewName(file?.name || "");setRenaming(true);}}><Pencil size={14}/> Rename</button>
                <button disabled={!file} onClick={() => void act("copy")}><ClipboardCopy size={14}/> Copy path</button>
                <button disabled={!file} onClick={() => void act("folder")}><FolderOpen size={14}/> {isFolder ? "Open folder" : "Show file"}</button>
                <button disabled={!file} onClick={() => void act("terminal")}><Terminal size={14}/> Terminal</button>
                <button disabled={!file || isFolder} onClick={() => void act("copyFile")}><Copy size={14}/> Copy file</button>
                <button disabled={!file || isFolder} onClick={() => void act("float")}><Pin size={14}/> Float</button>
                <button disabled={!file || isFolder} onClick={() => void act("bluetooth")}><Bluetooth size={14}/> Bluetooth</button>
              </div>}
            </div>}
          </>}
          {error && phase !== "processing" && <span className="orbit-inline-error" role="alert">{error}</span>}
          {note && phase !== "processing" && <span className="orbit-inline-note" role="status">{note}</span>}
        </div>
        <nav className="orbit-section-tabs" aria-label="Orbit sections">
          {(["convert", "tools", "actions"] as Tab[]).map(value =>
            <button key={value} className={tab === value ? "is-active" : ""}
              disabled={phase === "processing"} onClick={() => {setTab(value);setError(null);setNote(null);setRenaming(false);setPhase("ready");}}>
              {t(getLanguage(), value === "convert" ? "convert" : value === "tools" ? "tools" : "actions")}
            </button>)}
        </nav>

        {phase === "processing" && mousePreferences.pointerSpinner && cursor && <span
          aria-hidden="true" className="orbit-pointer-spinner"
          style={{ left: cursor.x + 14, top: cursor.y + 11 }} />}
        <footer className="orbit-footer">
          <span className="orbit-footnote">{t(getLanguage(), "localNoUploads")}</span>
          <button type="button" className="orbit-open-app" onClick={() => void openWorkspace()}>
            Full app <ArrowRight size={13}/>
          </button>
        </footer>
      </section>
    </div>
  );
}
