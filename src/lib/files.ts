import JSZip from 'jszip';
import { native, saveNativeBlob } from '../native/bridge';
import { PDFDocument, degrees, rgb, StandardFonts } from 'pdf-lib';
import QRCode from 'qrcode';
import * as XLSX from 'xlsx';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

export const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export const ext = (name: string) => name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
export const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

export function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function middleEllipsis(value: string, length = 48) {
  if (value.length <= length) return value;
  const side = Math.floor((length - 1) / 2);
  return `${value.slice(0, side)}…${value.slice(-side)}`;
}

export async function downloadBlob(blob: Blob, name: string): Promise<string | null> {
  if (native) return saveNativeBlob(blob, name);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return null;
}

async function savePdfBlob(pdf: PDFDocument) {
  const bytes = await pdf.save();
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: 'application/pdf' });
}

export async function sha256(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export interface ImageSettings {
  format: string;
  quality: number;
  background: string;
  maxEdge: number;
  rotate: number;
  grayscale: boolean;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This image could not be decoded by the browser.')); };
    image.src = url;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (!blob) reject(new Error(`The browser cannot encode ${type}.`));
    else if (type === 'image/avif' && blob.type !== 'image/avif') reject(new Error('AVIF encoding is unavailable in this browser.'));
    else resolve(blob);
  }, type, quality));
}

function encodeBmp(canvas: HTMLCanvasElement) {
  const { width, height } = canvas;
  const pixels = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
  const stride = Math.ceil(width * 3 / 4) * 4;
  const size = 54 + stride * height;
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  view.setUint16(0, 0x4d42, false); view.setUint32(2, size, true); view.setUint32(10, 54, true);
  view.setUint32(14, 40, true); view.setInt32(18, width, true); view.setInt32(22, height, true);
  view.setUint16(26, 1, true); view.setUint16(28, 24, true); view.setUint32(34, stride * height, true);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = ((height - y - 1) * width + x) * 4;
      const target = 54 + y * stride + x * 3;
      view.setUint8(target, pixels[source + 2]); view.setUint8(target + 1, pixels[source + 1]); view.setUint8(target + 2, pixels[source]);
    }
  }
  return new Blob([buffer], { type: 'image/bmp' });
}

function encodeTga(canvas: HTMLCanvasElement) {
  const { width, height } = canvas;
  const pixels = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
  const buffer = new ArrayBuffer(18 + width * height * 4);
  const view = new DataView(buffer);
  view.setUint8(2, 2); view.setUint16(12, width, true); view.setUint16(14, height, true);
  view.setUint8(16, 32); view.setUint8(17, 0x28);
  for (let i = 0; i < width * height; i++) {
    const source = i * 4; const target = 18 + i * 4;
    view.setUint8(target, pixels[source + 2]); view.setUint8(target + 1, pixels[source + 1]);
    view.setUint8(target + 2, pixels[source]); view.setUint8(target + 3, pixels[source + 3]);
  }
  return new Blob([buffer], { type: 'image/x-tga' });
}

async function encodeIco(canvas: HTMLCanvasElement) {
  const source = document.createElement('canvas');
  const scale = Math.min(1, 256 / Math.max(canvas.width, canvas.height));
  source.width = Math.max(1, Math.round(canvas.width * scale));
  source.height = Math.max(1, Math.round(canvas.height * scale));
  source.getContext('2d')!.drawImage(canvas, 0, 0, source.width, source.height);
  const png = new Uint8Array(await (await canvasBlob(source, 'image/png', 1)).arrayBuffer());
  const buffer = new ArrayBuffer(22 + png.length);
  const view = new DataView(buffer);
  view.setUint16(2, 1, true); view.setUint16(4, 1, true);
  view.setUint8(6, source.width === 256 ? 0 : source.width); view.setUint8(7, source.height === 256 ? 0 : source.height);
  view.setUint16(10, 1, true); view.setUint16(12, 32, true); view.setUint32(14, png.length, true); view.setUint32(18, 22, true);
  new Uint8Array(buffer, 22).set(png);
  return new Blob([buffer], { type: 'image/x-icon' });
}

