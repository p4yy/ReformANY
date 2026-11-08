import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ClipboardCopy, FileImage, FolderOpen, Pin, X } from "lucide-react";
import { getLanguage, setDocumentLanguage } from "./localization";

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

  useEffect(() => {
    setDocumentLanguage(getLanguage());
    let alive = true;
    void invoke<FloatInfo | null>("float_file_context").then(value => {
      if (!alive || !value) return;
      setFile(value);
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
      setNote("Path copied");
    } catch (reason) { setError(String(reason)); }
  }

  return <div className="float-shell">
    <header className="float-topbar">
      <img src="/brand/reformany-mark.jpg" alt="" className="float-logo"/>
      <strong>ReformANY Float</strong><Pin size={14} className="float-pin"/>
      <button aria-label="Close floating preview" onClick={() => void getCurrentWindow().close()}><X size={17}/></button>
    </header>
    <main className="float-content">
      <div className="float-preview">{preview
        ? <img src={preview} alt="Selected file preview"/>
        : <FileImage size={46} strokeWidth={1.3} aria-hidden/>}
      </div>
      <strong title={file?.name}>{file?.name || "Selected file"}</strong>
      <small>{file ? size(file.bytes) : "Loading…"}</small>
      <p title={file?.path}>{file?.path || " "}</p>
    </main>
    <footer className="float-actions">
      <button onClick={() => void copy()} disabled={!file}><ClipboardCopy size={16}/> Copy path</button>
      <button onClick={() => void show()} disabled={!file}><FolderOpen size={16}/> Show file</button>
    </footer>
    {(error || note) && <div className={error ? "float-error" : "float-note"} role="status">{error || note}</div>}
  </div>;
}
