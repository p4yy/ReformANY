import { useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ArrowRight, Captions, CheckCircle2, CircleAlert, FileSpreadsheet, Folder, FolderOpen, LoaderCircle, Plus } from "lucide-react";

type Kind = "subtitles" | "spreadsheets";
const TABLE_TARGETS = ["csv", "tsv", "json", "xlsx"] as const;
const SUBTITLE_TARGETS = ["srt", "vtt"] as const;
const TABLE_INPUTS = ["csv", "tsv", "json", "xlsx", "xls", "ods"] as const;
const SUBTITLE_INPUTS = ["srt", "vtt"] as const;

export default function DataToolsPanel({ kind }: { kind: Kind }) {
  const subtitles = kind === "subtitles";
  const [input, setInput] = useState<string | null>(null);
  const [target, setTarget] = useState<string>(subtitles ? "vtt" : "xlsx");
  const [destination, setDestination] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inputTypes = subtitles ? SUBTITLE_INPUTS : TABLE_INPUTS;
  const outputTypes = subtitles ? SUBTITLE_TARGETS : TABLE_TARGETS;
  async function choose() {
    if (!isTauri()) { setError("Open the installed Windows app to select a file."); return; }
    try {
      const result = await open({ multiple: false, directory: false,
        filters: [{ name: subtitles ? "Subtitle files" : "Spreadsheets and tables",
          extensions: [...inputTypes] }] });
      if (typeof result !== "string") return;
      setInput(result); setOutput(null); setError(null);
      const extension = result.split(".").at(-1)?.toLowerCase();
      const defaultTarget = extension === "srt" ? "vtt" : extension === "vtt" ? "srt"
        : extension === "xlsx" ? "csv" : "xlsx";
      setTarget(defaultTarget);
    } catch (cause) { setError(String(cause)); }
  }
  async function pickFolder() {
    try {
      const path = await open({ directory: true, multiple: false });
      if (typeof path === "string") setDestination(path);
    } catch (cause) { setError(String(cause)); }
  }
  async function run() {
    if (!input || working) return;
    setWorking(true); setOutput(null); setError(null);
    try {
      const command = subtitles ? "subtitle_convert" : "spreadsheet_convert";
      const result = await invoke<string>(command,
        { job: { path: input, target, destination } });
      setOutput(result);
    } catch (cause) { setError(String(cause)); }
    finally { setWorking(false); }
  }

  return <div className="content engine-page" aria-labelledby="data-workspace-heading">
    <div className="eyebrow">{subtitles ? "SUBTITLE CONVERSION" : "SPREADSHEET CONVERSION"}</div>
    <h1 id="data-workspace-heading">{subtitles ? "Subtitles" : "Spreadsheets"}</h1>
    <p>{subtitles ? "Convert SRT and WebVTT captions while preserving cue text and timestamps."
      : "Convert CSV, TSV, JSON and XLSX locally, with XLS/ODS import. Text identifiers keep their leading zeros."}</p>
    <div className="engine-card">
      <div className="engine-card-title">{subtitles ? <Captions size={19}/> : <FileSpreadsheet size={19}/>}
        <h2>Choose source</h2></div>
      <button className="engine-input" disabled={working} onClick={() => void choose()} aria-label="Choose input file">
        {subtitles ? <Captions size={23}/> : <FileSpreadsheet size={23}/>}
        <span>{input ? input.split(/[\\/]/).at(-1) : "Select a local file"}
          <small dir="auto">{input || inputTypes.join(", ").toUpperCase()}</small></span><Plus size={16}/>
      </button>
      <div className="engine-form-grid">
        <label htmlFor="data-target-format">Output format
          <select id="data-target-format" value={target} disabled={working}
            onChange={event => setTarget(event.target.value)}>
            {outputTypes.map(ext => <option value={ext} key={ext}>{ext.toUpperCase()}</option>)}
          </select>
        </label>
      </div>
      <div className="engine-directory">
        <div><strong>Save destination</strong><small dir="auto">{destination || "Alongside the original"}</small></div>
        {destination && <button className="text-action" onClick={() => setDestination(null)}>Reset</button>}
        <button className="button secondary" disabled={working} onClick={() => void pickFolder()}>
          <Folder size={16}/> Choose folder
        </button>
      </div>
    </div>
    <div className="engine-action-row">
      <div><strong>Offline · Originals preserved</strong>
        <small>{subtitles ? "Unsupported styling and positioning are rejected rather than discarded."
          : "Values only. Workbook formulas, charts and formatting are not reproduced."}</small></div>
      <button className="button primary" disabled={!input || working} onClick={() => void run()}>
        {working ? <><LoaderCircle className="engine-spin" size={17}/> Processing…</>
          : <>Convert <ArrowRight size={16}/></>}
      </button>
    </div>
    {error && <p role="alert" className="engine-error"><CircleAlert size={16}/> {error}</p>}
    {output && <div className="engine-success" role="status">
      <div><CheckCircle2 size={18}/> File saved<small dir="auto">{output}</small></div>
      <button className="button secondary" onClick={() => void invoke("reveal_output", { path: output })}>
        <FolderOpen size={15}/> Show file
      </button>
    </div>}
    <p className="engine-footnote">{subtitles
      ? "Only SRT and WebVTT are currently supported. Styles and regions need a future, lossless format adapter."
      : "Limits: 50,000 rows, 128 columns and 24 MB source. Workbook export reads the first sheet's cached values; it does not preserve formulas, formatting or additional sheets."}</p>
  </div>;
}