function encodeQoi(canvas: HTMLCanvasElement) {
  const { width, height } = canvas;
  const pixels = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
  const output: number[] = [113, 111, 105, 102,
    width >>> 24 & 255, width >>> 16 & 255, width >>> 8 & 255, width & 255,
    height >>> 24 & 255, height >>> 16 & 255, height >>> 8 & 255, height & 255, 4, 0];
  const index = Array.from({ length: 64 }, () => [0, 0, 0, 0]);
  let previous = [0, 0, 0, 255]; let run = 0;
  for (let p = 0; p < pixels.length; p += 4) {
    const px = [pixels[p], pixels[p + 1], pixels[p + 2], pixels[p + 3]];
    if (px.every((value, i) => value === previous[i])) {
      run++;
      if (run === 62 || p === pixels.length - 4) { output.push(0xc0 | (run - 1)); run = 0; }
    } else {
      if (run) { output.push(0xc0 | (run - 1)); run = 0; }
      const hash = (px[0] * 3 + px[1] * 5 + px[2] * 7 + px[3] * 11) % 64;
      if (index[hash].every((value, i) => value === px[i])) output.push(hash);
      else {
        index[hash] = px;
        const dr = px[0] - previous[0], dg = px[1] - previous[1], db = px[2] - previous[2], da = px[3] - previous[3];
        if (!da && dr >= -2 && dr <= 1 && dg >= -2 && dg <= 1 && db >= -2 && db <= 1) {
          output.push(0x40 | (dr + 2) << 4 | (dg + 2) << 2 | db + 2);
        } else if (!da && dg >= -32 && dg <= 31 && dr - dg >= -8 && dr - dg <= 7 && db - dg >= -8 && db - dg <= 7) {
          output.push(0x80 | dg + 32, (dr - dg + 8) << 4 | db - dg + 8);
        } else if (!da) output.push(0xfe, px[0], px[1], px[2]);
        else output.push(0xff, ...px);
      }
    }
    previous = px;
  }
  output.push(0, 0, 0, 0, 0, 0, 0, 1);
  return new Blob([new Uint8Array(output)], { type: 'image/qoi' });
}

export async function convertImage(file: File, settings: ImageSettings, onProgress?: (value: number) => void) {
  onProgress?.(8);
  const image = await loadImage(file);
  const maxEdge = settings.maxEdge > 0 ? settings.maxEdge : Math.max(image.naturalWidth, image.naturalHeight);
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const quarterTurn = ((settings.rotate % 360) + 360) % 360 === 90 || ((settings.rotate % 360) + 360) % 360 === 270;
  const canvas = document.createElement('canvas');
  canvas.width = quarterTurn ? height : width; canvas.height = quarterTurn ? width : height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  const opaque = ['jpeg', 'jpg', 'bmp'].includes(settings.format) || settings.background !== 'Transparent';
  if (opaque) { context.fillStyle = settings.background === 'Transparent' ? '#F4F3EA' : settings.background; context.fillRect(0, 0, canvas.width, canvas.height); }
  context.translate(canvas.width / 2, canvas.height / 2); context.rotate(settings.rotate * Math.PI / 180);
  context.drawImage(image, -width / 2, -height / 2, width, height); context.setTransform(1, 0, 0, 1, 0, 0);
  if (settings.grayscale) {
    const data = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < data.data.length; i += 4) {
      const gray = data.data[i] * .2126 + data.data[i + 1] * .7152 + data.data[i + 2] * .0722;
      data.data[i] = data.data[i + 1] = data.data[i + 2] = gray;
    }
    context.putImageData(data, 0, 0);
  }
  onProgress?.(54);
  let blob: Blob;
  switch (settings.format) {
    case 'png': blob = await canvasBlob(canvas, 'image/png', 1); break;
    case 'jpeg': case 'jpg': blob = await canvasBlob(canvas, 'image/jpeg', settings.quality / 100); break;
    case 'webp': blob = await canvasBlob(canvas, 'image/webp', settings.quality / 100); break;
    case 'avif': blob = await canvasBlob(canvas, 'image/avif', settings.quality / 100); break;
    case 'bmp': blob = encodeBmp(canvas); break;
    case 'tga': blob = encodeTga(canvas); break;
    case 'ico': blob = await encodeIco(canvas); break;
    case 'qoi': blob = encodeQoi(canvas); break;
    default: throw new Error(`${settings.format.toUpperCase()} encoding requires the desktop image engine.`);
  }
  onProgress?.(100);
  return { blob, name: `${baseName(file.name)}.${settings.format === 'jpeg' ? 'jpg' : settings.format}` };
}

