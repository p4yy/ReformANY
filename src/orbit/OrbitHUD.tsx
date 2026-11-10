import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Archive, ArrowLeftRight, Bluetooth, Copy, CopyPlus, FileArchive, FileCode2, FileImage, FileOutput, FileText, Folder, FolderOpen, Image as ImageIcon, Keyboard, LoaderCircle, LockKeyhole, MoreHorizontal, MousePointer2, Music2, Orbit, Pencil, QrCode, RotateCw, Scissors, Sheet, Signature, Split, Stamp, Terminal, Trash2, Video, Wand2, X, type LucideIcon } from 'lucide-react';
import { getDocument } from 'pdfjs-dist';
import type { ActivityItem, OrbitFile, OrbitFileKind, OrbitSection, Preferences, ToastMessage } from '../types';
import { convertImage, createSamplePdf, createZip, downloadBlob, ext, extractPdfText, formatBytes, imagesToPdf, uid } from '../lib/files';
import { FilePicker } from '../components/UI';
import { native as desktop, loadNativeFile, pathOf, runNative, nativeConvertImages, nativeReveal, nativeCopyFile, nativeRename, setSourcePath } from '../native/bridge';
import { listen } from '@tauri-apps/api/event';
import { OrbitDialogRouter, type OrbitDialogKind } from './OrbitDialogs';
import { playOrbitCue } from './sounds';

type Wedge = { id: string; label: string; icon: LucideIcon; danger?: boolean };
const imageConvert: Wedge[] = [
  ['tiff', 'TIFF', FileImage], ['pdf', 'PDF', FileText], ['jpeg', 'JPEG', ImageIcon], ['ico', 'ICO', FileImage], ['tga', 'TGA', FileImage],
  ['webp', 'WebP', ImageIcon], ['bmp', 'BMP', ImageIcon], ['gif', 'GIF', FileImage], ['qoi', 'QOI', FileImage], ['avif', 'AVIF', ImageIcon],
].map(([id, label, icon]) => ({ id: `to-${id}`, label: label as string, icon: icon as LucideIcon }));
const mediaInner: Wedge[] = [['mp4_h265', 'MP4 H.265', Video], ['avi', 'AVI', Video], ['mov', 'MOV', Video], ['webm', 'WebM', Video], ['mkv', 'MKV', Video]].map(([id, label, icon]) => ({ id: `to-${id}`, label: label as string, icon: icon as LucideIcon }));
const mediaOuter: Wedge[] = [
  ['wmv', 'WMV', Video], ['gif', 'GIF', FileImage], ['ac3', 'AC3', Music2], ['mp3', 'MP3', Music2], ['wma', 'WMA', Music2], ['aiff', 'AIFF', Music2],
  ['m4a', 'M4A', Music2], ['opus', 'Opus', Music2], ['wav', 'WAV', Music2], ['ogg', 'OGG', Music2], ['flac', 'FLAC', Music2],
].map(([id, label, icon]) => ({ id: `to-${id}`, label: label as string, icon: icon as LucideIcon }));
const audioOnlyFormats = mediaOuter.filter(wedge => !['to-wmv', 'to-gif'].includes(wedge.id));
const pdfConvert: Wedge[] = [['docx-edit', 'DOCX·Editable', FileText], ['txt', 'TXT', FileText], ['md', 'MD', FileCode2], ['html', 'HTML', FileCode2], ['docx-layout', 'DOCX·Layout', Sheet], ['png', 'PNG', ImageIcon], ['jpg', 'JPG', ImageIcon]].map(([id, label, icon]) => ({ id: `to-${id}`, label: label as string, icon: icon as LucideIcon }));
const folderConvert: Wedge[] = [['zip', 'ZIP', Archive], ['7z', '7Z', FileArchive], ['tar', 'TAR', FileArchive], ['rar', 'RAR', FileArchive]].map(([id, label, icon]) => ({ id: `to-${id}`, label: label as string, icon: icon as LucideIcon }));
const textConvert: Wedge[] = [['txt', 'TXT', FileText], ['md', 'MD', FileCode2], ['pdf', 'PDF', FileText], ['html', 'HTML', FileCode2]].map(([id, label, icon]) => ({ id: `to-${id}`, label: label as string, icon: icon as LucideIcon }));
const standardTools: Wedge[] = [{ id: 'password-zip', label: 'Password ZIP', icon: LockKeyhole }, { id: 'more-tools', label: 'More tools', icon: MoreHorizontal }, { id: 'split-binary', label: 'Split binary file', icon: Split }];
const pdfTools: Wedge[] = [
  { id: 'sign', label: 'Sign', icon: Signature }, { id: 'split-pdf', label: 'Split Pages', icon: Scissors }, { id: 'arrange', label: 'Extract Pages', icon: FileOutput }, { id: 'arrange', label: 'Rotate 90°', icon: RotateCw },
  { id: 'extract-images', label: 'Extract Images', icon: FileImage }, { id: 'pdf-password', label: 'Password', icon: LockKeyhole }, { id: 'arrange', label: 'Arrange Pages', icon: Sheet }, { id: 'watermark', label: 'Watermark', icon: Stamp },
];
const folderTools: Wedge[] = [{ id: 'more-tools', label: 'More tools', icon: MoreHorizontal }, { id: 'password-zip', label: 'Password ZIP', icon: LockKeyhole }];
const fileActions: Wedge[] = [
  { id: 'rename', label: 'Rename', icon: Pencil }, { id: 'copy-path', label: 'Copy path', icon: Copy }, { id: 'terminal', label: 'Terminal', icon: Terminal }, { id: 'hover', label: 'HoveR', icon: QrCode },
  { id: 'show-file', label: 'Show file', icon: FolderOpen }, { id: 'shred', label: 'Shred', icon: Trash2, danger: true }, { id: 'copy-file', label: 'Copy file', icon: CopyPlus }, { id: 'bluetooth', label: 'Bluetooth', icon: Bluetooth },
];
const folderActions: Wedge[] = [{ id: 'rename', label: 'Rename', icon: Pencil }, { id: 'copy-path', label: 'Copy path', icon: Copy }, { id: 'terminal', label: 'Terminal', icon: Terminal }, { id: 'open-folder', label: 'Open folder', icon: FolderOpen }, { id: 'shred', label: 'Shred', icon: Trash2, danger: true }];

