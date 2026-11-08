import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { BookOpen, CheckCircle2, CircleAlert, FolderOpen, LoaderCircle, Plus, ArrowRight, Folder } from "lucide-react";

const inputs = ["epub", "mobi", "fb2", "fbz", "azw", "azw3", "cbz", "cbr", "cb7",
  "pdf", "docx", "odt", "rtf", "html", "htmlz", "txt"];
const outputs = ["epub", "mobi", "fb2", "azw3", "docx", "pdf", "txt", "rtf", "htmlz"];
function fileName(value: string) { return value.split(/[\\/]/).pop() || value; }

export default function EbookPanel() {
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState<string | null>(null);
  const [format, setFormat] = useState("epub");
  const [destination, setDestination] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<boolean>("ebook_engine_available").then(setReady).catch(() => setReady(false));
  }, []);

  async function chooseFile() {
    try {
      const source = await open({ multiple: false, directory: false, filters: [
        { name: "E-books and documents", extensions: inputs },
      ] });
      if (typeof source === "string") {
        setInput(source);
        setOutput(null);
        setError(null);
        const sourceType = source.split(".").pop()?.toLowerCase();
        setFormat(sourceType === "pdf" ? "docx" : sourceType === "epub" ? "mobi" : "epub");
      }
    } catch (cause) { setError(String(cause)); }
  }
  async function chooseFolder() {
    try {
      const dir = await open({ directory: true, multiple: false });
      if (typeof dir === "string") setDestination(dir);
    } catch (cause) { setError(String(cause)); }
  }
  async function convert() {
    if (!ready || !input || busy) return;
    setBusy(true);setOutput(null);setError(null);
    try {
      const result = await invoke<string>("ebook_convert_file", {
        job: { path: input, target: format, destination },
      });
      setOutput(result);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  return <div className="content engine-page">
    <div className="eyebrow">LOCAL BOOK ENGINE</div>
    <h1>Books, in your format.</h1>
    <p>EPUB, MOBI, FB2, PDF and DOCX conversions through Calibre—locally, without uploading your books.</p>
    <div className="engine-card">
      <div className="engine-card-title"><BookOpen size={20}/><h2>Source</h2></div>
      <button className="engine-input" disabled={busy} onClick={() => void chooseFile()}>
        <BookOpen size={24}/><span>{input ? fileName(input) : "Choose an e-book or PDF"}
          <small>{input || "EPUB, MOBI, FB2, AZW3, CBZ/CBR, PDF, DOCX and more"}</small></span>
        <Plus size={16}/>
      </button>
      <div className="engine-form-grid">
        <label>Convert to
          <select value={format} disabled={busy} onChange={event => setFormat(event.target.value)}>
            {outputs.map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}
          </select>
        </label>
      </div>
      <div className="engine-directory">
        <div><strong>Save destination</strong><small>{destination || "Alongside the original"}</small></div>
        {destination && <button className="text-action" onClick={() => setDestination(null)}>Reset</button>}
        <button className="button secondary" onClick={() => void chooseFolder()} disabled={busy}><Folder size={16}/> Choose folder</button>
      </div>
    </div>
    <div className="engine-action-row">
      <div><strong>{ready ? "Calibre is available" : "Calibre is not installed"}</strong>
        <small>{ready ? "Original kept; output verified" : "Install Calibre and restart ReformANY to enable this engine."}</small>
      </div>
      <button className="button primary" onClick={() => void convert()} disabled={busy || !ready || !input}>
        {busy ? <><LoaderCircle className="engine-spin" size={17}/> Converting…</> : <>Convert e-book <ArrowRight size={16}/></>}
      </button>
    </div>
    {output && <div className="engine-success" role="status"><div><CheckCircle2 size={18}/> Converted<small>{output}</small></div>
      <button className="button secondary" onClick={() => void invoke("reveal_output", { path: output })}><FolderOpen size={16}/> Show file</button>
    </div>}
    {error && <p className="engine-error" role="alert"><CircleAlert size={16}/> {error}</p>}
    <p className="engine-footnote">PDF → DOCX reconstructs editable text and layout only approximately. Complex tables, columns, scanned pages and fonts may not survive. Calibre does not remove DRM.</p>
  </div>;
}
