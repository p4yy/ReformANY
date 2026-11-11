import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronLeft, ChevronRight, FileSearch, LoaderCircle, Lock, Maximize2, Minimize2, X, ZoomIn, ZoomOut } from "lucide-react";
import { DropZone, type QueueItem } from "../components/DropZone";
import { toast } from "../components/Toasts";
import { PageHeader } from "../components/ui";
import { isTauri } from "../lib/bridge";
import { closePdf, openPdf } from "../lib/pdf";
import { clamp, extOf, formatBytes } from "../lib/util";
import { MB } from "./formats";

type Kind = "pdf" | "text" | "md";
const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3];

async function toFile(item: QueueItem): Promise<File> {
  if (item.file) return item.file;
  if (isTauri && item.path) {
    // Read the verified local file via the existing native bridge. Never use
    // HTTP or asset URL access: the desktop app must remain entirely offline.
    const { loadNativeFile } = await import("../../native/bridge");
    return loadNativeFile(item.path);
  }
  throw new Error("This file is not readable here.");
}

export default function Preview() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [open, setOpen] = useState<{ name: string; size: number; kind: Kind } | null>(null);
  const [text, setText] = useState("");
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const viewer = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);

  const item = items[0];
  useEffect(() => {
    if (!item) return;
    let dead = false;
    const ext = extOf(item.name);
    const kind: Kind = ext === "pdf" ? "pdf" : ext === "md" || ext === "markdown" ? "md" : "text";
    setBusy(true);
    setError(null);
    (async () => {
      const f = await toFile(item);
      let nextDoc: PDFDocumentProxy | null = null;
      let nextText = "";
      if (kind === "pdf") nextDoc = await openPdf(f);
      else nextText = await f.text();
      if (dead) {
        if (nextDoc) void closePdf(nextDoc);
        return;
      }
      if (docRef.current) void closePdf(docRef.current);
      docRef.current = nextDoc;
      setDoc(nextDoc);
      setText(nextText);
      setPage(1);
      setZoom(1);
      setOpen({ name: item.name, size: f.size, kind });
    })()
      .catch((e) => {
        if (dead) return;
        setError(e instanceof Error ? e.message : "This file could not be opened.");
        toast({ tone: "danger", title: "Could not open file", body: item.name });
      })
      .finally(() => !dead && setBusy(false));
    return () => {
      dead = true;
    };
  }, [item]);

  useEffect(() => () => { if (docRef.current) void closePdf(docRef.current); }, []);

  // Render the current PDF page into a fresh canvas, then swap it in.
  useEffect(() => {
    if (!doc || open?.kind !== "pdf") return;
    let dead = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    (async () => {
      const p = await doc.getPage(page);
      if (dead) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = p.getViewport({ scale: zoom * 1.25 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `Page ${page} of ${doc.numPages}`);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const params = { canvas, canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined };
      task = p.render(params as Parameters<typeof p.render>[0]);
      await task.promise;
      if (!dead) host.current?.replaceChildren(canvas);
    })().catch((e: { name?: string }) => {
      if (!dead && e?.name !== "RenderingCancelledException") setError("This page could not be rendered.");
    });
    return () => {
      dead = true;
      task?.cancel();
    };
  }, [doc, page, zoom, open?.kind]);

  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement === viewer.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const pages = doc?.numPages ?? 1;
  const step = (dir: 1 | -1) => {
    const i = ZOOMS.findIndex((z) => z >= zoom - 0.001);
    setZoom(ZOOMS[clamp((i < 0 ? ZOOMS.length - 1 : i) + dir, 0, ZOOMS.length - 1)]);
  };
  const close = () => {
    setItems([]);
    setOpen(null);
    setText("");
    setDoc(null);
    if (docRef.current) void closePdf(docRef.current);
    docRef.current = null;
    setError(null);
  };
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void viewer.current?.requestFullscreen().catch(() => toast({ tone: "warn", title: "Fullscreen was blocked by the browser" }));
  };
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (e.key === "+" || e.key === "=") step(1);
    else if (e.key === "-") step(-1);
    else if (e.key === "0") setZoom(1);
    else if (open?.kind === "pdf" && (e.key === "ArrowRight" || e.key === "PageDown")) setPage((p) => clamp(p + 1, 1, pages));
    else if (open?.kind === "pdf" && (e.key === "ArrowLeft" || e.key === "PageUp")) setPage((p) => clamp(p - 1, 1, pages));
    else return;
    e.preventDefault();
  };

  return (
    <>
      <PageHeader page="preview" lead="Read PDFs, plain text and Markdown without opening another app. Nothing here can change the file." />

      {!open ? (
        <div className="stagger grid gap-3">
          <DropZone items={items} setItems={setItems} accept={["pdf", "txt", "md", "markdown"]} multiple={false} folder={false} maxBytes={150 * MB}
            title="Drop a file to read it" formats="PDF · TXT · MARKDOWN" />
          {busy && (
            <p className="note" role="status">
              <LoaderCircle size={14} className="spin" /> Opening {item?.name}…
            </p>
          )}
          {error && <p className="note is-warn" role="alert">{error}</p>}
        </div>
      ) : (
        <div ref={viewer} className="viewer flex-1" tabIndex={0} onKeyDown={onKey} aria-label={`Preview of ${open.name}`}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface px-3 py-2">
            <span className="tag" data-family="doc">{extOf(open.name)}</span>
            <span className="min-w-0 flex-1 truncate font-semibold" title={open.name}>{open.name}</span>

            {open.kind === "pdf" && (
              <div className="flex items-center gap-1" role="group" aria-label="Page navigation">
                <button type="button" className="btn btn-icon" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  <ChevronLeft size={16} />
                </button>
                <input
                  className="field mono !h-7 !w-12 !px-1 text-center"
                  aria-label="Page number"
                  inputMode="numeric"
                  value={page}
                  onChange={(e) => setPage(clamp(Number(e.target.value.replace(/\D/g, "")) || 1, 1, pages))}
                />
                <span className="mono text-[0.75rem] text-soft">/ {pages}</span>
                <button type="button" className="btn btn-icon" aria-label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                  <ChevronRight size={16} />
                </button>
              </div>
            )}

            <div className="flex items-center gap-1" role="group" aria-label="Zoom">
              <button type="button" className="btn btn-icon" aria-label="Zoom out" disabled={zoom <= ZOOMS[0]} onClick={() => step(-1)}>
                <ZoomOut size={16} />
              </button>
              <button type="button" className="btn btn-quiet btn-sm mono !w-14 !px-0" title="Reset zoom" aria-label={`Zoom ${Math.round(zoom * 100)} percent. Reset.`} onClick={() => setZoom(1)}>
                {Math.round(zoom * 100)}%
              </button>
              <button type="button" className="btn btn-icon" aria-label="Zoom in" disabled={zoom >= ZOOMS[ZOOMS.length - 1]} onClick={() => step(1)}>
                <ZoomIn size={16} />
              </button>
            </div>

            <button type="button" className="btn btn-icon" aria-label={full ? "Exit fullscreen" : "Fullscreen"} aria-pressed={full} onClick={toggleFull}>
              {full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button type="button" className="btn btn-icon" aria-label="Close file" onClick={close}>
              <X size={16} />
            </button>
          </div>

          <div className="viewer-stage">
            {error && <p className="note is-warn m-4" role="alert">{error}</p>}
            {open.kind === "pdf" && <div ref={host} />}
            {open.kind === "text" && (
              <pre className="prose mono whitespace-pre-wrap !max-w-[60rem]" style={{ fontSize: `${zoom * 0.8125}rem` }}>
                {text || "This file is empty."}
              </pre>
            )}
            {open.kind === "md" && (
              <div className="prose" style={{ fontSize: `${zoom * 0.9375}rem` }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line bg-surface px-3 py-1.5 text-[0.75rem] text-soft">
            <Lock size={14} className="text-muted" />
            <span>Read-only · the file on disk is never modified</span>
            <span className="mono ml-auto text-[0.6875rem]">
              {formatBytes(open.size)}
              {open.kind === "pdf" ? ` · ${pages} page${pages === 1 ? "" : "s"}` : ` · ${text.split("\n").length.toLocaleString()} lines`}
            </span>
          </div>
        </div>
      )}

      {!open && !busy && (
        <div className="empty">
          <FileSearch size={24} className="text-muted" />
          <p className="max-w-[46ch] text-pretty">
            Zoom with <span className="kbd">+</span> <span className="kbd">−</span>, turn PDF pages with <span className="kbd">←</span> <span className="kbd">→</span>, and go fullscreen from the toolbar.
          </p>
        </div>
      )}
    </>
  );
}
