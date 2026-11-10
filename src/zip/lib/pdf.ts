import type { PDFDocumentProxy } from "pdfjs-dist";

type PdfJs = typeof import("pdfjs-dist");
let lib: Promise<PdfJs> | null = null;

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
  return pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
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
  await doc.destroy();
  return { text: out.join("\n\n\f\n\n"), pages };
}


/**
 * Render every PDF page to an encoded image for the existing offline Rust
 * publishers (PDF -> PNG/JPG and PDF -> layout-preserving DOCX).
 * Bound each document/page to the same limits enforced by native code.
 * Unlike embedded-image extraction, this exports the full visible page.
 */
export async function renderPdfPageImages(file: Blob, target: "png" | "jpg"): Promise<string[]> {
  const document = await openPdf(file);
  try {
    if (document.numPages < 1 || document.numPages > 60) {
      throw new Error("PDF page rendering supports 1–60 pages per operation.");
    }
    const images: string[] = [];
    for (let i = 1; i <= document.numPages; i++) {
      const page = await document.getPage(i);
      const initial = page.getViewport({ scale: 1.5 });
      const pixelBudget = 16_000_000;
      const shrink = Math.min(1, Math.sqrt(pixelBudget / (initial.width * initial.height)));
      const viewport = page.getViewport({ scale: 1.5 * shrink });
      const canvas = window.document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const context = canvas.getContext("2d", { alpha: target === "png" });
      if (!context) throw new Error("Could not initialize PDF page renderer.");
      // JPG has no alpha: render transparent PDFs on white paper.
      if (target === "jpg") {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      try {
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        const mime = target === "png" ? "image/png" : "image/jpeg";
        const encoded = canvas.toDataURL(mime, 0.9).split(",", 2)[1];
        if (!encoded || encoded.length > 20 * 1024 * 1024 * 4 / 3 + 16) {
          throw new Error(`Rendered page ${i} exceeds the 20 MB safety limit.`);
        }
        images.push(encoded);
      } finally {
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }
    }
    return images;
  } finally {
    await document.destroy();
  }
}
