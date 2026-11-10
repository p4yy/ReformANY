/**
 * Converters that genuinely run in the webview/browser, with no external engine:
 * raster images (canvas), subtitles, delimited/JSON tables, text → HTML/Markdown,
 * binary split/join with SHA-256.
 */

/* ───────────── Images ───────────── */
export const BROWSER_IMAGE_FORMATS = ["png", "jpeg", "webp", "bmp", "ico"];
export const BROWSER_DECODABLE = ["png", "jpg", "jpeg", "webp", "bmp", "gif", "ico", "svg", "avif"];

export interface ImageOptions {
  format: string;
  quality: number;
  background: string | null;
  maxEdge: number | null;
  rotate: number;
  grayscale: boolean;
}

function encodeBmp(d: ImageData): Blob {
  const { width: w, height: h, data } = d;
  const row = (w * 3 + 3) & ~3;
  const size = 54 + row * h;
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  const out = new Uint8Array(buf);
  v.setUint16(0, 0x4d42, true);
  v.setUint32(2, size, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, w, true);
  v.setInt32(22, h, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, row * h, true);
  v.setInt32(38, 2835, true);
  v.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) {
    let o = 54 + (h - 1 - y) * row;
    let i = y * w * 4;
    for (let x = 0; x < w; x++, i += 4) {
      out[o++] = data[i + 2];
      out[o++] = data[i + 1];
      out[o++] = data[i];
    }
  }
  return new Blob([buf], { type: "image/bmp" });
}

function wrapIco(png: Blob, w: number, h: number): Blob {
  const head = new DataView(new ArrayBuffer(22));
  head.setUint16(2, 1, true);
  head.setUint16(4, 1, true);
  head.setUint8(6, w >= 256 ? 0 : w);
  head.setUint8(7, h >= 256 ? 0 : h);
  head.setUint16(10, 1, true);
  head.setUint16(12, 32, true);
  head.setUint32(14, png.size, true);
  head.setUint32(18, 22, true);
  return new Blob([head.buffer, png], { type: "image/x-icon" });
}

export async function convertImage(file: File, o: ImageOptions): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new Error(`${file.name} could not be decoded here`);
    }
    let w = img.naturalWidth || 1024;
    let h = img.naturalHeight || 1024;
    const cap = o.format === "ico" ? Math.min(o.maxEdge ?? 256, 256) : o.maxEdge;
    if (cap && Math.max(w, h) > cap) {
      const k = cap / Math.max(w, h);
      w = Math.max(1, Math.round(w * k));
      h = Math.max(1, Math.round(h * k));
    }
    const quarter = o.rotate % 180 !== 0;
    const canvas = document.createElement("canvas");
    canvas.width = quarter ? h : w;
    canvas.height = quarter ? w : h;
    const ctx = canvas.getContext("2d", { willReadFrequently: o.grayscale || o.format === "bmp" });
    if (!ctx) throw new Error("Canvas is unavailable");
    const opaque = o.format === "jpeg" || o.format === "bmp";
    const bg = o.background ?? (opaque ? "#ffffff" : null);
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.imageSmoothingQuality = "high";
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((o.rotate * Math.PI) / 180);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (o.grayscale) {
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        const y = (p[i] * 0.2126 + p[i + 1] * 0.7152 + p[i + 2] * 0.0722) | 0;
        p[i] = p[i + 1] = p[i + 2] = y;
      }
      ctx.putImageData(d, 0, 0);
    }
    if (o.format === "bmp") return encodeBmp(ctx.getImageData(0, 0, canvas.width, canvas.height));
    const mime = o.format === "jpeg" ? "image/jpeg" : o.format === "webp" ? "image/webp" : "image/png";
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, mime, o.quality / 100));
    if (!blob || blob.type !== mime) throw new Error(`This webview cannot encode ${o.format.toUpperCase()}`);
    return o.format === "ico" ? wrapIco(blob, canvas.width, canvas.height) : blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ───────────── Subtitles ───────────── */