export async function imagesToPdf(files: File[]) {
  const pdf = await PDFDocument.create();
  for (const file of files) {
    let source = file;
    if (!['jpg', 'jpeg', 'png'].includes(ext(file.name))) {
      source = new File([(await convertImage(file, { format: 'png', quality: 90, background: 'Transparent', maxEdge: 0, rotate: 0, grayscale: false })).blob], `${baseName(file.name)}.png`);
    }
    const bytes = await source.arrayBuffer();
    const image = ['jpg', 'jpeg'].includes(ext(source.name)) ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
    const maxWidth = 595, maxHeight = 842;
    const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
    const page = pdf.addPage([image.width * scale, image.height * scale]);
    page.drawImage(image, { x: 0, y: 0, width: image.width * scale, height: image.height * scale });
  }
  return savePdfBlob(pdf);
}

export async function extractPdfText(file: File, onPage?: (page: number, total: number) => void) {
  const pdf = await getDocument({ data: new Uint8Array(await file.arrayBuffer()), enableScripting: false }).promise;
  const sections: string[] = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    onPage?.(number, pdf.numPages);
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    sections.push(`— Page ${number} —\n${content.items.map(item => 'str' in item ? item.str : '').join(' ')}`);
  }
  return sections.join('\n\n');
}

export async function splitPdf(file: File, mode: 'size' | 'count' | 'pages', target: number) {
  const source = await PDFDocument.load(await file.arrayBuffer());
  const total = source.getPageCount();
  const pagesPer = mode === 'pages' ? Math.max(1, target)
    : mode === 'count' ? Math.max(1, Math.ceil(total / Math.max(1, target)))
      : Math.max(1, Math.ceil(total / Math.max(1, Math.ceil(file.size / (target * 1024 * 1024)))));
  const outputs: { name: string; blob: Blob }[] = [];
  for (let start = 0; start < total; start += pagesPer) {
    const pdf = await PDFDocument.create();
    const end = Math.min(total, start + pagesPer);
    const pages = await pdf.copyPages(source, Array.from({ length: end - start }, (_, i) => start + i));
    pages.forEach(page => pdf.addPage(page));
    outputs.push({ name: `${baseName(file.name)}-${String(outputs.length + 1).padStart(2, '0')}.pdf`, blob: await savePdfBlob(pdf) });
  }
  return outputs;
}

export async function watermarkPdf(file: File, options: { text: string; color: string; size: number; rotation: number; opacity: number; x: number; y: number; applyTo: string; currentPage?: number }) {
  const pdf = await PDFDocument.load(await file.arrayBuffer());
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const hex = options.color.replace('#', '');
  const color = rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255);
  const textWidth = font.widthOfTextAtSize(options.text || 'ReformANY', options.size);
  pdf.getPages().forEach((page, index) => {
    if (options.applyTo === 'Current page' && index !== (options.currentPage || 1) - 1) return;
    if (options.applyTo === 'Odd pages' && index % 2) return;
    if (options.applyTo === 'Even pages' && !(index % 2)) return;
    const { width, height } = page.getSize();
    page.drawText(options.text || 'ReformANY', {
      x: width * options.x / 100 - textWidth / 2, y: height * (1 - options.y / 100), size: options.size,
      font, color, opacity: options.opacity / 100, rotate: degrees(-options.rotation),
    });
  });
  return savePdfBlob(pdf);
}

export async function arrangePdf(file: File, pages: { source: number; rotation: number }[]) {
  const source = await PDFDocument.load(await file.arrayBuffer());
  const pdf = await PDFDocument.create();
  for (const item of pages) {
    const [page] = await pdf.copyPages(source, [item.source - 1]);
    page.setRotation(degrees((page.getRotation().angle + item.rotation) % 360));
    pdf.addPage(page);
  }
  return savePdfBlob(pdf);
}

export function convertSubtitles(text: string, output: 'vtt' | 'srt') {
  if (output === 'vtt') {
    const clean = text.replace(/^WEBVTT[^\n]*\n+/i, '').trim();
    return `WEBVTT\n\n${clean.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}\n`;
  }
  return text.replace(/^WEBVTT[^\n]*\n+/i, '').replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '$1,$2').trim() + '\n';
}

