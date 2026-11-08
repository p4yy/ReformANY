import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { resolvePreferredDestination } from "./outputLocation";
import {
  Archive as ArchiveIcon, ArrowRight, CheckCircle2, CircleAlert,
  FileArchive, FileVideo, FileText, Folder, FolderOpen, LoaderCircle, Lock, Plus, Trash2,
} from "lucide-react";

type Engines = {
  ffmpeg: boolean;
  ffprobe: boolean;
  sevenZip: boolean;
  winrar: boolean;
};

const videoTypes = ["mp4", "webm", "mkv", "mov", "avi"];
const audioInputExtensions = new Set([
  "mp3", "wav", "flac", "ogg", "opus", "aac", "m4a", "wma",
  "aiff", "ac3", "ape", "alac", "amr", "caf",
]);
const audioTypes = ["mp3", "m4a", "wav", "flac", "ogg", "opus"];
const archiveTypes = ["7z", "zip", "rar", "tar", "gzip", "bzip2", "xz", "wim"];

function useEngines() {
  const [engines, setEngines] = useState<Engines | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    invoke<Engines>("engine_status").then(value => {
      if (alive) setEngines(value);
    }).catch(() => { /* A runtime error will be shown by job invocation. */ });
    return () => { alive = false; };
  }, []);
  return engines;
}

function fileName(value: string) {
  return value.split(/[\\/]/).pop() || value;
}
function stem(value: string) {
  return fileName(value).replace(/\.[^.]+$/, "");
}
function outputSelector(output: string | null, resultError: string | null) {
  if (resultError) return <p className="engine-error" role="alert"><CircleAlert size={16}/> {resultError}</p>;
  if (!output) return null;
  return <div className="engine-success" role="status">
    <div><CheckCircle2 size={18}/><span>Saved successfully</span><small title={output}>{output}</small></div>
    <button className="button secondary" onClick={() => void invoke("reveal_output", { path: output })}><FolderOpen size={15}/> Show result</button>
  </div>;
}

