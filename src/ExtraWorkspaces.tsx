import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Archive as ArchiveIcon, ArrowRight, CheckCircle2, CircleAlert,
  FileArchive, FileVideo, Folder, FolderOpen, LoaderCircle, Lock, Plus, Trash2,
} from "lucide-react";

type Engines = {
  ffmpeg: boolean;
  ffprobe: boolean;
  sevenZip: boolean;
  winrar: boolean;
};

const videoTypes = ["mp4", "webm", "mkv", "mov", "avi"];
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

export function MediaPanel() {
  const engines = useEngines();
  const [input, setInput] = useState<string | null>(null);
  const [target, setTarget] = useState("mp4");
  const [profile, setProfile] = useState("standard");
  const [start, setStart] = useState("");
  const [duration, setDuration] = useState("");
  const [destination, setDestination] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ready = Boolean(engines?.ffmpeg && engines?.ffprobe);

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
        setTarget(ext && ["mp3","m4a","wav","flac","ogg","opus","aac","wma","aiff","ac3"].includes(ext) ? "mp3" : "mp4");
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
    setBusy(true); setError(null); setResult(null);
    try {
      const output = await invoke<string>("media_convert", {
        job: {
          path: input, target, profile, destination,
          startSeconds: start.trim() ? Number(start) : null,
          durationSeconds: duration.trim() ? Number(duration) : null,
        },
      });
      setResult(output);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  return <div className="content engine-page">
    <div className="eyebrow">LOCAL MEDIA ENGINE</div>
    <h1>Audio & video.</h1>
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
    {outputSelector(result, error)}
    <p className="engine-footnote">Codec availability depends on the installed FFmpeg build. This preview reports processing state, not invented percentages. Trim is optional.</p>
  </div>;
}

export function ArchivePanel() {
  const engines = useEngines();
  const [mode, setMode] = useState<"create" | "extract">("create");
  const [sources, setSources] = useState<string[]>([]);
  const [format, setFormat] = useState("7z");
  const [name, setName] = useState("ReformANY Archive");
  const [password, setPassword] = useState("");
  const [split, setSplit] = useState("0");
  const [level, setLevel] = useState("5");
  const [destination, setDestination] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [extra, setExtra] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const supported = format === "rar" ? Boolean(engines?.winrar) : Boolean(engines?.sevenZip);
  const canRun = mode === "extract" ? Boolean(engines?.sevenZip) : supported;

  async function addFiles() {
    try {
      const selection = await open({ multiple: mode === "create", directory: false });
      const paths = selection ? (Array.isArray(selection) ? selection : [selection]) : [];
      if (paths.length) {
        setSources(previous => mode === "create" ? [...new Set([...previous, ...paths])] : paths.slice(0, 1));
        if (mode === "extract") setName(stem(paths[0]));
        else if (sources.length === 0) setName(stem(paths[0]) || "ReformANY Archive");
      }
    } catch (cause) { setError(String(cause)); }
  }

  async function addFolder() {
    try {
      const path = await open({ directory: true, multiple: false });
      if (typeof path === "string") {
        setSources(previous => [...new Set([...previous, path])]);
        if (sources.length === 0) setName(stem(path) || "ReformANY Archive");
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
      if (mode === "create") {
        const result = await invoke<{ outputPaths: string[] }>("archive_create", {
          job: {
            paths: sources, destination, name, format,
            password: password || null, splitMegabytes: Number(split) || null,
            level: Number(level),
          },
        });
        setResult(result.outputPaths[0] || null);
        setExtra(result.outputPaths.slice(1));
      } else {
        const result = await invoke<string>("archive_extract", {
          job: { path: sources[0], destination, password: password || null },
        });
        setResult(result);
      }
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  return <div className="content engine-page">
    <div className="eyebrow">LOCAL ARCHIVE ENGINE</div>
    <h1>Archives, handled.</h1>
    <p>Build encrypted archives, split into volumes, or extract supported formats with 7-Zip and WinRAR.</p>
    <div className="engine-switch">
      <button className={mode === "create" ? "selected" : ""} onClick={() => {setMode("create");setSources([]);setResult(null);setError(null);}}>Create archive</button>
      <button className={mode === "extract" ? "selected" : ""} onClick={() => {setMode("extract");setSources([]);setResult(null);setError(null);}}>Extract archive</button>
    </div>

    <div className="engine-card">
      <div className="engine-card-title"><FileArchive size={18}/><h2>{mode === "create" ? "Files to package" : "Archive to extract"}</h2></div>
      <div className="engine-import-row">
        <button className="button secondary" disabled={busy} onClick={() => void addFiles()}><Plus size={16}/> {mode === "create" ? "Add files" : "Choose archive"}</button>
        {mode === "create" && <button className="button secondary" disabled={busy} onClick={() => void addFolder()}><Folder size={16}/> Add folder</button>}
        {!!sources.length && <button className="text-action" disabled={busy} onClick={() => setSources([])}><Trash2 size={14}/> Clear</button>}
      </div>
      <div className="engine-source-list">
        {sources.length ? sources.map(path => <div key={path}><ArchiveIcon size={15}/><span title={path}>{fileName(path)}</span>
          <button aria-label={"Remove "+fileName(path)} disabled={busy} onClick={() => setSources(current => current.filter(item => item !== path))}>×</button></div>)
          : <p>{mode === "create" ? "Select files or a folder to compress." : "Select a ZIP, 7z, RAR, TAR or another format supported by your 7-Zip installation."}</p>}
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
      <label className="engine-password"><Lock size={15}/> Password
        <input type="password" placeholder="Optional" autoComplete="new-password" value={password}
          disabled={busy || (mode === "create" && !["zip","7z","rar"].includes(format))}
          onChange={event => setPassword(event.target.value)}/>
      </label>
      <div className="engine-directory">
        <div><strong>Destination</strong><small>{destination || "Alongside the selected files"}</small></div>
        {destination && <button className="text-action" onClick={() => setDestination(null)}>Reset</button>}
        <button className="button secondary" disabled={busy} onClick={() => void selectDestination()}><Folder size={16}/> Choose folder</button>
      </div>
    </div>
    <div className="engine-action-row">
      <div><strong>{canRun ? "Archive engine available" : (format === "rar" && mode === "create" ? "WinRAR required for RAR creation" : "7-Zip required")}</strong>
        <small>{mode === "create" ? "Selected originals are kept · existing archives never replaced" : "Extract into a new folder · existing files are kept"}</small></div>
      <button className="button primary" disabled={!sources.length || !canRun || busy} onClick={() => void execute()}>
        {busy ? <><LoaderCircle size={17} className="engine-spin"/> Working…</>
          : <>{mode === "create" ? "Create archive" : "Extract files"} <ArrowRight size={16}/></>}
      </button>
    </div>
    {outputSelector(result, error)}
    {extra.length > 0 && <p className="engine-footnote">{extra.length} additional part(s) saved alongside the first volume.</p>}
    <p className="engine-footnote">7-Zip supports many more extraction formats than creation formats. For encrypted archives, filenames in ZIP remain visible; 7z can encrypt filenames. External command-line tools can expose passwords to other local processes during a job. The app does not store passwords.</p>
  </div>;
}
