import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine, ArrowRight, CheckCircle2, ChevronDown, CircleAlert,
  Copy, FileImage, Folder, Layers3, Plus, Settings2,
  Trash2, X, Languages, Volume2,
} from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { ArchivePanel, DocumentsPanel, MediaPanel, EnginesPanel } from "./ExtraWorkspaces";
import EbookPanel from "./EbookPanel";
import MediaToolsPanel from "./MediaToolsPanel";
import DataToolsPanel from "./DataToolsPanel";
import DocumentPreview from "./DocumentPreview";
import { getLanguage, LANGUAGE_OPTIONS, setDocumentLanguage, t, type LangKey, type LanguageCode } from "./localization";
import { getOrbitSoundsEnabled, setOrbitSoundsEnabled, getOrbitVolume, setOrbitVolume, previewOrbitSound } from "./orbitAudio";
import { readOrbitMousePreferences, saveOrbitMousePreferences, shortcutFromKeyboard, validateShortcut, DEFAULT_SHORTCUTS, type OrbitMousePreferences, type OrbitSection } from "./orbitMousePreferences";
import WindowChrome from "./WindowChrome";
import DesktopChrome, { isWorkspacePage as isWorkspaceSection, isPreferencesPage as isPreferencesSection, type DesktopPage } from "./DesktopChrome";
import GuidePage from "./GuidePage";
import ThemePicker from "./ThemePicker";
import { readOutputPreference, resolvePreferredDestination, saveOutputPreference, type OutputMode } from "./outputLocation";
import ActivityPage from "./ActivityPage";
import Welcome, { shouldShowWelcome } from "./Welcome";

const MEDIA_INPUT_EXTENSIONS = new Set([
  "mp4", "mkv", "mov", "avi", "webm", "wmv", "m4v", "mpeg", "mpg",
  "mts", "m2ts", "3gp", "ts", "mp3", "wav", "flac", "ogg", "opus",
  "aac", "m4a", "wma", "aiff", "ac3", "ape", "alac", "amr", "caf",
]);
function isMediaInput(path: string): boolean {
  const ext = path.split(/[\\/.]/).pop()?.toLowerCase() || "";
  return MEDIA_INPUT_EXTENSIONS.has(ext);
}

type WatchRule = {id:string;folder:string;inputExt:string;target:string;destination:string|null};
type WatchEvent = {id:string;path:string;status:string;outputPath:string|null;error:string|null};
type Target = "png" | "jpeg" | "webp" | "bmp" | "gif" | "tiff" | "ico" | "tga" | "qoi" | "avif";
type Status = "ready" | "processing" | "completed" | "failed" | "cancelled";
type Page = DesktopPage;

type ExpandedInputs = { paths: string[]; truncated: boolean };
type FileInfo = {
  path: string;
  name: string;
  bytes: number;
  detected: string | null;
  error: string | null;
};
type Row = FileInfo & {
  id: string;
  target: Target;
  status: Status;
  outputPath: string | null;
};
type HistoryEntry = {
  id: string;
  name: string;
  target: Target;
  outputPath: string | null;
  error: string | null;
  status: "completed" | "failed" | "cancelled";
  timestamp: number;
};
type ConversionEvent = {
  id: string;
  status: Status | "batch-finished";
  outputPath: string | null;
  error: string | null;
};