const initialSamples: OrbitFile[] = [
  { id: 'sample-image', name: 'hero-camera.png', kind: 'image', size: 84.9 * 1024, path: 'C:\\Users\\Ari\\Pictures\\hero-camera.png', typeLabel: 'Png' },
  { id: 'sample-video', name: 'field-reel.mp4', kind: 'video', size: 1.1 * 1024 * 1024, path: 'C:\\Users\\Ari\\Videos\\field-reel.mp4', typeLabel: 'Video' },
  { id: 'sample-audio', name: 'voice-note.wav', kind: 'audio', size: 2.8 * 1024 * 1024, path: 'C:\\Users\\Ari\\Music\\voice-note.wav', typeLabel: 'Audio' },
  { id: 'sample-pdf', name: 'project-brief.pdf', kind: 'pdf', size: 372.6 * 1024, path: 'C:\\Users\\Ari\\Documents\\project-brief.pdf', typeLabel: 'PDF', pages: 14 },
  { id: 'sample-folder', name: 'Field assets', kind: 'folder', size: 0, path: 'C:\\Users\\Ari\\Desktop\\Field assets', typeLabel: 'Folder' },
  { id: 'sample-text', name: 'release-notes.md', kind: 'text', size: 2140, path: 'C:\\Users\\Ari\\Documents\\release-notes.md', typeLabel: 'Markdown' },
];

