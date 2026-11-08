import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ChevronLeft, ChevronRight, FileText, FolderOpen, LoaderCircle, Maximize2, Minus, Plus, ZoomIn } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import localWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import "./document-preview.css";

GlobalWorkerOptions.workerSrc = localWorker;

type Data = { name: string; kind: "pdf" | "text" | "markdown"; bytes: number; content: string };
type PdfDoc = Awaited<ReturnType<typeof getDocument>["promise"]>;
type Task = ReturnType<typeof getDocument>;
interface Props { initialPath?: string | null; }

function toPdfData(value: string): Uint8Array {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i += 1) bytes[i] = decoded.charCodeAt(i);
  return bytes;
}
function size(bytes: number) {
  return bytes > 1048576 ? (bytes / 1048576).toFixed(1) + " MB" :
    bytes > 1024 ? (bytes / 1024).toFixed(0) + " KB" : bytes + " bytes";
}
function isUrlAllowed(href?: string) {
  return Boolean(href && /^https?:\/\//i.test(href));
}
export default function DocumentPreview({ initialPath }: Props) {
  const [path, setPath] = useState<string | null>(initialPath || null);
  const [document, setDocument] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [fitted, setFitted] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PdfDoc | null>(null);
  const taskRef = useRef<Task | null>(null);
  const [containerWidth, setContainerWidth] = useState(850);

  useEffect(() => { if (initialPath) setPath(initialPath); }, [initialPath]);

  async function selectFile() {
    try {
      const chosen = await open({
        directory: false, multiple: false,
        filters: [{ name: "Documents", extensions: ["pdf", "txt", "text", "log", "md", "markdown"] }],
      });
      if (typeof chosen === "string") setPath(chosen);
    } catch (cause) { setMessage(String(cause)); }
  }

  useEffect(() => {
    if (!path || !isTauri()) return;
    let alive = true;
    setLoading(true); setDocument(null); setMessage(null);
    setPageNumber(1); setPageCount(0); setZoom(1); setFitted(true);
    invoke<Data>("document_preview", { path })
      .then(data => { if (alive) setDocument(data); })
      .catch(cause => { if (alive) setMessage(String(cause)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [path]);

  useEffect(() => {
    pdfRef.current = null;
    const value = document;
    if (!value || value.kind !== "pdf") return;
    let active = true;
    setRendering(true);
    const loadingTask = getDocument({
      data: toPdfData(value.content),
      cMapUrl: "/pdfjs/cmaps/",
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      wasmUrl: "/pdfjs/wasm/",
      cMapPacked: true,
      isEvalSupported: false,
      useSystemFonts: true,
      stopAtErrors: false,
    });
    taskRef.current = loadingTask;
    void loadingTask.promise.then(pdf => {
      if (!active) return;
      pdfRef.current = pdf;
      setPageCount(pdf.numPages);
      setMessage(null);
    }).catch(cause => {
      if (active) { setRendering(false); setMessage("PDF could not be rendered: " + String(cause)); }
    });
    return () => {
      active = false;
      pdfRef.current = null;
      if (taskRef.current === loadingTask) taskRef.current = null;
      void loadingTask.destroy();
    };
  }, [document]);

  useEffect(() => {
    const viewer = scrollRef.current;
    if (!viewer || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(entries => {
      const size = entries[0]?.contentRect.width;
      if (size) setContainerWidth(Math.max(300, size));
    });
    observer.observe(viewer);
    return () => observer.disconnect();
  }, [document?.kind]);

  useEffect(() => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !canvas || !pageCount || !document || document.kind !== "pdf") return;
    let active = true;
    let task: ReturnType<Awaited<ReturnType<PdfDoc["getPage"]>>["render"]> | null = null;
    setRendering(true);
    void pdf.getPage(pageNumber).then(page => {
      if (!active) return;
      const unscaled = page.getViewport({ scale: 1 });
      const logicalScale = fitted
        ? Math.max(0.2, (containerWidth - 52) / unscaled.width) * zoom
        : zoom;
      const viewport = page.getViewport({ scale: logicalScale });
      const requestedScale = Math.min(window.devicePixelRatio || 1, 2);
      const maxPixelArea = 18_000_000;
      const safeScale = Math.min(requestedScale,
        Math.sqrt(maxPixelArea / Math.max(1, viewport.width * viewport.height)));
      canvas.width = Math.max(1, Math.floor(viewport.width * safeScale));
      canvas.height = Math.max(1, Math.floor(viewport.height * safeScale));
      canvas.style.width = Math.round(viewport.width) + "px";
      canvas.style.height = Math.round(viewport.height) + "px";
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("Canvas rendering is unavailable");
      task = page.render({
        canvas, canvasContext: ctx, viewport,
        transform: [safeScale, 0, 0, safeScale, 0, 0],
        background: "rgb(255,255,255)",
      });
      return task.promise;
    }).then(() => {
      if (active) { setRendering(false); setMessage(null); }
    }).catch(cause => {
      if (active && (cause as { name?: string })?.name !== "RenderingCancelledException") {
        setRendering(false); setMessage("Unable to render page: " + String(cause));
      }
    });
    return () => {
      active = false;
      task?.cancel();
    };
  }, [document, pageCount, pageNumber, zoom, fitted, containerWidth]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [pageNumber]);

  return <div className="content document-preview-page">
    <div className="preview-heading">
      <div><div className="eyebrow">LOCAL DOCUMENT VIEWER</div>
        <h1>Preview.</h1>
        <p>Read documents as they are. PDF pages retain embedded pictures, tables and original positions.</p>
      </div>
      <button type="button" className="button secondary" onClick={() => void selectFile()}>
        <FolderOpen size={16}/> Open file
      </button>
    </div>
    <div className="preview-surface">
      <header className="preview-toolbar">
        <div className="preview-name">
          <FileText size={18}/><div>
            <strong title={path ?? undefined}>{document?.name ?? (path?.split(/[\\/]/).pop() || "No document selected")}</strong>
            <small>{document ? size(document.bytes) + " · " + document.kind.toUpperCase() : "PDF, TXT and Markdown"}</small>
          </div>
        </div>
        {document?.kind === "pdf" && pageCount > 0 && <div className="preview-pdf-controls" aria-label="PDF page and zoom controls">
          <button aria-label="Previous page" disabled={pageNumber <= 1} onClick={() => setPageNumber(n => Math.max(1, n - 1))}><ChevronLeft size={17}/></button>
          <span className="preview-pagination">{pageNumber} / {pageCount}</span>
          <button aria-label="Next page" disabled={pageNumber >= pageCount} onClick={() => setPageNumber(n => Math.min(pageCount, n + 1))}><ChevronRight size={17}/></button>
          <span className="preview-toolbar-divider"/>
          <button aria-label="Zoom out" disabled={zoom <= .5} onClick={() => setZoom(n => Math.max(.5, Math.round((n - .25) * 100) / 100))}><Minus size={16}/></button>
          <span className="preview-pagination">{Math.round(zoom * 100)}%</span>
          <button aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom(n => Math.min(3, Math.round((n + .25) * 100) / 100))}><Plus size={16}/></button>
          <button title={fitted ? "Show actual size" : "Fit to width"} aria-label="Toggle fit to width" onClick={() => setFitted(v => !v)}>
            {fitted ? <Maximize2 size={16}/> : <ZoomIn size={16}/>}
          </button>
        </div>}
      </header>
      <div className="preview-document-area" ref={scrollRef}>
        {!document && !loading && !message && <div className="preview-empty">
          <FileText size={30}/><strong>Your document, without distractions.</strong>
          <p>Select a PDF, TXT or Markdown file to preview it locally.</p>
          <button className="button primary" onClick={() => void selectFile()}>Choose document</button>
        </div>}
        {(loading || (document?.kind === "pdf" && rendering)) && <div className="preview-loading" role="status">
          <LoaderCircle size={18} className="engine-spin"/> {loading ? "Opening document…" : "Rendering PDF page…"}
        </div>}
        {document?.kind === "pdf" && <div className="preview-pdf-sheet" aria-label={"PDF page " + pageNumber}>
          <canvas ref={canvasRef} role="img" aria-label={"Rendered PDF page " + pageNumber + " of " + pageCount + " including images"}/>
        </div>}
        {document?.kind === "text" && <article className="preview-text-sheet" dir="auto">
          <pre>{document.content}</pre>
        </article>}
        {document?.kind === "markdown" && <article className="preview-markdown-sheet" dir="auto">
          <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml
            components={{
              a: ({ href, children }) => isUrlAllowed(href)
                ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
              img: ({ alt }) => <span className="preview-image-alt">[Image reference: {alt || "image"}]</span>,
            }}>{document.content}</ReactMarkdown>
        </article>}
        {message && <div className="preview-error" role="alert">{message}</div>}
      </div>
      <footer className="preview-footer">
        <span>Read-only · Fully local</span>
        <span>{document?.kind === "pdf" ? "PDF.js page rendering · includes embedded images" : "Clean text layout · original file unchanged"}</span>
      </footer>
    </div>
  </div>;
}