const targets: { key: Target; name: string; detail: string }[] = [
  { key: "png", name: "PNG", detail: "Lossless · transparency" },
  { key: "jpeg", name: "JPEG", detail: "Compact · photographs" },
  { key: "webp", name: "WebP", detail: "Efficient · lossless" },
  { key: "bmp", name: "BMP", detail: "Uncompressed · compatibility" },
  { key: "gif", name: "GIF", detail: "Static images · limited colors" },
  { key: "tiff", name: "TIFF", detail: "Single-page · high fidelity" },
  { key: "ico", name: "ICO", detail: "App icon · max 256 px" },
  { key: "tga", name: "TGA", detail: "Raster · design interchange" },
  { key: "qoi", name: "QOI", detail: "Lossless · lightweight" },
  { key: "avif", name: "AVIF", detail: "Compact · output only (preview)" },
];
const supported = "PNG, JPEG, WebP, BMP, GIF, TIFF, ICO, TGA, QOI and SVG input";
const fmtBytes = (value: number) => value < 1024 ? `${value} B` : value < 1024 * 1024
  ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1048576).toFixed(1)} MB`;
const makeId = () => crypto.randomUUID();

function FileThumbnail({ path }: { path: string }) {
  const element = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [thumbnail, setThumbnail] = useState<string | null>(null);

  useEffect(() => {
    if (!element.current || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "120px" });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !isTauri()) return;
    let stopped = false;
    invoke<string | null>("image_thumbnail", { path })
      .then(src => { if (!stopped) setThumbnail(src); })
      .catch(() => { /* Fall back to the file icon for unsupported or corrupt files. */ });
    return () => { stopped = true; };
  }, [visible, path]);

  return <div ref={element} className="file-icon">
    {thumbnail ? <img src={thumbnail} alt="" className="file-preview"/> : <FileImage size={19}/>}
  </div>;
}

function App() {
  const [showWelcome, setShowWelcome] = useState(() => isTauri() && shouldShowWelcome());
  const [page, setPage] = useState<Page>("convert");
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  function showDocument(path: string) {
    setPreviewPath(path);
    setPage("preview");
  }
  const [rows, setRows] = useState<Row[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem("reformany.history") || "[]");
      if (!Array.isArray(value)) return [];
      return value.filter((entry): entry is HistoryEntry =>
        typeof entry === "object" && entry !== null &&
        typeof entry.id === "string" && typeof entry.name === "string" &&
        typeof entry.timestamp === "number" && ["completed", "failed", "cancelled"].includes(entry.status)
      ).slice(0, 100);
    } catch { return []; }
  });
  const [outputMode, setOutputMode] = useState<OutputMode>(() => readOutputPreference().mode);
  const [destination, setDestination] = useState<string | null>(() => readOutputPreference().folder);
  const [quality, setQuality] = useState(86);
  const [matte, setMatte] = useState<"white" | "black">("white");
  const [maxDimension, setMaxDimension] = useState<number | null>(null);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [grayscale, setGrayscale] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark" | "system">(() => {
    const stored = localStorage.getItem("reformany.theme");
    return stored === "dark" || stored === "light" ? stored : "system";
  });
  const [systemDark, setSystemDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [language, setLanguage] = useState<LanguageCode>(getLanguage);
  const [orbitSounds, setOrbitSounds] = useState(getOrbitSoundsEnabled);
  const [orbitVolume, setSavedOrbitVolume] = useState(getOrbitVolume);
  const [orbitMouse, setOrbitMouse] = useState(readOrbitMousePreferences);
  const [shortcutEditing, setShortcutEditing] = useState<OrbitSection|null>(null);
  const [shortcutError, setShortcutError] = useState<string|null>(null);
  const [shakeConfig, setShakeConfig] = useState({enabled:false,sensitivity:3});
  const [shakeError, setShakeError] = useState<string|null>(null);
  const [shakeBusy, setShakeBusy] = useState(false);
  const [queueMode, setQueueMode] = useState<"sequential"|"balanced">("balanced");
  const [queueError, setQueueError] = useState<string|null>(null);
  const [watchRules, setWatchRules] = useState<WatchRule[]>([]);
  const [watchFolder, setWatchFolder] = useState<string|null>(null);
  const [watchInput, setWatchInput] = useState("png");
  const [watchTarget, setWatchTarget] = useState("pdf");
  const [watchError, setWatchError] = useState<string|null>(null);
  const [watchBusy, setWatchBusy] = useState(false);
  useEffect(()=>{
    if(!isTauri())return;
    void invoke<{mode:"sequential"|"balanced"}>("get_queue_policy")
      .then(result=>setQueueMode(result.mode))
      .catch(e=>setQueueError(String(e)));
  },[]);
  async function updateQueueMode(mode:"sequential"|"balanced"){
    setQueueError(null);
    try{
      const result=await invoke<{mode:"sequential"|"balanced"}>("set_queue_policy",{mode});
      setQueueMode(result.mode);
    }catch(e){setQueueError(String(e));}
  }
  useEffect(()=>{
    if(!isTauri())return;
    void invoke<WatchRule[]>("get_watch_rules").then(setWatchRules)
      .catch(e=>setWatchError(String(e)));
    const watchListener=listen<WatchEvent>("reformany:watch-job",event=>{
      const job=event.payload;
      if(job.status==="completed")setNotice("Auto Convert saved "+(job.outputPath?.split(/[\\/]/).at(-1)??"a file"));
      if(job.status==="failed")setWatchError(job.error||"Auto Convert failed");
    });
    return()=>{void watchListener.then(fn=>fn());};
  },[]);
  async function chooseWatchFolder(){
    try{
      const folder=await open({directory:true,multiple:false,title:"Choose a folder to watch"});
      if(typeof folder==="string"){setWatchFolder(folder);setWatchError(null);}
    }catch(e){setWatchError(String(e));}
  }
  async function addWatchRule(){
    if(!watchFolder||watchBusy)return;
    setWatchBusy(true);setWatchError(null);
    try{
      const rules=await invoke<WatchRule[]>("add_watch_rule",{
        folder:watchFolder,inputExt:watchInput,target:watchTarget,
        destination:await resolvePreferredDestination(),
      });
      setWatchRules(rules);setWatchFolder(null);
    }catch(e){setWatchError(String(e));}
    finally{setWatchBusy(false);}
  }
  async function removeWatchRule(id:string){
    setWatchBusy(true);setWatchError(null);
    try{setWatchRules(await invoke<WatchRule[]>("remove_watch_rule",{id}));}
    catch(e){setWatchError(String(e));}
    finally{setWatchBusy(false);}
  }
  useEffect(()=>{
    if(!isTauri())return;
    void invoke<{enabled:boolean;sensitivity:number}>("get_shake_settings")
      .then(setShakeConfig).catch(e=>setShakeError(String(e)));
  },[]);
  async function saveShakeConfig(enabled:boolean,sensitivity:number){
    setShakeBusy(true);setShakeError(null);
    try{
      const saved=await invoke<{enabled:boolean;sensitivity:number}>("set_shake_settings",{
        enabled,sensitivity,
      });
      setShakeConfig(saved);
    }catch(e){setShakeError(String(e));}
    finally{setShakeBusy(false);}
  }
  function updateOrbitMouse(changes: Partial<OrbitMousePreferences>) {
    setOrbitMouse(current => {
      const next = { ...current, ...changes };
      saveOrbitMousePreferences(next);
      return next;
    });
  }
  function updateOrbitVolume(value: number) {
    setSavedOrbitVolume(value);
    setOrbitVolume(value);
  }
  function toggleOrbitSounds() {
    const next = !orbitSounds;
    setOrbitSounds(next);
    setOrbitSoundsEnabled(next);
  }
  // Orbit sage is the official accent throughout ReformANY.
  const accent = "sage";
  const [batchId, setBatchId] = useState<string | null>(null);
  // A very fast batch may finish before its Tauri command promise resolves.
  const finishedBatchIds = useRef(new Set<string>());
  const mainScrollRef = useRef<HTMLElement>(null);
  const [dragging, setDragging] = useState(false);
  const [droppedMediaPath, setDroppedMediaPath] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const desktop = isTauri();

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const changed = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme === "system" ? (systemDark ? "dark" : "light") : theme;
    document.documentElement.dataset.accent = accent;
    localStorage.setItem("reformany.theme", theme);
    localStorage.setItem("reformany.accent", accent);
  }, [theme, accent, systemDark]);
  useEffect(() => {
    setDocumentLanguage(language);
    localStorage.setItem("reformany.language", language);
  }, [language]);
  const tx = (key: LangKey) => t(language, key);

  // Moving between workspaces should never reopen a page at the previous page’s scroll offset.
  useEffect(() => {
    if (mainScrollRef.current) mainScrollRef.current.scrollTop = 0;
  }, [page, showWelcome]);

  useEffect(() => {
    const records: HistoryEntry[] = rows.filter((row): row is Row & { status: "completed" | "failed" | "cancelled" } =>
      row.status === "completed" || row.status === "failed" || row.status === "cancelled"
    ).map(row => ({
      id: row.id, name: row.name, target: row.target, outputPath: row.outputPath,
      error: row.error, status: row.status, timestamp: Date.now(),
    }));
    if (!records.length) return;
    setHistory(previous => {
      const ids = new Set(previous.map(entry => entry.id));
      const additions = records.filter(entry => !ids.has(entry.id));
      return additions.length ? [...additions, ...previous].slice(0, 100) : previous;
    });
  }, [rows]);

  useEffect(() => {
    try { localStorage.setItem("reformany.history", JSON.stringify(history)); } catch { /* Storage is optional. */ }
  }, [history]);

  const addPaths = useCallback(async (paths: string[]) => {
    if (!paths.length) return;
    try {
      const expanded = await invoke<ExpandedInputs>("expand_inputs", { paths: paths.slice(0, 300) });
      if (expanded.truncated) setNotice("Import limited to 300 images or 20,000 scanned folder entries.");
      if (!expanded.paths.length) {
        setNotice("No supported images were found in this folder.");
        return;
      }
      const info = await invoke<FileInfo[]>("inspect_files", { paths: expanded.paths });
      setRows(current => {
        const seen = new Set(current.map(row => row.path));
        const appended: Row[] = info.filter(entry => !seen.has(entry.path)).map(entry => ({
          ...entry, id: makeId(), target: entry.detected === "PNG" ? "webp" : "png",
          status: entry.error ? "failed" : "ready", outputPath: null,
        }));
        return [...current, ...appended].slice(0, 300);
      });
      setPage("convert");
    } catch (error) { setNotice(String(error)); }
  }, []);

  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    let stopDrop: (() => void) | undefined;
    let stopEvents: (() => void) | undefined;
    getCurrentWebview().onDragDropEvent(event => {
      if (event.payload.type === "enter" || event.payload.type === "over") setDragging(true);
      if (event.payload.type === "leave") setDragging(false);
      if (event.payload.type === "drop") {
        setDragging(false);
        const paths = event.payload.paths;
        const media = paths.filter(isMediaInput);
        if (media.length > 0) {
          // Media has a separate FFmpeg-backed workspace; passing it into the
          // image importer produced the previous "unsupported image" error.
          setDroppedMediaPath(media[0]);
          setPage("media");
          if (media.length !== paths.length || media.length > 1) {
            setNotice("Opened the first media file. Use Add files in the relevant workspace for additional files.");
          }
        } else {
          void addPaths(paths);
        }
      }
    }).then(unlisten => { if (cancelled) unlisten(); else stopDrop = unlisten; })
      .catch(error => setNotice(String(error)));
    listen<ConversionEvent>("reformany:conversion", event => {
      const update = event.payload;
      if (update.status === "batch-finished") {
        finishedBatchIds.current.add(update.id);
        setBatchId(previous => previous === update.id ? null : previous);
        return;
      }
      setRows(current => current.map(row => row.id === update.id ? {
        ...row, status: update.status as Status,
        outputPath: update.outputPath ?? row.outputPath,
        error: update.error ?? (update.status === "completed" ? null : row.error),
      } : row));
    }).then(unlisten => { if (cancelled) unlisten(); else stopEvents = unlisten; })
      .catch(error => setNotice(String(error)));
    return () => { cancelled = true; stopDrop?.(); stopEvents?.(); };
  }, [desktop, addPaths]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        void chooseFiles();
      }
      if (event.key === "Escape") setNotice(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  async function chooseFiles() {
    if (!desktop) { setNotice("Open the desktop app to import files."); return; }
    try {
      const paths = await open({ multiple: true, directory: false,
        filters: [{ name: "Supported images", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff", "ico", "tga", "qoi", "svg"] }] });
      if (paths) await addPaths(Array.isArray(paths) ? paths : [paths]);
    } catch (error) { setNotice(String(error)); }
  }
  async function chooseFolder() {
    if (!desktop) { setNotice("Open the desktop app to import a folder."); return; }
    try {
      const folder = await open({ directory: true, multiple: false });
      if (typeof folder === "string") await addPaths([folder]);
    } catch (error) { setNotice(String(error)); }
  }
  async function chooseDestination() {
    if (!desktop) { setNotice("Open the desktop app to choose a folder."); return; }
    try {
      const path = await open({ directory: true, multiple: false });
      if (typeof path === "string") {
        saveOutputPreference({ mode: "folder", folder: path });
        setOutputMode("folder");
        setDestination(path);
      }
    } catch (error) { setNotice(String(error)); }
  }
  function changeOutputMode(mode: OutputMode) {
    if (mode === "folder") {
      void chooseDestination();
      return;
    }
    try {
      saveOutputPreference({ mode, folder: null });
      setOutputMode(mode);
      setDestination(null);
    } catch (error) { setNotice(String(error)); }
  }
  async function runConversion() {
    const pending = rows.filter(row => row.status === "ready" && !row.error);
    if (!pending.length || batchId) return;
    setRows(current => current.map(row => pending.some(p => p.id === row.id) ? { ...row, status: "processing" } : row));
    try {
      const id = await invoke<string>("convert_batch", {
        files: pending.map(row => ({
          id: row.id, path: row.path, target: row.target, quality, matte,
          options: { maxDimension, rotation, grayscale },
        })),
        destination: await resolvePreferredDestination(),
      });
      if (finishedBatchIds.current.delete(id)) {
        setBatchId(null);
      } else {
        setBatchId(id);
      }
    } catch (error) {
      setRows(current => current.map(row => pending.some(p => p.id === row.id) ? { ...row, status: "ready" } : row));
      setNotice(String(error));
    }
  }
  async function cancelConversion() {
    if (!batchId) return;
    try { await invoke("cancel_batch", { batchId }); }
    catch (error) { setNotice(String(error)); }
  }

  const active = rows.filter(row => row.status === "ready" && !row.error);
  const processed = rows.filter(row => row.status === "completed").length;
  const failed = rows.filter(row => row.status === "failed").length;
  const busy = Boolean(batchId) || rows.some(row => row.status === "processing");
  const totalBytes = useMemo(() => rows.reduce((sum, row) => sum + row.bytes, 0), [rows]);
  const isWorkspacePage = isWorkspaceSection(page);
  const isPreferencesPage = isPreferencesSection(page);
  const sectionLabel = isWorkspacePage ? "Workspace" : isPreferencesPage ? "Preferences" :
    page === "activity" ? "Activity" : "Guide";


  if (showWelcome) return <><WindowChrome title="ReformANY" /><Welcome onFinish={() => setShowWelcome(false)} /></>;

  return (
    <>
    <WindowChrome title="ReformANY" />
    <div className="shell">
      <DesktopChrome page={page} navigate={setPage} historyCount={history.length} language={language}/>
      <main className="main" ref={mainScrollRef}>
        <header className="topbar">
          <span className="breadcrumb">{sectionLabel} <span>/</span> {page === "convert" ? "Images" : page === "media" ? tx("media") : page === "mediaTools" ? "Media tools" : page === "archives" ? "Archives" : page === "subtitles" ? "Subtitles" : page === "spreadsheets" ? "Spreadsheets" : page === "documents" ? tx("documents") : page === "preview" ? "Preview" : page === "ebooks" ? "E-books" : page === "engines" ? "Engine status" : page === "activity" ? "History" : page === "guide" ? "Instructions" : "Appearance"}</span>
          <span className="topbar-right"><span className="topbar-dot"/> Local processing · Preview</span>
        </header>
        {page === "guide" && <GuidePage onOpenWorkspace={() => setPage("convert")}/>}
        {page === "media" && <MediaPanel droppedPath={droppedMediaPath} />}
        {page === "mediaTools" && <MediaToolsPanel />}
        {page === "archives" && <ArchivePanel />}
        {page === "documents" && <DocumentsPanel onPreview={showDocument} />}
        {page === "subtitles" && <DataToolsPanel kind="subtitles" />}
        {page === "spreadsheets" && <DataToolsPanel kind="spreadsheets" />}
        {page === "preview" && <DocumentPreview initialPath={previewPath} />}
        {page === "ebooks" && <EbookPanel />}
        {page === "engines" && <EnginesPanel />}
        {page === "convert" && <div className="content">
          <div className="page-intro">
            <div><div className="eyebrow">{tx("workspace").toUpperCase()}</div><h1>{tx("headline")}</h1><p>{tx("tagline")}</p></div>
            <div className="import-actions">
              <button className="button secondary add-top" onClick={() => void chooseFolder()}><Folder size={17}/> {tx("addFolder")}</button>
              <button className="button secondary add-top" onClick={() => void chooseFiles()}><Plus size={17}/> {tx("addFiles")}</button>
            </div>
          </div>

          <button className={`dropzone ${dragging ? "dragging" : ""}`} onClick={() => void chooseFiles()} aria-label="Choose images to convert">
            <div className="drop-icon"><ArrowDownToLine size={24} strokeWidth={1.7}/></div>
            <strong>{tx("dropFiles")}</strong><span>or <u>browse your device</u> to get started</span>
            <small>{supported} · Drag individual files or folders · 150 MB per file</small>
          </button>

          <div className="section-header">
            <div><h2>Files <span className="count">{rows.length}</span></h2><p>Choose an output format.</p></div>
            {rows.length > 0 && !busy && <div className="row-actions">
              {processed > 0 && <button className="text-action" onClick={() => setRows(current => current.map(row => row.status === "completed"
                ? { ...row, id: makeId(), status: "ready", outputPath: null, error: null } : row))}><ArrowRight size={15}/> Convert again</button>}
              <button className="text-action" onClick={() => setRows([])}><Trash2 size={15}/> Clear list</button>
            </div>}
          </div>

          {rows.length ? <div className="file-table">
            <div className="table-head"><span>FILE</span><span>CONVERT TO</span><span>STATUS</span><span/></div>
            {rows.map(row => <div className="file-row" key={row.id}>
              <div className="file-cell"><FileThumbnail path={row.path}/>
                <div className="file-detail"><strong title={row.name}>{row.name}</strong><small>{row.detected || "Unknown"} {row.bytes > 0 ? `· ${fmtBytes(row.bytes)}` : ""}</small></div>
              </div>
              <div className="target-cell"><select value={row.target} disabled={row.status !== "ready" || !!row.error || busy}
                aria-label={`Output format for ${row.name}`} onChange={event => setRows(current => current.map(item => item.id === row.id ? { ...item, target: event.target.value as Target } : item))}>
                {targets.map(option => <option key={option.key} value={option.key}>{option.name}</option>)}</select><ChevronDown size={14}/></div>
              <div className={`file-status ${row.status}`}>{row.status === "completed" ? <CheckCircle2 size={15}/> : row.status === "failed" ? <CircleAlert size={15}/> : row.status === "processing" ? <span className="spinner"/> : <span className="tiny-dot"/>}
                {row.status === "ready" ? "Ready" : row.status === "processing" ? "Working…" : row.status === "completed" ? "Done" : row.status === "cancelled" ? "Cancelled" : "Error"}</div>
              <button className="icon-button" title="Remove file" aria-label={`Remove ${row.name}`} disabled={busy} onClick={() => setRows(current => current.filter(item => item.id !== row.id))}><X size={17}/></button>
              {(row.error || row.outputPath) && <div className="row-message" title={row.error || row.outputPath || ""}>
                {row.error ? row.error : <>Saved to {row.outputPath} <button onClick={() => navigator.clipboard.writeText(row.outputPath || "")} aria-label="Copy output path"><Copy size={13}/></button></>}
              </div>}
            </div>)}
          </div> : <div className="empty-list"><Layers3 size={19}/><span>Your files will appear here once added.</span></div>}

          <div className="settings-card">
            <button className="settings-head" onClick={() => setExpanded(current => !current)} aria-expanded={expanded}>
              <span><Settings2 size={18}/> Conversion settings</span><span className="settings-hint">{expanded ? "Hide options" : "Fine-tune output"} <ChevronDown className={expanded ? "rotate" : ""} size={16}/></span>
            </button>
            <div className="destination-row"><div><strong>Save converted files</strong><small>{outputMode === "desktop" ? "Windows Desktop" : outputMode === "folder" ? destination : "Alongside the originals · No files are overwritten"}</small></div>
              <label className="select-field"><span>Destination</span><select aria-label="Conversion result destination" value={outputMode} onChange={event => changeOutputMode(event.target.value as OutputMode)}>
                <option value="alongside">Next to original</option>
                <option value="desktop">Desktop</option>
                <option value="folder">Choose folder…</option>
              </select></label>
              <button className="button subtle" onClick={() => void chooseDestination()}><Folder size={16}/> Choose folder</button>
              {outputMode !== "alongside" && <button className="icon-button" title="Save alongside originals" aria-label="Reset output folder" onClick={() => changeOutputMode("alongside")}><X size={16}/></button>}
            </div>
            {expanded && <div className="advanced-grid">
              <label className="range-field"><span>JPEG quality <strong>{quality}%</strong></span><input type="range" min="30" max="100" value={quality} onChange={e => setQuality(Number(e.target.value))}/><small>Only affects JPEG output.</small></label>
              <label className="select-field"><span>Background for formats without transparency</span><select value={matte} onChange={event => setMatte(event.target.value as "white" | "black")}><option value="white">White</option><option value="black">Black</option></select></label>
              <label className="select-field"><span>Resize to maximum edge</span>
                <select value={maxDimension === null ? "original" : String(maxDimension)} onChange={event => setMaxDimension(event.target.value === "original" ? null : Number(event.target.value))}>
                  <option value="original">Original size</option><option value="2048">2,048 px</option>
                  <option value="1024">1,024 px</option><option value="512">512 px</option><option value="256">256 px (ICO)</option>
                </select>
                <small>No upscaling · Keeps aspect ratio</small>
              </label>
              <label className="select-field"><span>Rotate clockwise</span>
                <select value={rotation} onChange={event => setRotation(Number(event.target.value) as 0 | 90 | 180 | 270)}>
                  <option value={0}>No rotation</option><option value={90}>90 degrees</option>
                  <option value={180}>180 degrees</option><option value={270}>270 degrees</option>
                </select>
              </label>
              <label className="check-field"><input type="checkbox" checked={grayscale} onChange={event => setGrayscale(event.target.checked)} />
                <span>Convert to grayscale <small>Applies to every file in this batch</small></span>
              </label>
              <p className="options-note">Animated images and multipage TIFFs are rejected to prevent silent data loss. Metadata may not be preserved.</p>
            </div>}
          </div>
          <div className="action-bar"><div className="action-summary"><strong>{active.length} ready to convert</strong><span>{rows.length ? `${fmtBytes(totalBytes)} added · ${processed} completed ${failed ? `· ${failed} errors` : ""}` : "Add some images to begin"}</span></div>
            {busy ? <button className="button cancel" onClick={() => void cancelConversion()}>Cancel batch</button> :
              <button className="button primary" disabled={!active.length || !desktop} onClick={() => void runConversion()}>Convert {active.length ? `${active.length} ${active.length === 1 ? "file" : "files"}` : "files"} <ArrowRight size={18}/></button>}
          </div>
          {!desktop && <p className="browser-note">Browser preview only. Open ReformANY through Tauri to import and convert files.</p>}
        </div>}

        {page === "activity" && <ActivityPage items={history}
          onClear={() => setHistory([])}
          onReveal={path => void invoke("reveal_output", { path }).catch(error => setNotice(String(error)))}
          onOpenWorkspace={() => setPage("convert")} />}

        {page === "files" && <div className="content page-panel">
          <div className="eyebrow">PREFERENCES</div>
          <h1>Files & jobs</h1><p>Choose where outputs go and how image conversion batches are scheduled.</p>
          <div className="preference-group">
            <h2>Output destination</h2>
            <p>Used by Orbit and ReformANY when no individual job overrides it. Existing files are never silently overwritten.</p>
            <label className="orbit-mouse-setting">
              <span><strong>Save converted files</strong><small>{outputMode==="desktop"?"Windows Desktop":outputMode==="folder"?destination:"Beside the original file"}</small></span>
              <select aria-label="Default output destination" value={outputMode}
                onChange={e=>changeOutputMode(e.target.value as OutputMode)}>
                <option value="alongside">Next to original</option>
                <option value="desktop">Desktop</option>
                <option value="folder">Choose folder…</option>
              </select>
            </label>
            {outputMode==="folder"&&<button type="button" className="button subtle" onClick={()=>void chooseDestination()}>Change destination folder</button>}
          </div>
          <div className="preference-group">
            <h2>Conversion queue</h2>
            <p>Real image conversion workers obey this setting. Sequential runs one at a time; Balanced uses up to two workers.</p>
            <label className="orbit-mouse-setting">
              <span><strong>Batch scheduling</strong><small>Saved across application restarts and standalone Orbit processes.</small></span>
              <select aria-label="Conversion queue behavior" value={queueMode}
                onChange={e=>void updateQueueMode(e.target.value as "sequential"|"balanced")}>
                <option value="sequential">Sequential · 1 at a time</option>
                <option value="balanced">Balanced · 2 in parallel</option>
              </select>
            </label>
            {queueError&&<p role="alert">{queueError}</p>}
          </div>
          <div className="preference-group">
            <h2>Auto Convert · watched folders</h2>
            <p>A native filesystem watcher converts newly saved image files after their size and modification time stabilize. These rules run only while the main ReformANY app is open. Files are never modified in place.</p>
            <div className="orbit-mouse-setting">
              <span><strong>Watch folder</strong><small>{watchFolder||"Choose a folder. Subfolders are excluded for predictable handling."}</small></span>
              <button type="button" className="button subtle" onClick={()=>void chooseWatchFolder()}>Browse…</button>
            </div>
            <div className="orbit-mouse-setting">
              <span><strong>Incoming file type</strong><small>Filters prevent recursively converting generated outputs.</small></span>
              <select aria-label="Auto Convert incoming image type" value={watchInput}
                onChange={e=>setWatchInput(e.target.value)}>
                {["png","jpg","jpeg","webp","bmp","tiff"].map(ext=><option key={ext} value={ext}>{ext.toUpperCase()}</option>)}
              </select>
            </div>
            <div className="orbit-mouse-setting">
              <span><strong>Convert to</strong><small>Uses the real offline image converter or PDF writer.</small></span>
              <select aria-label="Auto Convert output format" value={watchTarget}
                onChange={e=>setWatchTarget(e.target.value)}>
                {["pdf","png","jpeg","webp","bmp","tiff"].map(ext=><option key={ext} value={ext}>{ext.toUpperCase()}</option>)}
              </select>
            </div>
            <button type="button" className="button secondary" disabled={!watchFolder||watchBusy}
              onClick={()=>void addWatchRule()}>Add watched folder rule</button>
            {watchRules.length>0&&<div className="engine-card">
              <strong>Active rules ({watchRules.length})</strong>
              {watchRules.map(rule=><div className="orbit-mouse-setting" key={rule.id}>
                <span><strong>{rule.inputExt.toUpperCase()} → {rule.target.toUpperCase()}</strong>
                  <small title={rule.folder}>{rule.folder} · Output {rule.destination||"next to source"}</small>
                </span>
                <button type="button" className="button subtle" disabled={watchBusy}
                  onClick={()=>void removeWatchRule(rule.id)}>Remove</button>
              </div>)}
            </div>}
            {watchError&&<p role="alert">{watchError}</p>}
          </div>
        </div>}

        {page === "appearance" && <div className="content page-panel">
          <div className="eyebrow">{tx("preferences").toUpperCase()}</div><h1>{tx("appearance")}</h1><p>Customize the application.</p>
          <div className="preference-group"><h2>{tx("theme")}</h2><p>{tx("themeDescription")}</p>
            <ThemePicker value={theme} onChange={setTheme}
              labels={{ light: tx("light"), dark: tx("dark"), system: tx("system") }} />
          </div>
          <div className="preference-group"><h2><Languages size={18} aria-hidden="true"/> {tx("language")}</h2>
            <p>{tx("yourLanguage")}</p>
            <label className="language-choice">
              <span className="sr-only">{tx("language")}</span>
              <select value={language} onChange={event=>setLanguage(event.target.value as LanguageCode)}>
                {LANGUAGE_OPTIONS.map(item=><option key={item.code} value={item.code}>{item.label}</option>)}
              </select>
            </label>
            <p className="language-hint">Translations are used where available. Automatic appearance follows your Windows theme.</p>
          </div>
          <div className="preference-group preference-sounds">
            <div className="preference-sound-copy">
              <h2><Volume2 size={18} aria-hidden="true"/> {tx("orbitSounds")}</h2>
              <p id="orbit-sounds-help">{tx("orbitSoundsDescription")}</p>
            </div>
            <button type="button" role="switch"
              className={`orbit-sound-switch ${orbitSounds ? "is-on" : ""}`}
              aria-label={tx("orbitSounds")}
              aria-describedby="orbit-sounds-help"
              aria-checked={orbitSounds}
              onClick={toggleOrbitSounds}>
              <span className="orbit-switch-track" aria-hidden="true"><span className="orbit-switch-thumb"/></span>
              <span className="orbit-switch-state">{tx(orbitSounds ? "enabled" : "disabled")}</span>
            </button>
            <div className="orbit-volume-control">
              <label htmlFor="orbit-volume">Volume <output htmlFor="orbit-volume">{orbitVolume}%</output></label>
              <div className="orbit-volume-row">
                <input id="orbit-volume" type="range" min="0" max="100" step="5"
                  value={orbitVolume} disabled={!orbitSounds}
                  onChange={event => updateOrbitVolume(Number(event.target.value))}
                  aria-label="Orbit sound volume" />
                <button type="button" className="button secondary" disabled={!orbitSounds || orbitVolume === 0}
                  onClick={previewOrbitSound}>Test sound</button>
              </div>
            </div>
          </div>
          <div className="preference-group">
            <h2>Orbit mouse control</h2>
            <p>Customize the compact Orbit wheel, keyboard controls, and opt-in Explorer gesture activation.</p>
            <div className="orbit-mouse-preferences">
              <div className="orbit-mouse-setting">
                <span><strong>Starting section</strong><small>Always opens on Convert with available formats.</small></span>
                <strong>Convert</strong>
              </div>
              <label className="orbit-mouse-setting">
                <span><strong>Scroll between sections</strong><small>Use the mouse wheel over Orbit to move between Convert, Tools and Actions.</small></span>
                <input type="checkbox" checked={orbitMouse.scrollSections}
                  onChange={event => updateOrbitMouse({ scrollSections: event.target.checked })}/>
              </label>
              <div className="orbit-mouse-setting">
                <span><strong>Section shortcuts</strong><small>Choose your own shortcuts while Orbit is open. Click a key to rebind.</small></span>
              </div>
              {(["convert","tools","actions"] as OrbitSection[]).map(section=><div className="orbit-mouse-setting" key={section}>
                <span><strong>{section[0].toUpperCase()+section.slice(1)}</strong><small>Switches Orbit tab only; never runs a file action.</small></span>
                <button type="button" className="button subtle"
                  aria-label={`Change ${section} shortcut`}
                  onClick={()=>{setShortcutError(null);setShortcutEditing(section);}}>
                  {shortcutEditing===section?"Press keys…":orbitMouse.shortcuts[section]}
                </button>
              </div>)}
              {shortcutEditing&&<input autoFocus readOnly aria-label="Press new shortcut"
                placeholder="Press a modifier or a modified letter"
                onKeyDown={event=>{
                  event.preventDefault();event.stopPropagation();
                  if(event.key==="Escape"){setShortcutEditing(null);return;}
                  const next=shortcutFromKeyboard(event.nativeEvent);
                  if(!next){setShortcutError("Choose Shift, Ctrl, Alt or a modified letter, digit or F-key.");return;}
                  const problem=validateShortcut(next,orbitMouse.shortcuts,shortcutEditing);
                  if(problem){setShortcutError(problem);return;}
                  updateOrbitMouse({shortcuts:{...orbitMouse.shortcuts,[shortcutEditing]:next}});
                  setShortcutEditing(null);setShortcutError(null);
                }}/>}
              {shortcutError&&<p role="alert" className="orbit-dialog-error">{shortcutError}</p>}
              <button type="button" className="button secondary" onClick={()=>{
                updateOrbitMouse({shortcuts:{...DEFAULT_SHORTCUTS}});
                setShortcutEditing(null);setShortcutError(null);
              }}>Reset section shortcuts</button>
              <div className="orbit-mouse-setting">
                <span><strong>Hold-and-shake in Explorer</strong>
                  <small>Hold a file in Explorer, then reverse direction rapidly. After the completed shake, ReformANY captures the live OLE drag data to identify the actual dragged file. Only one file is supported in this gesture.</small></span>
                <input type="checkbox" checked={shakeConfig.enabled} disabled={!desktop||shakeBusy}
                  aria-label="Enable hold-and-shake Orbit gesture"
                  onChange={event=>void saveShakeConfig(event.target.checked,shakeConfig.sensitivity)}/>
              </div>
              <label className="orbit-mouse-setting">
                <span><strong>Shake sensitivity</strong>
                  <small>{shakeConfig.sensitivity===1?"Very deliberate":shakeConfig.sensitivity===2?"Deliberate":shakeConfig.sensitivity===3?"Balanced":shakeConfig.sensitivity===4?"Responsive":"Very responsive"} · requires a stationary hold and multiple directional flips</small></span>
                <input type="range" min={1} max={5} step={1} value={shakeConfig.sensitivity}
                  aria-label="Shake sensitivity" disabled={!shakeConfig.enabled||shakeBusy}
                  onChange={event=>void saveShakeConfig(true,Number(event.target.value))}/>
              </label>
              <p>Opt-in Windows listener. Ordinary dragging is unaffected until a qualifying shake. A temporary drop target reads CF_HDROP from the active drag; unsupported or multiple-file drags are ignored. Real Explorer/Desktop testing is still required.</p>
              {shakeError&&<p role="alert" className="orbit-dialog-error">{shakeError}</p>}
              <label className="orbit-mouse-setting">
                <span><strong>Pointer loading ring</strong><small>Show a small progress indicator beside the cursor while Orbit is processing.</small></span>
                <input type="checkbox" checked={orbitMouse.pointerSpinner}
                  onChange={event => updateOrbitMouse({ pointerSpinner: event.target.checked })}/>
              </label>
            </div>
          </div>
          <div className="preference-group"><h2>{tx("accent")}</h2>
            <p>Orbit olive and sage are the official application colors.</p>
            <span className="official-brand-accent">● Sage · Official</span>
          </div>
          <div className="preference-group welcome-replay-setting">
            <div>
              <h2>Welcome screen</h2>
              <p>Revisit the introduction and preview Orbit's three sections.</p>
            </div>
            <button type="button" className="button secondary" onClick={() => setShowWelcome(true)}>
              Show introduction <ArrowRight size={16} aria-hidden="true"/>
            </button>
          </div>
          <div className="preference-group"><h2>{tx("privacy")}</h2><p>Image processing happens locally. ReformANY does not upload your files to a server.</p></div>
        </div>}
      </main>
      {notice && <div className="toast" role="alert"><CircleAlert size={18}/><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice(null)}><X size={16}/></button></div>}
    </div>
    </>
  );
}
export default App;
