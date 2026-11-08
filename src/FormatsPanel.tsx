import { useEffect, useMemo, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowRight, CheckCircle2, CircleAlert, FileImage, FileSpreadsheet, Captions,
  Folder, FolderOpen, LoaderCircle, Plus,
} from "lucide-react";
import "./formats.css";

type Category = "images" | "subtitles" | "tables";
type ImageOption = { input: string[]; targets: string[]; note: string };

const IMAGE_ROUTES: ImageOption[] = [
  { input: ["svg"], targets: ["png"], note: "Render a static SVG locally as PNG" },
  { input: ["ico"], targets: ["png"], note: "Extract an image from a Windows icon" },
  { input: ["png", "jpg", "jpeg", "webp", "bmp"], targets: ["ico"],
    note: "Make a PNG-based Windows icon (up to 256px)" },
  { input: ["png", "jpg", "jpeg", "webp"], targets: ["avif"],
    note: "AVIF requires FFmpeg with an AV1 encoder" },
  { input: ["avif", "heic", "heif", "dng", "cr2", "nef", "arw"], targets: ["png"],
    note: "Photo decoding is experimental; FFmpeg must support this specific file" },
];
const inputs: Record<Category, string[]> = {
  images: [...new Set(IMAGE_ROUTES.flatMap(item => item.input))],
  subtitles: ["srt", "vtt"],
  tables: ["csv", "tsv", "json", "xlsx", "xls", "ods"],
};
const defaultTargets: Record<Category, string> = {
  images: "png", subtitles: "vtt", tables: "xlsx",
};
const categories: { key: Category; title: string; note: string }[] = [
  { key: "images", title: "Advanced images", note: "SVG, ICO and optional AVIF/HEIC/RAW" },
  { key: "subtitles", title: "Subtitles", note: "SRT ↔ WebVTT with accurate timing" },
  { key: "tables", title: "Spreadsheets", note: "CSV, TSV, JSON and Excel" },
];
const filename = (p: string) => p.split(/[\\/]/).pop() || p;
const fileExt = (p: string | null) => (p || "").split(".").pop()?.toLowerCase() || "";