const norm = (s: string) => s.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

export function srtToVtt(src: string): { text: string; cues: number } {
  const out: string[] = [];
  for (const block of norm(src).trim().split(/\n{2,}/)) {
    const lines = block.split("\n");
    const ti = lines.findIndex((l) => l.includes("-->"));
    if (ti < 0) continue;
    const time = lines[ti].replace(
      /(\d{1,2}:\d{2}:\d{2})[,.](\d{1,3})/g,
      (_m, a: string, ms: string) => `${a.padStart(8, "0")}.${ms.padEnd(3, "0")}`,
    );
    out.push([time, ...lines.slice(ti + 1)].join("\n"));
  }
  if (!out.length) throw new Error("No SRT cues were found in this file");
  return { text: `WEBVTT\n\n${out.join("\n\n")}\n`, cues: out.length };
}

export function vttToSrt(src: string): { text: string; cues: number } {
  const stamp = (t: string) => {
    const [hms, ms = "000"] = t.split(".");
    const parts = hms.split(":");
    while (parts.length < 3) parts.unshift("00");
    return `${parts.map((p) => p.padStart(2, "0")).join(":")},${ms.padEnd(3, "0").slice(0, 3)}`;
  };
  const out: string[] = [];
  for (const block of norm(src).trim().split(/\n{2,}/)) {
    const lines = block.split("\n");
    const ti = lines.findIndex((l) => l.includes("-->"));
    if (ti < 0) continue;
    const m = lines[ti].match(/([\d:.]+)\s*-->\s*([\d:.]+)/);
    if (!m) continue;
    const text = lines
      .slice(ti + 1)
      .map((l) => l.replace(/<\/?(?:c|v|i|b|u|lang|ruby|rt)(?:[.\s][^>]*)?>/g, (tag) => (/^<\/?[ibu]>$/.test(tag) ? tag : "")).replace(/<\d{2}:\d{2}[:.\d]*>/g, ""))
      .join("\n");
    out.push(`${out.length + 1}\n${stamp(m[1])} --> ${stamp(m[2])}\n${text}`);
  }
  if (!out.length) throw new Error("No WebVTT cues were found in this file");
  return { text: `${out.join("\n\n")}\n`, cues: out.length };
}

/* ───────────── Tables ───────────── */
export type Table = string[][];
export const SHEET_LIMITS = { rows: 50_000, cols: 128, bytes: 24 * 1024 * 1024 };