export function MediaPanel({ droppedPath }: { droppedPath?: string | null }) {
  const engines = useEngines();
  const [input, setInput] = useState<string | null>(null);
  const [target, setTarget] = useState("mp4");
  const [profile, setProfile] = useState("standard");
  const [start, setStart] = useState("");
  const [duration, setDuration] = useState("");
  const [destination, setDestination] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  const [phase, setPhase] = useState("encoding");
  const jobId = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen<{ id: string; percent: number | null; phase: string }>("reformany:engine-progress", event => {
      if (event.payload.id !== jobId.current) return;
      setPercent(event.payload.percent);
      setPhase(event.payload.phase);
    }).then(stop => { if (cancelled) stop(); else unlisten = stop; });
    return () => { cancelled = true; unlisten?.(); };
  }, []);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ready = Boolean(engines?.ffmpeg && engines?.ffprobe);
  // Native WebView2 drop events are handled at App level. When a supported file
  // arrives, select it here rather than trying to decode it as an image.
  useEffect(() => {
    if (!droppedPath) return;
    setInput(droppedPath);
    setResult(null);
    setError(null);
    setPercent(null);
    setStart("");
    setDuration("");
    const ext = droppedPath.split(".").pop()?.toLowerCase();
    setTarget(ext && audioInputExtensions.has(ext) ? "mp3" : "mp4");
  }, [droppedPath]);

  async function chooseInput() {
    try {
      const selected = await open({ multiple: false, directory: false,
        filters: [{ name: "Video and audio", extensions: [
          "mp4", "mkv", "mov", "avi", "webm", "wmv", "m4v", "mpeg", "mpg", "mts", "m2ts",
          "mp3", "wav", "flac", "ogg", "opus", "aac", "m4a", "wma", "aiff", "ac3",
        ] }] });
      if (typeof selected === "string") {
        setInput(selected);
        setError(null);
        setResult(null);
        const ext = selected.split(".").pop()?.toLowerCase();
        setTarget(ext && audioInputExtensions.has(ext) ? "mp3" : "mp4");
      }
    } catch (cause) { setError(String(cause)); }
  }

  async function selectDestination() {
    try {
      const dir = await open({ directory: true, multiple: false });
      if (typeof dir === "string") setDestination(dir);
    } catch (cause) { setError(String(cause)); }
  }

  async function convert() {
    if (!input || busy || !ready) return;
    setBusy(true); setError(null); setResult(null); setPercent(null);
    const id = crypto.randomUUID();
    jobId.current = id;
    try {
      const output = await invoke<string>("media_convert", {
        job: {
          path: input, target, profile, destination: destination ?? await resolvePreferredDestination(),
          startSeconds: start.trim() ? Number(start) : null,
          durationSeconds: duration.trim() ? Number(duration) : null,
          progressId: id,
        },
      });
      setResult(output);
    } catch (cause) {
      setError(String(cause));
    } finally {
      jobId.current = null;
      setBusy(false);
    }
  }

  async function cancel() {
    if (!jobId.current) return;
    try { await invoke("cancel_engine_job", { id: jobId.current }); }
    catch (cause) { setError(String(cause)); }
  }

  return <div className="content engine-page">
    
    <h1>Audio & video</h1>
    <p>Convert media with an installed FFmpeg engine. Only supported output presets are offered.</p>

    <div className="engine-card">
      <div className="engine-card-title"><FileVideo size={18}/><h2>Source file</h2></div>
      <button className="engine-input" onClick={() => void chooseInput()} disabled={busy}>
        <FileVideo size={24}/>
        <span>{input ? fileName(input) : "Choose a video or audio file"}<small>{input || "Formats depend on available FFmpeg decoders."}</small></span>
        <Plus size={17}/>
      </button>
      <div className="engine-form-grid">
        <label>Convert to
          <select value={target} disabled={busy} onChange={event => setTarget(event.target.value)}>
            <optgroup label="Video">{videoTypes.map(type => <option key={type} value={type}>{type.toUpperCase()}</option>)}</optgroup>
            <optgroup label="Audio">{audioTypes.map(type => <option key={type} value={type}>{type.toUpperCase()}</option>)}</optgroup>
          </select>
        </label>
        <label>Quality
          <select value={profile} disabled={busy} onChange={event => setProfile(event.target.value)}>
            <option value="small">Smaller file</option><option value="standard">Balanced</option><option value="high">Higher quality</option>
          </select>
        </label>
        <label>Start at (seconds)
          <input type="number" min={0} max={86400} step={0.1} placeholder="From beginning" value={start}
            disabled={busy} onChange={event => setStart(event.target.value)}/>
        </label>
        <label>Duration (seconds)
          <input type="number" min={0.01} max={86400} step={0.1} placeholder="Entire remaining file" value={duration}
            disabled={busy} onChange={event => setDuration(event.target.value)}/>
        </label>
      </div>
      <div className="engine-directory">
        <div><strong>Save destination</strong><small>{destination || "Alongside the original file"}</small></div>
        {destination && <button className="text-action" onClick={() => setDestination(null)}>Reset</button>}
        <button className="button secondary" disabled={busy} onClick={() => void selectDestination()}><Folder size={16}/> Choose folder</button>
      </div>
    </div>

    <div className="engine-action-row">
      <div><strong>{ready ? "FFmpeg ready" : "FFmpeg / FFprobe needed"}</strong>
        <small>{ready ? "Conversion occurs locally · originals are kept" : "Install both tools to enable real media conversion."}</small></div>
      <button className="button primary" disabled={!input || busy || !ready} onClick={() => void convert()}>
        {busy ? <><LoaderCircle className="engine-spin" size={17}/> Processing…</> : <>Convert media <ArrowRight size={16}/></>}
      </button>
    </div>
    {busy && <div className="media-progress" role="status" aria-live="polite">
      <div className="media-progress-heading">
        <strong>{phase === "encoding" ? "Encoding media" : "Verifying output"}</strong>
        <span>{percent !== null ? percent + "%" : "Calculating…"}</span>
      </div>
      <progress max={100} value={percent === null ? undefined : percent} aria-label="Media conversion progress"/>
      <button type="button" className="text-action" onClick={() => void cancel()}>Cancel conversion</button>
    </div>}
    {outputSelector(result, error)}
    <p className="engine-footnote">The percentage is derived from FFmpeg's reported timestamp and input duration. Unknown durations remain indeterminate; cancellation stops the encoder. Trim is optional.</p>
  </div>;
}

