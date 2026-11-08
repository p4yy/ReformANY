import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { save } from "@tauri-apps/plugin-dialog";
import { ClipboardCopy, Download, FileImage, FolderOpen, Pin, QrCode, X } from "lucide-react";
import { getLanguage, setDocumentLanguage } from "./localization";
import { appIcon } from "./brand";

type FloatInfo = { path: string; name: string; bytes: number };

function size(value: number): string {
  return value > 1048576 ? (value / 1048576).toFixed(1) + " MB"
    : value > 1024 ? (value / 1024).toFixed(1) + " KB" : value + " B";
}

export default function FloatView() {
  const [file, setFile] = useState<FloatInfo | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [mode, setMode] = useState<"preview" | "qr">("preview");
  const [qrContent, setQrContent] = useState("");
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [qrBusy, setQrBusy] = useState(false);

  useEffect(() => {
    setDocumentLanguage(getLanguage());
    let alive = true;
    void invoke<FloatInfo | null>("float_file_context").then(value => {
      if (!alive || !value) return;
      setFile(value);
      setQrContent(value.path);
      void invoke<string | null>("image_thumbnail", { path: value.path })
        .then(src => { if (alive) setPreview(src); })
        .catch(() => { /* Non-images display a file icon. */ });
    }).catch(reason => { if (alive) setError(String(reason)); });
    return () => { alive = false; };
  }, []);

  async function show() {
    if (!file) return;
    try { await invoke("reveal_output", { path: file.path }); }
    catch (reason) { setError(String(reason)); }
  }

  async function copy() {
    if (!file) return;
    try {
      await navigator.clipboard.writeText(file.path);
      setError(null);
      setNote("Path copied");
    } catch (reason) { setError(String(reason)); }
  }

  async function generateQR() {
    setQrBusy(true);
    setError(null);
    setNote(null);
    setQrSvg(null);
    try {
      const svg = await invoke<string>("qr_svg", { content: qrContent });
      setQrSvg(svg);
      setNote("QR code generated offline");
    } catch (reason) { setError(String(reason)); }
    finally { setQrBusy(false); }
  }

  async function saveQR() {
    if (!qrSvg) return;
    try {
      const destination = await save({
        title: "Save QR code",
        defaultPath: "reformany-qr.svg",
        filters: [{ name: "SVG image", extensions: ["svg"] }],
      });
      if (!destination) return;
      await invoke("qr_save_svg", { content: qrContent, destination });
      setError(null);
      setNote("QR code saved");
    } catch (reason) { setError(String(reason)); }
  }

  const qrImage = qrSvg ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(qrSvg) : null;

  return <div className="float-shell">
    <header className="float-topbar">
      <img src={appIcon} alt="" className="float-logo"/>
      <strong>ReformANY Float</strong><Pin size={14} className="float-pin"/>
      <button aria-label="Close floating preview" onClick={() => void getCurrentWindow().close()}><X size={17}/></button>
    </header>
    <nav className="float-tabs" aria-label="Float view">
      <button aria-current={mode === "preview" ? "page" : undefined} onClick={() => { setMode("preview"); setError(null); }}><FileImage size={14}/> File</button>
      <button aria-current={mode === "qr" ? "page" : undefined} onClick={() => { setMode("qr"); setError(null); }}><QrCode size={14}/> QR code</button>
    </nav>
    {mode === "preview" ? <main className="float-content">
      <div className="float-preview">{preview
        ? <img src={preview} alt="Selected file preview"/>
        : <FileImage size={46} strokeWidth={1.3} aria-hidden/>}
      </div>
      <strong title={file?.name}>{file?.name || "Selected file"}</strong>
      <small>{file ? size(file.bytes) : "Loading…"}</small>
      <p title={file?.path}>{file?.path || " "}</p>
    </main> : <main className="float-qr-content">
      <label htmlFor="float-qr-data">Text, URL, or local file path</label>
      <textarea id="float-qr-data" maxLength={1600} rows={2} spellCheck={false}
        value={qrContent} onChange={event => { setQrContent(event.target.value); setQrSvg(null); setNote(null); }}/>
      <div className="float-qr-actions">
        <button onClick={() => void generateQR()} disabled={!qrContent.trim() || qrBusy}>
          <QrCode size={15}/>{qrBusy ? "Generating…" : "Generate QR"}
        </button>
        <button onClick={() => void saveQR()} disabled={!qrSvg || qrBusy}>
          <Download size={15}/> Save SVG
        </button>
      </div>
      {qrImage ? <div className="float-qr-image"><img src={qrImage} alt="Generated QR code for the entered content"/></div> :
        <div className="float-qr-empty"><QrCode size={44} strokeWidth={1.2}/><span>Generate a QR code to preview it here</span></div>}
      <small>A local Windows path is not a file-sharing link. Scanning its QR code does not transfer the file.</small>
    </main>}
    <footer className="float-actions">
      <button onClick={() => void copy()} disabled={!file}><ClipboardCopy size={16}/> Copy path</button>
      <button onClick={() => void show()} disabled={!file}><FolderOpen size={16}/> Show file</button>
    </footer>
    {(error || note) && <div className={error ? "float-error" : "float-note"} role="status">{error || note}</div>}
  </div>;
}
