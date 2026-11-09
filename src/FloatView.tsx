import { useEffect, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    setDocumentLanguage(getLanguage());
    void getCurrentWindow().isAlwaysOnTop().then(setPinned).catch(() => { /* use startup default */ });
    let alive = true;
    let requestId = 0;
    const refresh = () => {
      const currentRequest = ++requestId;
      setPreview(null);
      setError(null);
      setNote(null);
      setMode("preview");
      setQrSvg(null);
      void invoke<FloatInfo | null>("float_file_context").then(value => {
        if (!alive || currentRequest !== requestId) return;
        setFile(value);
        setQrContent(value?.path || "");
        if (!value) return;
        void invoke<string | null>("image_thumbnail", { path: value.path })
          .then(src => {
            if (alive && currentRequest === requestId) setPreview(src);
          })
          .catch(() => { /* Non-images display their native media control. */ });
      }).catch(reason => {
        if (alive && currentRequest === requestId) setError(String(reason));
      });
    };
    // Subscribe first: a second Float request may arrive while the initial
    // WebView is loading. Never lose that notification or display stale media.
    const subscription = listen("reformany:float-file-changed", refresh);
    void subscription.then(() => { if (alive) refresh(); })
      .catch(reason => { if (alive) setError(String(reason)); });
    return () => {
      alive = false;
      ++requestId;
      void subscription.then(unlisten => unlisten()).catch(() => {});
    };
  }, []);

  async function togglePin() {
    try {
      const next = !pinned;
      await getCurrentWindow().setAlwaysOnTop(next);
      setPinned(next);
      setError(null);
      setNote(next ? "Float pinned above other windows" : "Float unpinned");
    } catch (reason) { setError("Cannot change Float pin state: " + String(reason)); }
  }

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
  const extension = (file?.name.split(".").pop() || "").toLowerCase();
  const assetUrl = file ? convertFileSrc(file.path) : null;
  const isImage = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "svg", "ico"].includes(extension);
  const isVideo = ["mp4", "m4v", "webm", "mov", "ogv"].includes(extension);
  const isAudio = ["mp3", "m4a", "aac", "wav", "ogg", "flac", "opus"].includes(extension);
  const isPdf = extension === "pdf";
  const playable = isImage || isVideo || isAudio || isPdf;
  const mediaError = () => setError("This media file could not be decoded by Windows WebView2. Try a supported MP4, MP3, WAV, or image format.");

  return <div className="float-shell">
    <header className="float-topbar" data-tauri-drag-region>
      <img src={appIcon} alt="" className="float-logo" data-tauri-drag-region/>
      <strong data-tauri-drag-region>ReformANY Float</strong>
      <button type="button" aria-label={pinned ? "Unpin Float" : "Keep Float on top"} aria-pressed={pinned}
        title={pinned ? "Always on top · click to unpin" : "Pin Float above other windows"}
        onClick={() => void togglePin()}><Pin size={15} fill={pinned ? "currentColor" : "none"}/></button>
      <button aria-label="Close floating preview" onClick={() => void getCurrentWindow().close()}><X size={17}/></button>
    </header>
    <nav className="float-tabs" aria-label="Float view">
      <button aria-current={mode === "preview" ? "page" : undefined} onClick={() => { setMode("preview"); setError(null); }}><FileImage size={14}/> File</button>
      <button aria-current={mode === "qr" ? "page" : undefined} onClick={() => { setMode("qr"); setError(null); }}><QrCode size={14}/> QR code</button>
    </nav>
    {mode === "preview" ? <main className="float-content">
      <div className="float-preview">
        {isImage && assetUrl
          ? <img src={assetUrl} alt="Selected image preview" onError={event => {
              if (preview && event.currentTarget.src !== preview) {
                event.currentTarget.src = preview;
              } else mediaError();
            }}/>
          : isVideo && assetUrl
            ? <video src={assetUrl} controls playsInline preload="metadata" onError={mediaError}/>
            : isAudio && assetUrl
              ? <div className="float-audio"><FileImage size={37} strokeWidth={1.3} aria-hidden/><audio src={assetUrl} controls preload="metadata" onError={mediaError}/></div>
              : isPdf && assetUrl
                ? <iframe src={assetUrl} title="PDF preview" onError={mediaError}/>
                : preview ? <img src={preview} alt="Selected file preview"/>
                  : <div className="float-unavailable"><FileImage size={42} strokeWidth={1.3} aria-hidden/><span>{file ? "Preview unavailable for this file type" : "Loading selected file…"}</span></div>}
      </div>
      <strong title={file?.name}>{file?.name || "Selected file"}</strong>
      {file && !playable && <small>Use Show file to open this type in its default application.</small>}
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
