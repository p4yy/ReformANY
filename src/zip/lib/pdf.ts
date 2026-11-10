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
