import type { PDFDocumentProxy } from "pdfjs-dist";

type PdfJs = typeof import("pdfjs-dist");
let lib: Promise<PdfJs> | null = null;
const documentTasks = new WeakMap<PDFDocumentProxy, { destroy: () => Promise<void> }>();

/**
 * pdf.js, loaded on first use. The worker module is attached to the main thread
 * (`globalThis.pdfjsWorker`) so it works from a single-file bundle and inside a
 * Tauri webview without a separate worker asset.
 */
export function loadPdfJs(): Promise<PdfJs> {
  if (!lib) {
    lib = (async () => {
      const [pdfjs, worker] = await Promise.all([
        import("pdfjs-dist/legacy/build/pdf.mjs"),
        import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
      ]);
      (globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = worker;
      return pdfjs as PdfJs;
    })();
  }
  return lib;
}

export async function openPdf(file: Blob): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
  const document = await task.promise;
  documentTasks.set(document, task);
  return document;
}

/** PDF.js 6 moved worker termination from the PDF proxy to the loading task. */
export async function closePdf(document: PDFDocumentProxy): Promise<void> {
  const task = documentTasks.get(document);
  if (task) {
    documentTasks.delete(document);
    await task.destroy();
  } else {
    await document.cleanup();
  }
}

export async function pdfToText(
  file: Blob,
  onProgress: (p: number, note?: string) => void,
): Promise<{ text: string; pages: number }> {
  const doc = await openPdf(file);
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      if ("str" in item) text += item.str + (item.hasEOL ? "\n" : "");
    }
    out.push(text.trim());
    onProgress(i / doc.numPages, `Page ${i} of ${doc.numPages}`);
  }
  const pages = doc.numPages;
  await closePdf(doc);
  return { text: out.join("\n\n\f\n\n"), pages };
}


/**
 * Render an individual PDF page. Canvas buffers are released after each page.
 * Both the legacy layout-DOCX writer and the batched image exporter reuse this.
 */
async function renderPage(document: PDFDocumentProxy, i: number, target: "png" | "jpg"): Promise<string> {
  const page = await document.getPage(i);
  const initial = page.getViewport({ scale: 1.5 });
  const pixelBudget = 16_000_000;
  const shrink = Math.min(1, Math.sqrt(pixelBudget / (initial.width * initial.height)));
  const viewport = page.getViewport({ scale: 1.5 * shrink });
  const canvas = window.document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  try {
    const context = canvas.getContext("2d", { alpha: target === "png" });
    if (!context) throw new Error("Could not initialize PDF page renderer.");
    if (target === "jpg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const mime = target === "png" ? "image/png" : "image/jpeg";
    const encoded = canvas.toDataURL(mime, 0.9).split(",", 2)[1];
    if (!encoded || encoded.length > 20 * 1024 * 1024 * 4 / 3 + 16) {
      throw new Error(`Rendered page ${i} exceeds the 20 MB safety limit.`);
    }
    return encoded;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
  }
}

/** Layout-preserving DOCX remains on its separately defined 60-page policy. */
export async function renderPdfPageImages(file: Blob, target: "png" | "jpg"): Promise<string[]> {
  const document = await openPdf(file);
  try {
    if (document.numPages < 1 || document.numPages > 60) {
      throw new Error("Layout DOCX export supports 1–60 pages per operation.");
    }
    const images: string[] = [];
    for (let i = 1; i <= document.numPages; i++) {
      images.push(await renderPage(document, i, target));
    }
    return images;
  } finally {
    await closePdf(document);
  }
}

/**
 * Stream PDF page renders to the native publisher in small, bounded batches.
 * Does not accumulate hundreds of encoded pages in the WebView and does not
 * silently drop any pages. A failed batch rejects the conversion.
 */
export async function renderPdfPageImageBatches(
  file: Blob,
  target: "png" | "jpg",
  onBatch: (images: string[], startPage: number, totalPages: number) => Promise<void>,
  batchSize = 4,
): Promise<void> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 12) {
    throw new Error("Invalid PDF image batch size.");
  }
  const document = await openPdf(file);
  try {
    if (document.numPages < 1) throw new Error("PDF contains no renderable pages.");
    for (let startPage = 1; startPage <= document.numPages; startPage += batchSize) {
      const images: string[] = [];
      const lastPage = Math.min(startPage + batchSize - 1, document.numPages);
      for (let page = startPage; page <= lastPage; page++) {
        images.push(await renderPage(document, page, target));
      }
      await onBatch(images, startPage, document.numPages);
    }
  } finally {
    await closePdf(document);
  }
}