function point(radius: number, angle: number) {
  const radians = (angle - 90) * Math.PI / 180;
  return { x: 260 + radius * Math.cos(radians), y: 260 + radius * Math.sin(radians) };
}
function wedgePath(inner: number, outer: number, start: number, end: number) {
  const a = point(outer, start), b = point(outer, end), c = point(inner, end), d = point(inner, start);
  const large = end - start > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${outer} ${outer} 0 ${large} 1 ${b.x} ${b.y} L ${c.x} ${c.y} A ${inner} ${inner} 0 ${large} 0 ${d.x} ${d.y} Z`;
}

function kindFromName(name: string): OrbitFileKind {
  const extension = ext(name);
  if (extension === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'tif', 'tiff', 'ico', 'qoi', 'tga'].includes(extension)) return 'image';
  if (['mp4', 'mov', 'mkv', 'webm', 'avi', 'wmv'].includes(extension)) return 'video';
  if (['mp3', 'wav', 'flac', 'm4a', 'ogg', 'opus', 'aiff', 'wma'].includes(extension)) return 'audio';
  return 'text';
}

interface OrbitProps {
  preferences: Preferences;
  onClose: () => void;
  notify: (title: string, message?: string, tone?: ToastMessage['tone']) => void;
  log: (action: string, detail: string, module: string, status?: ActivityItem['status']) => void;
  native?: boolean;
}

export function OrbitHUD({ preferences, onClose, notify, log, native = false }: OrbitProps) {
  const [samples, setSamples] = useState<OrbitFile[]>(native ? [] : initialSamples); const [file, setFile] = useState<OrbitFile>(native ? { id: 'loading', name: 'Opening selected file…', kind: 'text', size: 0, path: '', typeLabel: 'Loading' } : initialSamples[0]);
  const [section, setSection] = useState<OrbitSection>(preferences.orbitStart); const [closing, setClosing] = useState(false); const [switching, setSwitching] = useState(false);
  const [hovered, setHovered] = useState(''); const [dialog, setDialog] = useState<OrbitDialogKind | null>(null); const [busy, setBusy] = useState(false);
  const [pointer, setPointer] = useState({ x: 0, y: 0 }); const [pulse, setPulse] = useState<{ x: number; y: number; id: string } | null>(null);
  const disc = useRef<HTMLDivElement>(null); const shake = useRef({ x: 0, direction: 0, count: 0, started: 0, id: '' });
  useEffect(() => {
    if (native) return;
    let active = true;
    void createSamplePdf(14).then(blob => { if (!active) return; const generated = new File([blob], 'project-brief.pdf', { type: 'application/pdf' }); setSamples(current => current.map(item => item.id === 'sample-pdf' ? { ...item, file: generated, size: blob.size } : item)); setFile(current => current.id === 'sample-pdf' ? { ...current, file: generated, size: blob.size } : current); });
    const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 320; const context = canvas.getContext('2d')!;
    context.fillStyle = '#22281C'; context.fillRect(0, 0, 480, 320); context.strokeStyle = '#8B9D77'; context.lineWidth = 2;
    for (let radius = 34; radius < 230; radius += 28) { context.beginPath(); context.arc(240, 160, radius, 0, Math.PI * 2); context.stroke(); }
    context.fillStyle = '#E1E6D9'; context.font = '22px sans-serif'; context.fillText('REFORMANY / LOCAL', 126, 168);
    canvas.toBlob(blob => { if (!active || !blob) return; const generated = new File([blob], 'hero-camera.png', { type: 'image/png' }); setSamples(current => current.map(item => item.id === 'sample-image' ? { ...item, file: generated, size: blob.size, url: URL.createObjectURL(blob) } : item)); setFile(current => current.id === 'sample-image' ? { ...current, file: generated, size: blob.size, url: URL.createObjectURL(blob) } : current); }, 'image/png');
    const notes = new File(['# ReformANY release notes\n\n- Local image and document tools\n- Precision Orbit HUD\n- Offline QR codes\n\nNo uploads. No analytics.'], 'release-notes.md', { type: 'text/markdown' });
    setSamples(current => current.map(item => item.id === 'sample-text' ? { ...item, file: notes, size: notes.size } : item));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (native && desktop) {
      void runNative<boolean>('orbit_was_shaken', {})
        .then(shaken => { if (!shaken) playOrbitCue(preferences, 'open'); })
        .catch(() => playOrbitCue(preferences, 'open'));
    } else playOrbitCue(preferences, 'open');
  }, []);

  // Use the actual file supplied by the Explorer context command or desktop launcher.
  useEffect(() => {
    if (!native || !desktop) return;
    let valid = true;
    const sync = async () => {
      try {
        const context = await runNative<{ path: string; name: string; bytes: number; detected: string | null; error: string | null } | null>('orbit_context', {});
        if (!context) { notify('Orbit needs a file', 'Select a file or folder in Explorer to launch Orbit.', 'danger'); return; }
        if (context.error) throw new Error(context.error);
        const local = await loadNativeFile(context.path);
        const kind: OrbitFileKind = (local as File & { nativeDirectory?: boolean }).nativeDirectory ? 'folder' : kindFromName(local.name);
        const fresh: OrbitFile = { id: uid(), name: context.name, size: context.bytes, kind,
          typeLabel: context.detected || ext(context.name).toUpperCase(), path: context.path, file: local,
          url: kind === 'image' && local.size < 12 * 1024 * 1024 ? URL.createObjectURL(local) : undefined };
        if (!valid) return;
        setFile(fresh); setSamples([fresh]); setSection(preferences.orbitStart); setSourcePath(local);
      } catch (error) { if (valid) notify('Orbit could not load this file', String(error), 'danger'); }
    };
    void sync();
    let unsubscribe: (() => void) | null = null;
    let deletedListener: (() => void) | null = null;
    void listen('reformany:orbit-context-updated', () => void sync()).then(fn => { if (valid) unsubscribe = fn; else fn(); });
    void listen('reformany:orbit-source-deleted', () => {
      if (!valid) return;
      playOrbitCue(preferences, 'close');
      setClosing(true);
      setTimeout(onClose, 180);
    }).then(fn => { if (valid) deletedListener = fn; else fn(); });
    return () => { valid = false; unsubscribe?.(); deletedListener?.(); };
  }, [native, notify, preferences.orbitStart]);
  // Orbit remains a stable, compact circular native window. Tools open in separate windows.
  const close = () => { if (dialog) { setDialog(null); return; } playOrbitCue(preferences, 'close'); setClosing(true); setTimeout(onClose, 180); };
  const switchSection = (next: OrbitSection) => {
    if (next === section || switching) return; playOrbitCue(preferences, 'switch'); setSwitching(true);
    setTimeout(() => setSection(next), 85); setTimeout(() => setSwitching(false), 205);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (dialog || event.repeat) return;
      const mapping: [string, OrbitSection][] = [[preferences.orbitModifiers.convert, 'convert'], [preferences.orbitModifiers.tools, 'tools'], [preferences.orbitModifiers.actions, 'actions']];
      const match = mapping.find(([modifier]) => event.key === modifier || (modifier === 'Ctrl' && event.key === 'Control'));
      if (match) switchSection(match[1]);
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  const selectFile = (next: OrbitFile) => { if (next.id === file.id) return; setSwitching(true); setTimeout(() => { setFile(next); setSection(preferences.orbitStart); }, 85); setTimeout(() => setSwitching(false), 205); playOrbitCue(preferences, 'switch'); };
  const loadLocal = (files: File[]) => {
    const local = files[0]; if (!local) return; const kind = kindFromName(local.name);
    const item: OrbitFile = { id: uid(), name: local.name, kind, size: local.size, path: pathOf(local) || `Browser sandbox / ${local.name}`, typeLabel: ext(local.name).toUpperCase() || kind, file: local, url: kind === 'image' ? URL.createObjectURL(local) : undefined, pages: kind === 'pdf' ? undefined : undefined };
    setSamples(current => [item, ...current.filter(sample => sample.id !== item.id)]); setFile(item); setSection('convert'); notify('Local file attached to Orbit', 'Its bytes remain in this browser tab. PDF page count is read when a tool opens.', 'success');
  };
  const beginShake = (event: ReactPointerEvent, id: string) => { shake.current = { x: event.clientX, direction: 0, count: 0, started: performance.now(), id }; event.currentTarget.setPointerCapture(event.pointerId); };
  const moveShake = (event: ReactPointerEvent) => {
    setPointer({ x: event.clientX, y: event.clientY }); if (!preferences.holdShake || event.buttons !== 1 || shake.current.id !== (event.currentTarget as HTMLElement).dataset.fileId) return;
    const state = shake.current; const dx = event.clientX - state.x; const threshold = Math.max(4, 15 - preferences.shakeSensitivity * .1); const direction = Math.sign(dx);
    if (Math.abs(dx) > threshold && direction && direction !== state.direction) { state.direction = direction; state.count++; state.x = event.clientX; }
    if (state.count >= 4 && performance.now() - state.started < 1600) { const target = samples.find(item => item.id === state.id); if (target) { selectFile(target); notify('Hold-and-shake recognized', `${target.name} anchored to Orbit.`, 'success'); } state.count = 0; }
  };
  const openDialog = (kind: OrbitDialogKind) => { if (native && desktop) { void runNative<void>('orbit_open_panel', { kind }).catch(error => notify('Could not open tool', String(error), 'danger')); } else setDialog(kind); };
  const pdfImages = async (format: 'png' | 'jpg') => {
    if (!file.file || (native && !(file.file as File & { nativeBytesLoaded?: boolean }).nativeBytesLoaded)) throw new Error('This PDF cannot be read in the local editor (48 MB limit).');
    const pdf = await getDocument({ data: new Uint8Array(await file.file.arrayBuffer()) }).promise; const outputs: File[] = [];
    if (pdf.numPages > 200) throw new Error('PDF has more than 200 pages; page rendering is bounded for reliability.');
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number), viewport = page.getViewport({ scale: 1.5 }), canvas = document.createElement('canvas'); canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport, canvas }).promise;
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Page encoding failed.')), format === 'jpg' ? 'image/jpeg' : 'image/png', .9));
      outputs.push(new File([blob], `${file.name.replace(/\.pdf$/i, '')}-page-${number}.${format}`));
    }
    return outputs.length === 1 ? await downloadBlob(outputs[0], outputs[0].name) : await downloadBlob(await createZip(outputs, 0), `${file.name.replace(/\.pdf$/i, '')}-${format}-pages.zip`);
  };
  /** Actual PDF page images for the native layout-preserving DOCX writer.
   * Keep the browser-side workload capped to protect the native window. */
  const pdfLayoutPageImages = async (): Promise<string[]> => {
    if (!file.file || (native && !(file.file as File & { nativeBytesLoaded?: boolean }).nativeBytesLoaded))
      throw new Error('This PDF cannot be rendered locally (48 MB editor limit).');
    const pdfDocument = await getDocument({ data: new Uint8Array(await file.file.arrayBuffer()) }).promise;
    if (pdfDocument.numPages < 1 || pdfDocument.numPages > 60)
      throw new Error('Layout DOCX supports 1 to 60 pages.');
    const images: string[] = [];
    let bytes = 0;
    for (let number = 1; number <= pdfDocument.numPages; number++) {
      const page = await pdfDocument.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(1.35, Math.sqrt(4_000_000 / (base.width * base.height)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport, canvas }).promise;
      const encoded = canvas.toDataURL('image/png').split(',')[1] || '';
      canvas.width = 0;
      canvas.height = 0;
      if (!encoded || encoded.length > 20 * 1024 * 1024 * 4 / 3)
        throw new Error('A rendered PDF page is too large for the native DOCX writer.');
      bytes += encoded.length;
      if (bytes > 120 * 1024 * 1024)
        throw new Error('Rendered page images exceed the memory-safe export limit.');
      images.push(encoded);
    }
    return images;
  };
  const convert = async (target: string) => {
    if (native && desktop) {
      const source = file.path;
      if (!pathOf(file.file)) throw new Error('This file does not have a verified local source.');
      let output = '';
      if (file.kind === 'image' && target !== 'pdf') {
        const results: string[] = [];
        const result = await nativeConvertImages([{ id: uid(), path: source }], { target, quality: 86, matte: 'white', rotation: 0, grayscale: false }, event => { if (event.outputPath) results.push(event.outputPath); if (event.error) notify('Conversion error', event.error, 'danger'); });
        if (result.failed || !results.length) throw new Error('Image conversion did not create an output.'); output = results[0];
      } else if (file.kind === 'image' && target === 'pdf') {
        output = await runNative<string>('images_to_pdf', { paths: [source], destination: null });
      } else if (file.kind === 'video' || file.kind === 'audio') {
        output = await runNative<string>('media_convert', { job: { path: source, target, destination: null, profile: 'high', startSeconds: null, durationSeconds: null } });
      } else if (file.kind === 'folder') {
        const result = await runNative<{ outputPaths: string[] }>('archive_create', { job: { paths: [source], destination: null, name: file.name, format: target, password: null, splitMegabytes: null, level: 5 } });
        output = result.outputPaths[0] || '';
      } else if (file.kind === 'pdf' && target === 'docx-edit') {
        output = await runNative<string>('pdf_docx_editable', { path: source, destination: null });
      } else if (file.kind === 'pdf' && target === 'docx-layout') {
        const images = await pdfLayoutPageImages();
        output = await runNative<string>('pdf_docx_layout', { path: source, images, destination: null });
      } else if (file.kind === 'pdf' && ['txt', 'md', 'html'].includes(target)) {
        output = await runNative<string>('pdf_to_text_format', { path: source, target, destination: null });
      } else if (file.kind === 'pdf' && ['png', 'jpg'].includes(target)) { output = await pdfImages(target as 'png' | 'jpg') || 'PDF pages exported'; }
      else if (file.kind === 'text' && target === 'pdf') {
        output = await runNative<string>('ebook_convert_file', { job: { path: source, target: 'pdf', destination: null } });
      }
      else if (file.kind === 'text' && ['txt', 'md', 'html'].includes(target)) {
        if (!file.file || file.file.size > 48 * 1024 * 1024) throw new Error('Text source exceeds the local editor limit.');
        const value = await file.file.text();
        const content = target === 'html' ? `<!doctype html><meta charset="utf-8"><pre>${value.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>` : value;
        output = await downloadBlob(new Blob([content], { type: 'text/plain' }), `${file.name.replace(/\.[^.]+$/, '')}.${target}`) || 'Text exported';
      } else throw new Error(`${target.toUpperCase()} is not supported for this input by the installed local engines.`);
      if (!output) throw new Error('No output was created.');
      log('Orbit conversion complete', `${file.name} → ${output}`, 'Orbit');
      notify('Orbit conversion complete', output, 'success');
      return;
    }
    if (file.kind === 'image') {
      if (!file.file) throw new Error('Choose a local image first.');
      if (target === 'pdf') { const blob = await imagesToPdf([file.file]); await downloadBlob(blob, `${file.name.replace(/\.[^.]+$/, '')}.pdf`); }
      else { const result = await convertImage(file.file, { format: target, quality: 86, background: 'Transparent', maxEdge: 0, rotate: 0, grayscale: false }); await downloadBlob(result.blob, result.name); }
    } else if (file.kind === 'pdf') {
      if (target === 'png' || target === 'jpg') await pdfImages(target);
      else if (['txt', 'md', 'html'].includes(target)) {
        if (!file.file) throw new Error('Choose a local PDF first.'); const text = await extractPdfText(file.file);
        const content = target === 'html' ? `<!doctype html><meta charset="utf-8"><title>${file.name}</title><pre style="white-space:pre-wrap;font:16px system-ui">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>` : text;
        await downloadBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), `${file.name.replace(/\.pdf$/i, '')}.${target}`);
      } else throw new Error(`${target.toUpperCase()} export needs LibreOffice or the desktop PDF layout engine.`);
    } else if (file.kind === 'text') {
      if (!file.file) throw new Error('Choose a local text file first.'); const text = await file.file.text();
      if (target === 'pdf') throw new Error('Text → PDF is available from the desktop document engine. Choose TXT, MD or HTML here.');
      const content = target === 'html' ? `<!doctype html><meta charset="utf-8"><pre style="white-space:pre-wrap;font:16px system-ui">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>` : text;
      await downloadBlob(new Blob([content], { type: 'text/plain' }), `${file.name.replace(/\.[^.]+$/, '')}.${target}`);
    } else throw new Error(`${file.kind === 'folder' ? target.toUpperCase() + ' folder archiving' : 'Media encoding'} requires the desktop engine. No conversion was started.`);
    log('Orbit conversion complete', `${file.name} → ${target.toUpperCase()}`, 'Orbit'); notify('Orbit conversion complete', `${target.toUpperCase()} output downloaded locally.`, 'success');
  };
  const runWedge = async (wedge: Wedge, event: React.MouseEvent) => {
    if (native && !pathOf(file.file)) { notify('File not ready', 'Orbit has not loaded an Explorer selection yet.', 'default'); return; }
    setPointer({ x: event.clientX, y: event.clientY });
    const rect = disc.current?.getBoundingClientRect(); if (rect) { setPulse({ x: event.clientX - rect.left, y: event.clientY - rect.top, id: uid() }); setTimeout(() => setPulse(null), 420); }
    if (wedge.id === 'extract-images' && file.kind === 'pdf') {
      setBusy(true);
      try {
        const output = await runNative<{ outputPaths: string[]; skippedUnsupported: number }>(
          'pdf_extract_images', { path: file.path, destination: null });
        if (!output.outputPaths.length) throw new Error('No compatible embedded PDF images were found.');
        notify('Embedded images extracted', output.outputPaths.length + ' files saved · ' + output.outputPaths[0], 'success');
        log('PDF embedded images extracted', output.outputPaths.join(' · '), 'Orbit');
      } catch (error) { notify('PDF image extraction failed', String(error), 'danger'); }
      finally { setBusy(false); }
      return;
    }
    if (wedge.id === 'hover' && native && desktop) { await runNative<void>('hover_file', { path: file.path }); return; }
    if (['shred', 'rename', 'watermark', 'split-pdf', 'hover', 'arrange', 'password-zip', 'split-binary', 'more-tools', 'sign', 'pdf-password'].includes(wedge.id)) { openDialog(wedge.id as OrbitDialogKind); return; }
    if (wedge.id.startsWith('to-')) { setBusy(true); try { await convert(wedge.id.slice(3)); } catch (error) { notify('Orbit action not completed', error instanceof Error ? error.message : 'Conversion failed.', 'danger'); log('Orbit conversion stopped', error instanceof Error ? error.message : 'Conversion failed', 'Orbit', 'error'); } finally { setBusy(false); } return; }
    if (wedge.id === 'copy-path') { await navigator.clipboard.writeText(file.path); notify('Path copied', file.path, 'success'); return; }
    if (wedge.id === 'copy-file') { if (native && desktop) { const dest = await nativeCopyFile(file.path); if (dest) notify('File copied', dest, 'success'); return; } if (file.file) { await downloadBlob(file.file, `Copy of ${file.name}`); notify('Copy downloaded', 'The source File object was not modified.', 'success'); } else notify('Choose a local file', 'Browser preview items without bytes cannot be copied.', 'danger'); return; }
    if (wedge.id === 'show-file' || wedge.id === 'open-folder') { if (native && desktop) { try { await nativeReveal(file.path); } catch(error) { notify('Explorer could not open', String(error), 'danger'); } return; } notify('Explorer handoff ready', 'The Tauri backend reveals and selects this item in Explorer. Browser sandboxing prevents that OS action here.', 'default'); return; }
    if (wedge.id === 'terminal') { if (native && desktop) { try { await runNative('open_terminal', { path: file.path }); notify('Terminal opened', file.path, 'success'); } catch(error) { notify('Terminal failed', String(error), 'danger'); } return; } notify('Terminal handoff', `Desktop action: start terminal at ${file.path}`, 'default'); return; }
    if (wedge.id === 'bluetooth') { if (native && desktop) { try { const message = await runNative<string>('send_bluetooth', { path: file.path }); notify('Bluetooth', message, 'success'); } catch(error) { notify('Bluetooth failed', String(error), 'danger'); } return; } notify('Windows Bluetooth handoff', 'The desktop build opens the Windows nearby-sharing flow for this file. No browser request was made.', 'default'); return; }
    notify('Operation not available', `${wedge.label} has no verified native handler yet. The source was not modified.`, 'danger');
  };
  const rings = section === 'convert'
    ? file.kind === 'video' ? [{ items: mediaInner, inner: 80, outer: 155, labelRadius: 118 }, { items: mediaOuter, inner: 155, outer: 240, labelRadius: 200 }]
      : file.kind === 'audio' ? [{ items: audioOnlyFormats, inner: 80, outer: 240, labelRadius: 166 }]
      : [{ items: file.kind === 'image' ? imageConvert : file.kind === 'pdf' ? pdfConvert : file.kind === 'folder' ? folderConvert : textConvert, inner: 80, outer: 240, labelRadius: 166 }]
    : section === 'tools' ? [{ items: file.kind === 'pdf' ? pdfTools : file.kind === 'folder' ? folderTools : standardTools, inner: 80, outer: 240, labelRadius: 166 }]
      : [{ items: file.kind === 'folder' ? folderActions : fileActions, inner: 80, outer: 240, labelRadius: 166 }];
  let wedgeIndex = 0;
  return <div className={`orbit-os ${native ? 'native' : ''} ${closing ? 'closing' : ''}`} onPointerMove={moveShake} onWheel={event => { if (!preferences.orbitScroll || dialog) return; event.preventDefault(); const order: OrbitSection[] = ['convert', 'tools', 'actions']; const next = order[(order.indexOf(section) + (event.deltaY > 0 ? 1 : 2)) % 3]; switchSection(next); }}>
    <svg className="wallpaper-lines" viewBox="0 0 1440 900" preserveAspectRatio="none" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map(index => <path key={index} d={`M -80 ${160 + index * 100} C 240 ${20 + index * 110}, 420 ${330 + index * 45}, 720 ${170 + index * 85} S 1220 ${40 + index * 120}, 1540 ${210 + index * 80}`} />)}</svg>
    <div className="orbit-preview-label"><Orbit size={17} /><span>ORBIT / TRANSPARENT WINDOW MODEL</span><small>Web preview · desktop uses global hold-and-shake</small></div>
    <button className="orbit-os-close" onClick={close}><X size={16} />Return to ReformANY</button>
    <section className="explorer-mock"><header><div><FolderOpen size={16} /><span>File Explorer</span></div><MinusWindow /></header><div className="explorer-path"><Folder size={14} /><span>This PC</span><b>/</b><span>Desktop</span><b>/</b><strong>Orbit test bench</strong></div><div className="explorer-columns"><span>Name</span><span>Type</span><span>Size</span></div><div className="explorer-files">{samples.slice(0, 6).map(item => { const Icon = item.kind === 'folder' ? Folder : item.kind === 'image' ? ImageIcon : item.kind === 'video' ? Video : item.kind === 'audio' ? Music2 : item.kind === 'pdf' ? FileText : FileCode2; return <button key={item.id} data-file-id={item.id} className={file.id === item.id ? 'active' : ''} onPointerDown={event => beginShake(event, item.id)} onClick={() => selectFile(item)}><Icon size={17} /><span>{item.name}</span><small>{item.typeLabel}</small><small>{formatBytes(item.size)}</small></button>; })}</div><footer><MousePointer2 size={14} />Click a file or hold and shake horizontally</footer></section>
    <div className="orbit-harness"><span>CONTEXT HARNESS</span><div>{(['image', 'video', 'pdf', 'folder'] as OrbitFileKind[]).map(kind => <button className={file.kind === kind ? 'active' : ''} key={kind} onClick={() => { const sample = samples.find(item => item.kind === kind); if (sample) selectFile(sample); }}>{kind === 'image' ? <ImageIcon size={14} /> : kind === 'video' ? <Video size={14} /> : kind === 'pdf' ? <FileText size={14} /> : <Folder size={14} />}{kind}</button>)}</div><FilePicker multiple={false} onFiles={loadLocal}><CopyPlus size={14} />Use local file</FilePicker></div>
    <div className={`orbit-composition ${switching ? 'switching' : ''}`}>
      <div className="orbit-disc" ref={disc}>
        <svg className="orbit-wedges" viewBox="0 0 520 520" aria-label={`${section} actions for ${file.name}`}>
          <circle cx="260" cy="260" r="248" className="orbit-disc-base" /><circle cx="260" cy="260" r="247.5" className="orbit-rim" />
          {rings.map((ring, ringIndex) => <g key={`${section}-${file.kind}-${ringIndex}`}>{ring.items.map((wedge, index) => {
            const angle = 360 / ring.items.length, start = index * angle, end = (index + 1) * angle; const currentIndex = wedgeIndex++;
            return <g key={`${wedge.id}-${index}`} className={`orbit-wedge ${wedge.danger ? 'danger' : ''} ${hovered === `${ringIndex}-${index}` ? 'hovered' : ''}`} style={{ '--i': currentIndex } as CSSProperties} role="button" tabIndex={0} aria-label={wedge.label} onMouseEnter={() => { setHovered(`${ringIndex}-${index}`); playOrbitCue(preferences, 'hover'); }} onMouseLeave={() => setHovered('')} onClick={event => void runWedge(wedge, event)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void runWedge(wedge, event as unknown as React.MouseEvent); } }}>
              <path d={wedgePath(ring.inner, ring.outer, start, end)} className="wedge-shape" />
            </g>;
          })}</g>)}
          <circle cx="260" cy="260" r="78" className="hub-outer" /><circle cx="260" cy="260" r="69" className="hub-inner" /><circle cx="260" cy="260" r="57" className="hub-rule" />
        </svg>
        {rings.map((ring, ringIndex) => ring.items.map((wedge, index) => {
          const middle = (index + .5) * 360 / ring.items.length, position = point(ring.labelRadius, middle); const isHovered = hovered === `${ringIndex}-${index}`;
          return <div key={`label-${ringIndex}-${index}`} className={`wedge-label ${ring.items.length <= 3 ? 'large' : ''} ${wedge.danger ? 'danger' : ''} ${isHovered ? 'hovered' : ''}`} style={{ left: `${position.x / 5.2}%`, top: `${position.y / 5.2}%` }}><wedge.icon size={ring.items.length <= 3 ? 24 : 20} strokeWidth={1.5} /><span>{wedge.label}</span></div>;
        }))}
        <div className="orbit-hub"><div className="hub-logo"><img src="/brand/reformany-icon.png" alt="" /><i /></div><strong title={file.name}>{file.name.length > 20 ? `${file.name.slice(0, 18)}…` : file.name}</strong><span>{file.typeLabel || file.kind} · {formatBytes(file.size)}</span><small>Esc · close</small></div>
        {pulse && <span key={pulse.id} className="wedge-click-pulse" style={{ left: pulse.x, top: pulse.y }} />}
      </div>
      <div className="orbit-section-tabs">{(['convert', 'tools', 'actions'] as OrbitSection[]).map(item => <button className={section === item ? 'active' : ''} key={item} onClick={() => switchSection(item)}>{item === 'convert' ? <ArrowLeftRight size={14} /> : item === 'tools' ? <Wand2 size={14} /> : <MousePointer2 size={14} />}{item[0].toUpperCase() + item.slice(1)}<kbd>{preferences.orbitModifiers[item]}</kbd></button>)}</div>
      <div className="orbit-file-chip"><span className="status-dot ready" />{file.typeLabel || file.kind} · {formatBytes(file.size)}<i />{section} · {rings.reduce((sum, ring) => sum + ring.items.length, 0)} actions</div>
    </div>
    <div className="orbit-help"><Keyboard size={14} /><span>Scroll to switch</span><i />Shift Convert · Ctrl Tools · Alt Actions</div>
    {busy && preferences.pointerRing && <div className="pointer-loading-ring" style={{ left: pointer.x, top: pointer.y }}><LoaderCircle size={24} /></div>}
    {busy && <div className="orbit-working"><LoaderCircle size={15} />Processing local bytes…</div>}
    {dialog && <OrbitDialogRouter kind={dialog} file={file} onClose={() => setDialog(null)} notify={notify} onRename={async name => { if (native && desktop) { const value = await nativeRename(file.path, name); const fresh = await loadNativeFile(value.path); setSourcePath(fresh); setFile(current => ({ ...current, path: value.path, name: value.name, file: fresh })); setSamples(current => current.map(item => item.id === file.id ? { ...item, path: value.path, name: value.name, file: fresh } : item)); } else { setFile(current => ({ ...current, name })); setSamples(current => current.map(item => item.id === file.id ? { ...item, name } : item)); } }} onShred={() => { setSamples(current => current.filter(item => item.id !== file.id)); if (native) { playOrbitCue(preferences, 'close'); setClosing(true); setTimeout(onClose, 180); } }} />}
  </div>;
}
function MinusWindow() { return <span className="explorer-window-controls"><i /><i /><i /></span>; }