export default function FormatsPanel() {
  const [category, setCategory] = useState<Category>("images");
  const [input, setInput] = useState<string | null>(null);
  const [target, setTarget] = useState(defaultTargets.images);
  const [destination, setDestination] = useState<string | null>(null);
  const [ffmpeg, setFfmpeg] = useState(false);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sourceType = fileExt(input);
  const selection = IMAGE_ROUTES.find(item => item.input.includes(sourceType));
  const targetChoices = useMemo(() => {
    if (category === "images") return selection?.targets ?? ["png", "ico", "avif"];
    if (category === "subtitles") return ["srt", "vtt"];
    return ["csv", "tsv", "json", "xlsx"];
  }, [category, selection]);
  const needsFfmpeg = category === "images" && (target === "avif" ||
    ["avif", "heic", "heif", "dng", "cr2", "nef", "arw"].includes(sourceType));
  const note = category === "images" ? (selection?.note ??
      "Choose a source to see supported routes. Some photo decoders are optional.")
    : category === "subtitles" ?
      "Cue order, timing and Unicode are preserved. Styling/regions are rejected instead of lost silently."
      : "Table cells stay literal strings. XLS/ODS read uses the first worksheet; formulas/formatting are not preserved.";

  useEffect(() => {
    if (!isTauri()) return;
    invoke<{ ffmpeg: boolean }>("engine_status")
      .then(value => setFfmpeg(value.ffmpeg))
      .catch(() => setFfmpeg(false));
  }, []);

  function changeCategory(next: Category) {
    setCategory(next);
    setInput(null);
    setOutput(null);
    setError(null);
    setTarget(defaultTargets[next]);
  }

  async function chooseFile() {
    try {
      const value = await open({ multiple: false, directory: false, filters: [
        { name: "Supported " + category, extensions: inputs[category] },
      ] });
      if (typeof value === "string") {
        setInput(value);
        setError(null); setOutput(null);
        const ext = fileExt(value);
        if (category === "images") {
          setTarget(IMAGE_ROUTES.find(route => route.input.includes(ext))?.targets[0] || "png");
        } else if (category === "subtitles") {
          setTarget(ext === "srt" ? "vtt" : "srt");
        } else {
          setTarget(["xlsx", "xls", "ods"].includes(ext) ? "csv" : "xlsx");
        }
      }
    } catch (cause) { setError(String(cause)); }
  }

  async function chooseFolder() {
    try {
      const value = await open({ directory: true, multiple: false });
      if (typeof value === "string") setDestination(value);
    } catch (cause) { setError(String(cause)); }
  }

  async function convert() {
    if (!input || busy || (needsFfmpeg && !ffmpeg) ||
      !targetChoices.includes(target)) return;
    setBusy(true); setError(null); setOutput(null);
    try {
      const command = category === "images" ? "advanced_image_convert"
        : category === "subtitles" ? "subtitle_convert" : "table_convert";
      const result = await invoke<string>(command, {
        job: { path: input, target, destination },
      });
      setOutput(result);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  const Icon = category === "images" ? FileImage :
    category === "subtitles" ? Captions : FileSpreadsheet;
  return <div className="content engine-page">
    <div className="eyebrow">ADDITIONAL LOCAL FORMATS</div>
    <h1>More ways to convert.</h1>
    <p>Small, verified conversion routes—not a long menu of unsupported promises.</p>

    <div className="formats-category-tabs" role="tablist" aria-label="Conversion category">
      {categories.map(item => (
        <button key={item.key} type="button" role="tab"
          aria-selected={category === item.key}
          className={category === item.key ? "selected" : ""}
          onClick={() => changeCategory(item.key)}>
          <strong>{item.title}</strong><small>{item.note}</small>
        </button>
      ))}
    </div>

    <div className="engine-card">
      <div className="engine-card-title"><Icon size={19}/><h2>{categories.find(item => item.key === category)?.title}</h2></div>
      <button type="button" className="engine-input" disabled={busy} onClick={() => void chooseFile()}>
        <Icon size={22}/><span>{input ? filename(input) : "Choose a file"}
          <small title={input || undefined}>{input || inputs[category].map(x => x.toUpperCase()).join(" · ")}</small>
        </span><Plus size={17}/>
      </button>
      <div className="engine-form-grid">
        <label>Convert to
          <select value={target} disabled={busy}
            onChange={event => setTarget(event.target.value)}>
            {targetChoices.map(option => <option key={option} value={option}>{option.toUpperCase()}</option>)}
          </select>
        </label>
      </div>
      <p className="formats-note">{note}</p>
      <div className="engine-directory">
        <div><strong>Output location</strong><small>{destination || "Next to the source file"}</small></div>
        {destination && <button type="button" className="text-action" onClick={() => setDestination(null)}>Reset</button>}
        <button className="button secondary" disabled={busy} onClick={() => void chooseFolder()}><Folder size={16}/> Choose folder</button>
      </div>
    </div>
    <div className="engine-action-row">
      <div><strong>{needsFfmpeg && !ffmpeg ? "FFmpeg required for this route" : "Local conversion"}</strong>
        <small>Original files remain untouched. Success is confirmed only after output verification.</small>
      </div>
      <button type="button" className="button primary" disabled={!input || busy || (needsFfmpeg && !ffmpeg)}
        onClick={() => void convert()}>
        {busy ? <><LoaderCircle size={16} className="engine-spin"/> Processing…</>
          : <>Convert <ArrowRight size={16}/></>}
      </button>
    </div>
    {output && <div className="engine-success" role="status">
      <div><CheckCircle2 size={18}/> Done<small>{output}</small></div>
      <button className="button secondary" onClick={() => void invoke("reveal_output", { path: output })}><FolderOpen size={15}/> Show result</button>
    </div>}
    {error && <p className="engine-error" role="alert"><CircleAlert size={16}/>{error}</p>}
    <p className="engine-footnote">AVIF requires an installed FFmpeg encoder; HEIC/HEIF and camera RAW require specific locally installed decoders. Unsupported devices/formats return a clear error. SVG animations are not rendered; no network assets are loaded.</p>
  </div>;
}
