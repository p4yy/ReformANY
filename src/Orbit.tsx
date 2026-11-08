import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowRight, Check, CheckCircle2, FileImage, FolderOpen, LoaderCircle, X } from "lucide-react";

type OrbitFile = {
  path: string;
  name: string;
  bytes: number;
  detected: string | null;
  error: string | null;
};
type Phase = "ready" | "processing" | "completed" | "failed";
type EventPayload = {
  id: string;
  status: "processing" | "completed" | "failed" | "cancelled" | "batch-finished";
  outputPath: string | null;
  error: string | null;
};
const formats = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WebP" },
  { value: "bmp", label: "BMP" },
] as const;

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export default function Orbit() {
  const [file, setFile] = useState<OrbitFile | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>("ready");
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const batchId = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    invoke<OrbitFile | null>("orbit_context")
      .then(info => { if (mounted) setFile(info); })
      .catch(reason => { if (mounted) setError(String(reason)); })
      .finally(() => { if (mounted) setLoading(false); });

    invoke<string | null>("orbit_preview")
      .then(src => { if (mounted) setPreview(src); })
      .catch(() => { /* Preview failure does not prevent conversion. */ });

    const subscribed = listen<EventPayload>("reformany:conversion", ({ payload }) => {
      if (payload.id !== requestId.current) return;
      if (payload.status === "processing") {
        setPhase("processing");
      } else if (payload.status === "completed") {
        setOutput(payload.outputPath);
        setPhase("completed");
        batchId.current = null;
      } else if (payload.status === "failed" || payload.status === "cancelled") {
        setPhase("failed");
        setError(payload.error ?? (payload.status === "cancelled" ? "Conversion cancelled" : "Conversion failed"));
        batchId.current = null;
      }
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      mounted = false;
      void subscribed.then(unlisten => unlisten());
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  async function close() {
    await getCurrentWindow().close();
  }

  async function convert(target: string) {
    if (!file || file.error || !file.detected || phase === "processing") return;
    const id = crypto.randomUUID();
    requestId.current = id;
    setSelected(target.toUpperCase());
    setPhase("processing");
    setOutput(null);
    setError(null);
    try {
      batchId.current = await invoke<string>("convert_batch", {
        files: [{ id, path: file.path, target, quality: 88, matte: "white" }],
        destination: null,
      });
    } catch (reason) {
      batchId.current = null;
      requestId.current = null;
      setError(String(reason));
      setPhase("failed");
    }
  }

  async function reveal() {
    if (!output) return;
    try {
      await invoke("reveal_output", { path: output });
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function openWorkspace() {
    try { await invoke("orbit_open_workspace"); }
    catch (reason) { setError(String(reason)); }
  }

  async function cancel() {
    if (batchId.current) {
      try { await invoke("cancel_batch", { batchId: batchId.current }); }
      catch (reason) { setError(String(reason)); }
    }
  }

  const canConvert = Boolean(file && file.detected && !file.error && !loading);
  const description = file?.error ?? error ?? (loading ? "Reading file…" : "Select a format to convert");

  return (
    <div className="orbit-frame">
      <section className="orbit-disc" aria-label="ReformANY Orbit quick converter">
        <button type="button" className="orbit-close" aria-label="Close Orbit" onClick={() => void close()}>
          <X size={16} strokeWidth={2} />
        </button>

        <header className="orbit-header">
          <img src="/brand/reformany-mark.jpg" className="orbit-logo" alt="" />
          <span>ReformANY</span><span className="orbit-tag">Orbit</span>
        </header>

        <div className="orbit-file">
          <div className="orbit-thumbnail">
            {preview ? <img src={preview} alt="Selected image preview" /> : <FileImage size={30} strokeWidth={1.6} aria-hidden />}
          </div>
          <strong className="orbit-filename" title={file?.name ?? undefined}>{file?.name ?? (loading ? "Opening file…" : "No file selected")}</strong>
          <span className="orbit-meta">
            {file?.detected ? `${file.detected} · ${formatSize(file.bytes)}` : canConvert ? "" : "Quick conversion"}
          </span>
        </div>

        <div className="orbit-divider" role="presentation" />

        {phase === "completed" ? (
          <div className="orbit-result" role="status">
            <div className="orbit-success"><CheckCircle2 size={18} /> Converted</div>
            <span className="orbit-result-name" title={output ?? undefined}>{output?.split(/[\\/]/).pop()}</span>
            <div className="orbit-result-actions">
              <button type="button" onClick={() => void reveal()}><FolderOpen size={15}/> Show file</button>
              <button type="button" onClick={() => { setPhase("ready"); setSelected(null); setError(null); }}><ArrowRight size={15}/> Another format</button>
            </div>
          </div>
        ) : phase === "processing" ? (
          <div className="orbit-working" role="status" aria-live="polite">
            <LoaderCircle size={21} className="orbit-spinner" />
            <strong>Converting to {selected}…</strong>
            <div className="orbit-indeterminate"><span/></div>
            <button type="button" className="orbit-cancel" onClick={() => void cancel()}>Cancel</button>
          </div>
        ) : (
          <div className="orbit-controls">
            <span className="orbit-legend">{canConvert ? "QUICK CONVERT" : "FILE SUPPORT"}</span>
            {canConvert ? (
              <div className="orbit-options">
                {formats.map(item => (
                  <button
                    type="button"
                    className="orbit-option"
                    key={item.value}
                    disabled={!canConvert}
                    onClick={() => void convert(item.value)}
                    aria-label={`Convert to ${item.label}`}
                  >
                    <span>{item.label}</span><ArrowRight size={12} aria-hidden />
                  </button>
                ))}
              </div>
            ) : (
              <div className="orbit-unavailable" role="status">{description}</div>
            )}
            {phase === "failed" && error && <span className="orbit-error" role="alert">{error}</span>}
          </div>
        )}

        <footer className="orbit-footer">
          <span className="orbit-footnote"><Check size={12}/> Local conversion</span>
          <button type="button" className="orbit-open-app" onClick={() => void openWorkspace()}>
            Full app <ArrowRight size={13}/>
          </button>
        </footer>
      </section>
    </div>
  );
}