export function parseDelimited(text: string, delim: string): Table {
  const rows: Table = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const cellStr = (v: unknown) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

export function jsonToTable(text: string): Table {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("JSON must be an array of rows or objects");
  if (data.every((r) => Array.isArray(r))) return (data as unknown[][]).map((r) => r.map(cellStr));
  const keys: string[] = [];
  for (const r of data) {
    if (r && typeof r === "object") for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  }
  return [keys, ...(data as Array<Record<string, unknown>>).map((r) => keys.map((k) => cellStr(r?.[k])))];
}

export function writeDelimited(t: Table, delim: string): string {
  const esc = (c: string) => (c.includes('"') || c.includes(delim) || /[\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return `${t.map((r) => r.map(esc).join(delim)).join("\r\n")}\r\n`;
}

export function tableToJson(t: Table): string {
  const [head = [], ...rows] = t;
  const coerce = (v: string): string | number | boolean | null =>
    v === "" ? null : /^-?(0|[1-9]\d*)(\.\d+)?$/.test(v) ? Number(v) : v === "true" ? true : v === "false" ? false : v;
  return JSON.stringify(
    rows.map((r) => Object.fromEntries(head.map((h, i) => [h || `column_${i + 1}`, coerce(r[i] ?? "")]))),
    null,
    2,
  );
}

export function checkLimits(t: Table) {
  if (t.length > SHEET_LIMITS.rows) throw new Error(`${t.length.toLocaleString()} rows exceeds the 50,000 row limit`);
  const widest = t.reduce((m, r) => Math.max(m, r.length), 0);
  if (widest > SHEET_LIMITS.cols) throw new Error(`${widest} columns exceeds the 128 column limit`);
}

/* ───────────── Text ───────────── */
const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function textToHtml(text: string, title: string): string {
  const paras = norm(text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `    <p>${escHtml(p).replace(/\n/g, "<br />\n      ")}</p>`)
    .join("\n");
  return `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>${escHtml(title)}</title>\n    <style>body{max-width:42rem;margin:3rem auto;padding:0 1.25rem;font:1rem/1.65 Georgia,serif;color:#1b2014;background:#fbfcf7}</style>\n  </head>\n  <body>\n${paras}\n  </body>\n</html>\n`;
}

export function textToMarkdown(text: string): string {
  return `${norm(text)
    .split(/\n{2,}/)
    .map((p) =>
      p
        .trim()
        .split("\n")
        .map((l) => l.replace(/([\\`*_{}[\]<>])/g, "\\$1").replace(/^(\s*)([#>+-]|\d+\.)(\s)/, "$1\\$2$3"))
        .join("  \n"),
    )
    .filter(Boolean)
    .join("\n\n")}\n`;
}

/* ───────────── Split / join with SHA-256 ───────────── */
export async function sha256Hex(blob: Blob): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface NamedBlob {
  name: string;
  blob: Blob;
}

export async function splitFile(
  file: File,
  partBytes: number,
  onProgress: (p: number, note?: string) => void,
): Promise<{ parts: NamedBlob[]; manifest: NamedBlob; sha256: string | null }> {
  const count = Math.max(1, Math.ceil(file.size / partBytes));
  if (count > 999) throw new Error("That part size would create more than 999 parts");
  const parts: NamedBlob[] = [];
  for (let i = 0; i < count; i++) {
    parts.push({
      name: `${file.name}.${String(i + 1).padStart(3, "0")}`,
      blob: file.slice(i * partBytes, Math.min(file.size, (i + 1) * partBytes)),
    });
    onProgress(((i + 1) / (count + 1)) * 0.6, `Part ${i + 1} of ${count}`);
  }
  onProgress(0.7, "Hashing source (SHA-256)");
  const sha256 = await sha256Hex(file);
  const manifest = {
    format: "reformany-split/1",
    name: file.name,
    size: file.size,
    sha256,
    partSize: partBytes,
    parts: parts.map((p) => ({ name: p.name, size: p.blob.size })),
  };
  onProgress(1, "Manifest written");
  return {
    parts,
    manifest: {
      name: `${file.name}.manifest.json`,
      blob: new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }),
    },
    sha256,
  };
}

export async function joinParts(
  files: File[],
  onProgress: (p: number, note?: string) => void,
): Promise<NamedBlob & { sha256: string | null; verified: boolean | null }> {
  const manifestFile = files.find((f) => f.name.endsWith(".manifest.json"));
  const parts = files.filter((f) => /\.\d{3}$/.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
  if (!parts.length) throw new Error("Add the numbered parts (.001, .002, …)");
  let expected: string | null = null;
  let name = parts[0].name.replace(/\.\d{3}$/, "");
  if (manifestFile) {
    const m = JSON.parse(await manifestFile.text()) as { sha256?: string; name?: string; parts?: unknown[] };
    expected = m.sha256 ?? null;
    name = m.name ?? name;
    if (Array.isArray(m.parts) && m.parts.length !== parts.length) {
      throw new Error(`The manifest lists ${m.parts.length} parts but ${parts.length} were added`);
    }
  }
  onProgress(0.4, `Joining ${parts.length} parts`);
  const blob = new Blob(parts);
  onProgress(0.7, "Verifying SHA-256");
  const sha256 = await sha256Hex(blob);
  onProgress(1);
  return { name, blob, sha256, verified: expected && sha256 ? expected === sha256 : null };
}