export function ArchivePanel() {
  const engines = useEngines();
  const [mode, setMode] = useState<"create" | "extract" | "split" | "join">("create");
  const [sources, setSources] = useState<string[]>([]);
  const [format, setFormat] = useState("7z");
  const [name, setName] = useState("ReformANY Archive");
  const [password, setPassword] = useState("");
  const [split, setSplit] = useState("0");
  const [partSize, setPartSize] = useState("100");
  const [level, setLevel] = useState("5");
  const [destination, setDestination] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [extra, setExtra] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const supported = format === "rar" ? Boolean(engines?.winrar)
    : format === "zip" && split === "0" ? true : Boolean(engines?.sevenZip);
  const canRun = mode === "split" || mode === "join" ? true : mode === "extract"
    ? Boolean(sources[0]?.toLowerCase().endsWith(".zip") || engines?.sevenZip)
    : supported;

  function changeMode(next: "create" | "extract" | "split" | "join") {
    setMode(next); setSources([]); setResult(null); setError(null); setExtra([]);
  }

  async function addFiles() {
    try {
      const selection: unknown = await open({
        multiple: mode === "create", directory: false,
        ...(mode === "join" ? { filters: [{ name: "ReformANY parts manifest", extensions: ["json"] }] } : {}),
      });
      const paths: string[] = Array.isArray(selection)
        ? selection.filter((item): item is string => typeof item === "string")
        : typeof selection === "string" ? [selection] : [];
      if (paths.length) {
        setSources(previous => mode === "create" ? [...new Set([...previous, ...paths])] : paths.slice(0, 1));
        if (mode === "extract") setName(stem(paths[0]));
        else if (mode === "create" && sources.length === 0) setName(stem(paths[0]) || "ReformANY Archive");
      }
    } catch (cause) { setError(String(cause)); }
  }

  async function addFolder() {
    try {
      const path = await open({ directory: true, multiple: false });
      if (typeof path === "string") {
        setSources(previous => [...new Set([...previous, path])]);
        if (sources.length === 0) setName(fileName(path) || "ReformANY Archive");
      }
    } catch (cause) { setError(String(cause)); }
  }

  async function selectDestination() {
    try {
      const path = await open({ directory: true, multiple: false });
      if (typeof path === "string") setDestination(path);
    } catch (cause) { setError(String(cause)); }
  }

  async function execute() {
    if (!sources.length || busy || !canRun) return;
    setBusy(true);setError(null);setResult(null);setExtra([]);
    try {
      const outputDestination = destination ?? await resolvePreferredDestination();
      if (mode === "create") {
        const result = await invoke<{ outputPaths: string[] }>("archive_create", {
          job: {
            paths: sources, destination: outputDestination, name, format,
            password: password || null, splitMegabytes: Number(split) || null,
            level: Number(level),
          },
        });
        setResult(result.outputPaths[0] || null);
        setExtra(result.outputPaths.slice(1));
      } else if (mode === "extract") {
        const result = await invoke<string>("archive_extract", {
          job: { path: sources[0], destination: outputDestination, password: password || null },
        });
        setResult(result);
      } else if (mode === "split") {
        const splitResult = await invoke<{ manifestPath: string; parts: string[] }>("file_split", {
          path: sources[0], destination: outputDestination, partMegabytes: Number(partSize),
        });
        setResult(splitResult.manifestPath);
        setExtra(splitResult.parts);
      } else {
        const restored = await invoke<string>("file_join", { manifestPath: sources[0], destination: outputDestination });
        setResult(restored);
      }
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  return <div className="content engine-page">
    
    <h1>Archives</h1>
    <p>Create archives or split and rejoin large files. Everything runs locally.</p>
    <div className="engine-switch engine-switch-three">
      <button className={mode === "create" ? "selected" : ""} onClick={() => changeMode("create")}>Create</button>
      <button className={mode === "extract" ? "selected" : ""} onClick={() => changeMode("extract")}>Extract</button>
      <button className={mode === "split" ? "selected" : ""} onClick={() => changeMode("split")}>Split file</button>
      <button className={mode === "join" ? "selected" : ""} onClick={() => changeMode("join")}>Join parts</button>
    </div>

    <div className="engine-card">
      <div className="engine-card-title"><FileArchive size={18}/><h2>{mode === "create" ? "Files to package" : mode === "extract" ? "Archive to extract" : mode === "split" ? "File to split" : "Parts manifest to join"}</h2></div>
      <div className="engine-import-row">
        <button className="button secondary" disabled={busy} onClick={() => void addFiles()}><Plus size={16}/> {mode === "create" ? "Add files" : mode === "extract" ? "Choose archive" : mode === "split" ? "Choose file" : "Choose manifest"}</button>
        {mode === "create" && <button className="button secondary" disabled={busy} onClick={() => void addFolder()}><Folder size={16}/> Add folder</button>}
        {!!sources.length && <button className="text-action" disabled={busy} onClick={() => setSources([])}><Trash2 size={14}/> Clear</button>}
      </div>
      <div className="engine-source-list">
        {sources.length ? sources.map(path => <div key={path}><ArchiveIcon size={15}/><span title={path}>{fileName(path)}</span>
          <button aria-label={"Remove "+fileName(path)} disabled={busy} onClick={() => setSources(current => current.filter(item => item !== path))}>×</button></div>)
          : <p>{mode === "create" ? "Select files or a folder to compress." : mode === "extract" ? "Select a ZIP or another format supported by 7-Zip." : mode === "split" ? "Select a file to divide into numbered .001, .002… parts." : "Select the .reformany.parts.json manifest saved during splitting."}</p>}
      </div>
      {mode === "create" && <div className="engine-form-grid">
        <label>Archive name
          <input value={name} disabled={busy} onChange={event => setName(event.target.value)} maxLength={90} placeholder="My archive"/>
        </label>
        <label>Archive format
          <select value={format} disabled={busy} onChange={event => {setFormat(event.target.value);setSplit("0");setPassword("");}}>
            {archiveTypes.map(type => <option key={type} value={type}>{type.toUpperCase()}</option>)}
          </select>
        </label>
        <label>Compression level
          <select value={level} disabled={busy} onChange={event => setLevel(event.target.value)}>
            <option value="1">Fastest</option><option value="3">Fast</option>
            <option value="5">Balanced</option><option value="7">High</option><option value="9">Maximum</option>
          </select>
        </label>
        <label>Split into volumes
          <select value={split} disabled={busy || !["zip","7z","rar"].includes(format)}
            onChange={event => setSplit(event.target.value)}>
            <option value="0">No split</option><option value="50">50 MB parts</option>
            <option value="100">100 MB parts</option><option value="500">500 MB parts</option>
            <option value="1024">1 GB parts</option>
          </select>
        </label>
      </div>}
      {mode === "split" && <div className="engine-form-grid">
        <label>Part size
          <select value={partSize} disabled={busy} onChange={event => setPartSize(event.target.value)}>
            <option value="1">1 MB</option><option value="10">10 MB</option>
            <option value="50">50 MB</option><option value="100">100 MB</option>
            <option value="500">500 MB</option><option value="1024">1 GB</option>
          </select>
        </label>
      </div>}
      {(mode === "create" || mode === "extract") && <label className="engine-password"><Lock size={15}/> Password
        <input type="password" placeholder="Optional" autoComplete="new-password" value={password}
          disabled={busy || (mode === "create" && !["zip","7z","rar"].includes(format))}
          onChange={event => setPassword(event.target.value)}/>
      </label>}
      <div className="engine-directory">
        <div><strong>Destination</strong><small>{destination || "Alongside the selected files"}</small></div>
        {destination && <button className="text-action" onClick={() => setDestination(null)}>Reset</button>}
        <button className="button secondary" disabled={busy} onClick={() => void selectDestination()}><Folder size={16}/> Choose folder</button>
      </div>
    </div>
    <div className="engine-action-row">
      <div><strong>{mode === "split" || mode === "join" ? "Built-in file parts ready" : canRun ? "Archive engine available" : (format === "rar" && mode === "create" ? "WinRAR required for RAR creation" : "7-Zip required")}</strong>
        <small>{mode === "split" ? "Creates numbered parts with a SHA-256 manifest" : mode === "join" ? "Verifies all parts before restoring a copy" : mode === "create" ? "Originals are kept · no overwrites" : "Extract into a new folder · no overwrites"}</small></div>
      <button className="button primary" disabled={!sources.length || !canRun || busy} onClick={() => void execute()}>
        {busy ? <><LoaderCircle size={17} className="engine-spin"/> Working…</>
          : <>{mode === "create" ? "Create archive" : mode === "extract" ? "Extract files" : mode === "split" ? "Split file" : "Join parts"} <ArrowRight size={16}/></>}
      </button>
    </div>
    {outputSelector(result, error)}
    {extra.length > 0 && <p className="engine-footnote">{mode === "split" ? `${extra.length} numbered part(s) saved alongside the manifest.` : `${extra.length} additional archive volume(s) saved.`}</p>}
    {(mode === "create" || mode === "extract") ? <p className="engine-footnote">7-Zip handles additional archive formats. ZIP encryption does not hide filenames; 7z can. External command-line tools may expose passwords in process arguments.</p> : <p className="engine-footnote">File parts are not compressed or encrypted. Keep every numbered part and the .reformany.parts.json manifest together. Joining verifies SHA-256 and never overwrites the original.</p>}
  </div>;
}

type DocumentTask = "images" | "text" | "office" | "split";

export function DocumentsPanel({ onPreview }: { onPreview?: (path: string) => void }) {
  const [mode, setMode] = useState<DocumentTask>("images");
  const [sources, setSources] = useState<string[]>([]);
  const [destination, setDestination] = useState<string | null>(null);
  const [office, setOffice] = useState(false);
  const [splitMode, setSplitMode] = useState<"size" | "parts" | "pages">("size");
  const [splitValue, setSplitValue] = useState("5");
  const [splitOutputs, setSplitOutputs] = useState<string[]>([]);
  const [splitWarning, setSplitWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    invoke<boolean>("office_available").then(setOffice).catch(() => setOffice(false));
  }, []);

  function changeMode(next: DocumentTask) {
    setMode(next);
    setSources([]);
    setResult(null);
    setSplitOutputs([]);
    setSplitWarning(null);
    setError(null);
  }

  async function choose() {
    try {
      const type = mode === "images"
        ? [{ name: "Raster images", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff"] }]
        : mode === "text" || mode === "split" ? [{ name: "PDF documents", extensions: ["pdf"] }]
        : [{ name: "Office documents", extensions: ["docx", "doc", "rtf", "odt", "pptx", "ppt", "odp", "xlsx", "xls", "ods", "txt", "html", "htm"] }];
      const response: unknown = await open({ multiple: mode === "images", directory: false, filters: type });
      const paths: string[] = Array.isArray(response) ? response.filter((p): p is string => typeof p === "string")
        : typeof response === "string" ? [response] : [];
      if (paths.length) {
        setSources(mode === "images" ? paths : paths.slice(0, 1));
        setResult(null);
        setError(null);
      }
    } catch (cause) { setError(String(cause)); }
  }

  async function folder() {
    try {
      const path = await open({ directory: true, multiple: false });
      if (typeof path === "string") setDestination(path);
    } catch (cause) { setError(String(cause)); }
  }

  async function process() {
    if (!sources.length || busy) return;
    setBusy(true);setError(null);setResult(null);setSplitOutputs([]);setSplitWarning(null);
    try {
      const outputDestination = destination ?? await resolvePreferredDestination();
      if (mode === "split") {
        const value = Number(splitValue);
        if (!Number.isInteger(value) || value < (splitMode === "parts" ? 2 : 1) || value > 4096) {
          throw new Error("Enter a valid size, number of parts, or pages per part.");
        }
        const files = await invoke<{ outputPaths: string[]; oversizedPages: number[] }>("pdf_split", {
          path: sources[0], destination: outputDestination, mode: splitMode, value,
        });
        if (!files.outputPaths.length) throw new Error("PDF splitter produced no files");
        setSplitOutputs(files.outputPaths);
        setResult(files.outputPaths[0]);
        if (files.oversizedPages.length) {
          setSplitWarning("These individual pages exceed the target size: " + files.oversizedPages.join(", "));
        }
      } else {
        const path = mode === "images"
          ? await invoke<string>("images_to_pdf", { paths: sources, destination: outputDestination })
          : mode === "text"
            ? await invoke<string>("pdf_to_text", { path: sources[0], destination: outputDestination })
            : await invoke<string>("office_to_pdf", { path: sources[0], destination: outputDestination });
        setResult(path);
      }
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  return <div className="content engine-page">
    <h1>Documents</h1>
    <p>Actual PDF operations, with original files left in place. Office rendering uses LibreOffice if installed.</p>
    <div className="engine-switch engine-switch-three">
      <button className={mode === "images" ? "selected" : ""} onClick={() => changeMode("images")}>Images → PDF</button>
      <button className={mode === "text" ? "selected" : ""} onClick={() => changeMode("text")}>PDF → Text</button>
      <button className={mode === "office" ? "selected" : ""} onClick={() => changeMode("office")}>Office → PDF</button>
      <button className={mode === "split" ? "selected" : ""} onClick={() => changeMode("split")}>Split PDF</button>
    </div>
    <div className="engine-card">
      <div className="engine-card-title"><FileText size={18}/><h2>Selected source</h2></div>
      <button className="engine-input" disabled={busy} onClick={() => void choose()}>
        <FileText size={22}/><span>
          {sources.length ? sources.length === 1 ? fileName(sources[0]) : String(sources.length) + " images selected"
            : mode === "images" ? "Choose images to combine into PDF" : mode === "text" ? "Choose a PDF" : "Choose a document"}
          <small>{sources.length ? sources.join(" · ") : "Only the formats supported by this operation are accepted."}</small>
        </span><Plus size={17}/>
      </button>
      <div className="engine-directory">
        <div><strong>Output location</strong><small>{destination || "Alongside the source file"}</small></div>
        {destination && <button className="text-action" onClick={() => setDestination(null)}>Reset</button>}
        <button className="button secondary" disabled={busy} onClick={() => void folder()}><Folder size={16}/> Choose folder</button>
      </div>
    </div>
    {mode === "split" && <div className="engine-card">
      <div className="engine-directory"><div><strong>Split method</strong><small>Create individual, readable PDF files—not binary volumes or ZIP archives.</small></div>
      <select aria-label="PDF splitting method" value={splitMode} onChange={event => {
        const next = event.target.value as "size" | "parts" | "pages";
        setSplitMode(next); setSplitValue(next === "parts" ? "2" : next === "pages" ? "1" : "5");
      }}>
        <option value="size">Approximate MB per PDF</option>
        <option value="parts">Number of output PDFs</option>
        <option value="pages">Pages per PDF</option>
      </select></div>
      <div className="engine-directory"><label htmlFor="document-split-value">{splitMode === "size" ? "Approximate size (MB)" : splitMode === "parts" ? "Number of PDF files" : "Pages per PDF"}</label>
      <input id="document-split-value" type="number" min={splitMode === "parts" ? 2 : 1} max={4096} step={1} value={splitValue} onChange={event => setSplitValue(event.target.value)}/></div>
    </div>}
    <div className="engine-action-row">
      <div><strong>{mode === "office" ? office ? "LibreOffice available" : "LibreOffice is required" : "Local PDF tools"}</strong>
        <small>{mode === "text" ? "Extract selectable PDF text. Scans require separate OCR."
          : mode === "images" ? "One page per image · A4 layout"
          : mode === "split" ? "Each part is a valid PDF. Size splitting respects page boundaries."
          : "Document layout fidelity depends on LibreOffice."}</small>
      </div>
      <button className="button primary" disabled={!sources.length || busy || (mode === "office" && !office)}
        onClick={() => void process()}>
        {busy ? <><LoaderCircle size={17} className="engine-spin"/> Processing…</>
          : <>{mode === "split" ? "Split PDF" : "Convert"} <ArrowRight size={16}/></>}
      </button>
    </div>
    {outputSelector(result, error)}
    {splitOutputs.length > 0 && <div className="engine-card"><strong>Created {splitOutputs.length} standalone PDFs</strong>{splitOutputs.map(path => <button type="button" key={path} className="text-action" onClick={() => void invoke("reveal_output", { path })}>{fileName(path)}</button>)}{splitWarning && <p role="status">{splitWarning}</p>}</div>}
    <div className="document-preview-link-row">
      {onPreview && sources[0]?.toLowerCase().endsWith(".pdf") && <button type="button" className="button secondary" onClick={() => onPreview(sources[0])}><FileText size={15}/> Preview source PDF</button>}
      {onPreview && result && /\.(pdf|txt|md|markdown)$/i.test(result) && <button type="button" className="button secondary" onClick={() => onPreview(result)}><FileText size={15}/> Preview converted file</button>}
      <small>Preview shows actual PDF pages, including embedded pictures.</small>
    </div>
    <p className="engine-footnote">This preview does not recreate editable DOCX from PDF, remove PDF passwords, or perform OCR. Each operation verifies its output before reporting success.</p>
  </div>;
}

export function EnginesPanel() {
  const [engines, setEngines] = useState<Engines | null>(null);
  const [officeReady, setOfficeReady] = useState(false);
  const [calibreReady, setCalibreReady] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      const [tools, office, calibre] = await Promise.all([
        invoke<Engines>("engine_status"), invoke<boolean>("office_available"),
        invoke<boolean>("ebook_engine_available"),
      ]);
      setEngines(tools);
      setOfficeReady(office);
      setCalibreReady(calibre);
    } catch (cause) { setError(String(cause)); }
  }
  useEffect(() => { if (isTauri()) void refresh(); }, []);

  const items = [
    { name: "Image and PDF tools", ready: true, detail: "Included · six raster types, ZIP, image-to-PDF and PDF text", command: null },
    { name: "FFmpeg + FFprobe", ready: !!engines?.ffmpeg && !!engines?.ffprobe,
      detail: "Audio and video conversion, trimming and quality presets", command: "winget install -e --id Gyan.FFmpeg" },
    { name: "7-Zip", ready: !!engines?.sevenZip,
      detail: "7z, split volumes and extraction of RAR, ISO, TAR, CAB and many more", command: "winget install -e --id 7zip.7zip" },
    { name: "WinRAR", ready: !!engines?.winrar,
      detail: "Optional. Needed only to CREATE RAR archives.", command: "winget install -e --id RARLab.WinRAR" },
    { name: "Calibre", ready: calibreReady,
      detail: "Offline EPUB, MOBI, FB2, PDF and DOCX e-book conversions.",
      command: "winget install -e --id calibre.calibre" },
    { name: "LibreOffice", ready: officeReady,
      detail: "Optional. Converts DOCX, PPTX, XLSX, ODT and other office files to PDF.",
      command: "winget install -e --id TheDocumentFoundation.LibreOffice" },
  ];

  async function copy(name: string, command: string) {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(name);
      setError(null);
    } catch (cause) { setError(String(cause)); }
  }

  return <div className="content engine-page">
    <h1>Engine status</h1>
    <p>ReformANY keeps processing local. Core image, PDF and ZIP features are built in; larger format engines use software already installed on Windows.</p>
    <div className="engine-action-row">
      <div><strong>Engine readiness</strong><small>Refresh after installing any external tool.</small></div>
      <button className="button secondary" onClick={() => void refresh()}>Refresh status</button>
    </div>
    <div className="engine-dependency-list">
      {items.map(item => <div className="engine-dependency" key={item.name}>
        <div className={"engine-indicator " + (item.ready ? "is-ready" : "is-missing")}>
          {item.ready ? <CheckCircle2 size={18}/> : <CircleAlert size={18}/>}
        </div>
        <div className="engine-dependency-description">
          <strong>{item.name}</strong>
          <small>{item.detail}</small>
        </div>
        <span className="engine-dependency-status">{item.ready ? "Ready" : "Not detected"}</span>
        {!item.ready && item.command && <button className="button secondary" onClick={() => void copy(item.name, item.command as string)}>
          {copied === item.name ? "Copied" : "Copy install command"}
        </button>}
      </div>)}
    </div>
    {error && <p className="engine-error">{error}</p>}
    <div className="engine-action-row">
      <div><strong>Updates are always your choice</strong>
        <small>No background checks or downloads. Opens the official release page only when clicked.</small>
      </div>
      <button className="button secondary" type="button"
        onClick={() => void invoke("open_manual_updates").catch(cause => setError(String(cause)))}>
        Check for updates
      </button>
    </div>
    <p className="engine-footnote">To install a missing engine, copy its command, open Windows Terminal and paste it. You control the installation; ReformANY does not silently download or install third-party programs. Restart ReformANY after changing PATH.</p>
  </div>;
}
