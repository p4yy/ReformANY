import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine, ArrowRight, Check, CheckCircle2, ChevronDown, CircleAlert,
  Clock3, Copy, FileImage, Folder, Layers3, Plus, Settings2,
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
import { getOrbitSoundsEnabled, setOrbitSoundsEnabled } from "./orbitAudio";
import { readOrbitMousePreferences, saveOrbitMousePreferences, type OrbitMousePreferences } from "./orbitMousePreferences";
import DesktopChrome, { type DesktopPage } from "./DesktopChrome";
import GuidePage from "./GuidePage";
import ThemePicker from "./ThemePicker";
import ActivityPage from "./ActivityPage";
import Welcome, { shouldShowWelcome } from "./Welcome";

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
  const [destination, setDestination] = useState<string | null>(null);
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
  const [orbitMouse, setOrbitMouse] = useState(readOrbitMousePreferences);
  function updateOrbitMouse(changes: Partial<OrbitMousePreferences>) {
    setOrbitMouse(current => {
      const next = { ...current, ...changes };
      saveOrbitMousePreferences(next);
      return next;
    });
  }
  function toggleOrbitSounds() {
    const next = !orbitSounds;
    setOrbitSounds(next);
    setOrbitSoundsEnabled(next);
  }
  const [accent, setAccent] = useState(() => localStorage.getItem("reformany.accent") || "blue");
  const [batchId, setBatchId] = useState<string | null>(null);
  // A very fast batch may finish before its Tauri command promise resolves.
  const finishedBatchIds = useRef(new Set<string>());
  const mainScrollRef = useRef<HTMLElement>(null);
  const [dragging, setDragging] = useState(false);
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
        void addPaths(event.payload.paths);
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
      if (typeof path === "string") setDestination(path);
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
        destination,
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
  const isWorkspacePage = ["convert", "media", "mediaTools", "archives", "documents",
    "subtitles", "spreadsheets", "preview", "ebooks"].includes(page);
  const isPreferencesPage = page === "appearance" || page === "engines";
  const sectionLabel = isWorkspacePage ? "Workspace" : isPreferencesPage ? "Preferences" :
    page === "activity" ? "Activity" : "Guide";


  if (showWelcome) return <Welcome onFinish={() => setShowWelcome(false)} />;

  return (
    <div className="shell">
      <DesktopChrome page={page} navigate={setPage} historyCount={history.length} language={language}/>
      <main className="main" ref={mainScrollRef}>
        <header className="topbar">
          <span className="breadcrumb">{sectionLabel} <span>/</span> {page === "convert" ? "Images" : page === "media" ? tx("media") : page === "mediaTools" ? "Media tools" : page === "archives" ? "Archives" : page === "subtitles" ? "Subtitles" : page === "spreadsheets" ? "Spreadsheets" : page === "documents" ? tx("documents") : page === "preview" ? "Preview" : page === "ebooks" ? "E-books" : page === "engines" ? "Engine status" : page === "activity" ? "History" : page === "guide" ? "Instructions" : "Appearance"}</span>
          <span className="topbar-right"><span className="topbar-dot"/> Local processing · Preview</span>
        </header>
        {page === "guide" && <GuidePage onOpenWorkspace={() => setPage("convert")}/>}
        {page === "media" && <MediaPanel />}
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
            <div><h2>Files <span className="count">{rows.length}</span></h2><p>Choose what each file should become.</p></div>
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
            <div className="destination-row"><div><strong>Save converted files</strong><small>{destination || "Alongside the originals · No files are overwritten"}</small></div>
              <button className="button subtle" onClick={() => void chooseDestination()}><Folder size={16}/> Choose folder</button>
              {destination && <button className="icon-button" title="Save alongside originals" aria-label="Reset output folder" onClick={() => setDestination(null)}><X size={16}/></button>}
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

        {page === "appearance" && <div className="content page-panel">
          <div className="eyebrow">{tx("preferences").toUpperCase()}</div><h1>{tx("appearance")}</h1><p>Make the workspace feel right for you.</p>
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
            <p className="language-hint">{tx("autoThemeInfo")}</p>
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
          </div>
          <div className="preference-group">
            <h2>Orbit mouse control</h2>
            <p>Customize the compact wheel. These controls work inside Orbit and never intercept Windows Explorer input.</p>
            <div className="orbit-mouse-preferences">
              <label className="orbit-mouse-setting">
                <span><strong>Open on</strong><small>Choose the section Orbit displays first.</small></span>
                <select aria-label="Starting Orbit section" value={orbitMouse.firstSection}
                  onChange={event => updateOrbitMouse({ firstSection: event.target.value as OrbitMousePreferences["firstSection"] })}>
                  <option value="convert">Convert</option>
                  <option value="tools">Tools</option>
                  <option value="actions">Actions</option>
                </select>
              </label>
              <label className="orbit-mouse-setting">
                <span><strong>Scroll between sections</strong><small>Use the mouse wheel over Orbit to move between Convert, Tools and Actions.</small></span>
                <input type="checkbox" checked={orbitMouse.scrollSections}
                  onChange={event => updateOrbitMouse({ scrollSections: event.target.checked })}/>
              </label>
              <label className="orbit-mouse-setting">
                <span><strong>Pointer loading ring</strong><small>Show a small progress indicator beside the cursor while Orbit is processing.</small></span>
                <input type="checkbox" checked={orbitMouse.pointerSpinner}
                  onChange={event => updateOrbitMouse({ pointerSpinner: event.target.checked })}/>
              </label>
            </div>
          </div>
          <div className="preference-group"><h2>{tx("accent")}</h2><p>A small touch of color for important actions.</p>
            <div className="accent-grid">{[{key:"blue",color:"#3679e9",name:"Blue"},{key:"indigo",color:"#5455bf",name:"Indigo"},{key:"sage",color:"#4b806b",name:"Sage"},{key:"slate",color:"#52657d",name:"Slate"},{key:"coral",color:"#bf6d5c",name:"Coral"}].map(item =>
              <button key={item.key} className={`accent-chip ${accent === item.key ? "picked" : ""}`} onClick={() => setAccent(item.key)} aria-label={item.name} title={item.name} style={{background:item.color}}>{accent === item.key && <Check size={17}/>}</button>)}</div>
          </div>
          <div className="preference-group welcome-replay-setting">
            <div>
              <h2>Welcome & Orbit tour</h2>
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
  );
}
export default App;