export async function convertSpreadsheet(file: File, output: 'xlsx' | 'csv' | 'tsv' | 'json') {
  let workbook: XLSX.WorkBook;
  if (ext(file.name) === 'json') {
    const parsed = JSON.parse(await file.text()) as unknown;
    const sourceRows = Array.isArray(parsed) ? parsed : [parsed];
    const rows = sourceRows.map(row => typeof row === 'object' && row !== null ? row : { value: row });
    workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Data');
  } else workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('The workbook has no readable sheets.');
  const sheet = workbook.Sheets[sheetName];
  if (sheet['!ref']) {
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const rows = range.e.r - range.s.r + 1, columns = range.e.c - range.s.c + 1;
    if (rows > 50000) throw new Error(`This sheet has ${rows.toLocaleString()} rows; the limit is 50,000.`);
    if (columns > 128) throw new Error(`This sheet has ${columns} columns; the limit is 128.`);
  }
  if (output === 'json') {
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    return new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
  }
  if (output === 'csv' || output === 'tsv') {
    return new Blob([XLSX.utils.sheet_to_csv(sheet, { FS: output === 'tsv' ? '\t' : ',' })], { type: 'text/plain;charset=utf-8' });
  }
  const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export async function createZip(files: File[], level: number) {
  const zip = new JSZip();
  files.forEach(file => zip.file((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name, file));
  return zip.generateAsync({ type: 'blob', compression: level ? 'DEFLATE' : 'STORE', compressionOptions: { level: Math.max(1, Math.min(9, level)) } });
}

export async function extractZip(file: File) {
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter(entry => !entry.dir);
  return Promise.all(entries.map(async entry => ({ name: entry.name, blob: await entry.async('blob') })));
}

export async function splitBinary(file: File, partMb: number) {
  const size = Math.max(1, partMb) * 1024 * 1024;
  const parts: { name: string; blob: Blob }[] = [];
  for (let offset = 0, index = 1; offset < file.size; offset += size, index++) {
    parts.push({ name: `${file.name}.${String(index).padStart(3, '0')}`, blob: file.slice(offset, Math.min(file.size, offset + size)) });
  }
  const manifest = { version: 1, originalName: file.name, size: file.size, sha256: await sha256(file), partSize: size, parts: parts.map(part => part.name) };
  return { parts, manifest: new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }), manifestName: `${file.name}.reformany.parts.json` };
}

export async function joinBinary(manifestFile: File, parts: File[]) {
  const manifest = JSON.parse(await manifestFile.text()) as { originalName: string; size: number; sha256: string; parts: string[] };
  const ordered = manifest.parts.map(name => {
    const part = parts.find(file => file.name === name || file.name.endsWith(name));
    if (!part) throw new Error(`Missing part: ${name}`);
    return part;
  });
  const blob = new Blob(ordered);
  if (blob.size !== manifest.size) throw new Error(`Size mismatch: expected ${manifest.size} bytes, received ${blob.size}.`);
  const hash = await sha256(blob);
  if (hash !== manifest.sha256) throw new Error('SHA-256 verification failed. The joined file was not downloaded.');
  return { blob, name: manifest.originalName, hash };
}

export async function generateQrSvg(value: string) {
  return QRCode.toString(value, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#1A1E15', light: '#E1E6D9' } });
}

export async function createSamplePdf(pageCount = 14) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= pageCount; i++) {
    const page = pdf.addPage([420, 594]);
    page.drawText('ReformANY / Field notes', { x: 42, y: 530, size: 22, font: bold, color: rgb(.10, .12, .08) });
    page.drawText(`PAGE ${String(i).padStart(2, '0')}`, { x: 42, y: 492, size: 11, font, color: rgb(.3, .35, .25) });
    const lines = ['Local instruments for practical file work.', 'No upload. No remote processing.', 'This page is generated offline for preview.'];
    lines.forEach((line, lineIndex) => page.drawText(line, { x: 42, y: 430 - lineIndex * 24, size: 11, font, color: rgb(.18, .21, .14) }));
    page.drawRectangle({ x: 42, y: 130, width: 336, height: 180, borderColor: rgb(.55, .62, .46), borderWidth: 1 });
    page.drawText(`${i} / ${pageCount}`, { x: 42, y: 60, size: 10, font, color: rgb(.35, .39, .29) });
  }
  return savePdfBlob(pdf);
}
