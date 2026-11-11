import { useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AlertTriangle, ArrowRight, Check, ChevronLeft, ChevronsLeft, ChevronsRight, ChevronRight, Download, ExternalLink, File, FileText, GripVertical, LoaderCircle, LocateFixed, LockKeyhole, Minus, Maximize2, Minimize2, MoreHorizontal, Move, Pencil, Pin, PinOff, QrCode, RotateCcw, RotateCw, Save, Scissors, ShieldAlert, Signature, Stamp, Trash2, Undo2, X } from 'lucide-react';
import { getDocument } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { OrbitFile, ToastMessage } from '../types';
import { arrangePdf, createZip, downloadBlob, ext, formatBytes, generateQrSvg, middleEllipsis, splitBinary, splitPdf, watermarkPdf } from '../lib/files';
import { native as desktop, nativeShred, nativeReveal, runNative, pathOf } from '../native/bridge';
import { CopyButton, Field, FileContextRow, IconButton, InlineNote, KineticButton, NumberStepper, ProgressBar, Select, SpringSlider } from '../components/UI';
import { appIcon } from '../brand';

const BrowserFile = globalThis.File;

export type OrbitDialogKind = 'shred' | 'rename' | 'sign' | 'watermark' | 'split-pdf' | 'hover' | 'arrange' | 'extract-pages' | 'password-zip' | 'split-binary' | 'more-tools' | 'pdf-password';
interface DialogProps {
  file: OrbitFile;
  onClose: () => void;
  notify: (title: string, message?: string, tone?: ToastMessage['tone']) => void;
  onRename?: (name: string) => Promise<void> | void;
  onShred?: () => void;
}

export function OrbitDialogFrame({ title, subtitle, icon, file, children, footer, wide = false, brand = 'ReformANY Orbit', onClose, className = '', toolbar }: { title: string; subtitle?: string; icon: ReactNode; file?: OrbitFile; children: ReactNode; footer?: ReactNode; wide?: boolean; brand?: string; onClose: () => void; className?: string; toolbar?: ReactNode }) {
  const [minimized, setMinimized] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const panel = desktop && getCurrentWindow().label.startsWith('orbit-panel-');
  // Keep the maximize/fullscreen icon synchronized with native window state
  // even when the user changes size through Windows itself.
  useEffect(() => {
    if (!panel) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    const windowHandle = getCurrentWindow();
    const sync = () => void Promise.all([windowHandle.isMaximized(), windowHandle.isFullscreen()])
      .then(([maximized, full]) => { if (active) setFullscreen(maximized || full); })
      .catch(() => {});
    sync();
    void windowHandle.onResized(sync)
      .then(dispose => { if (active) unlisten = dispose; else dispose(); })
      .catch(() => {});
    return () => { active = false; unlisten?.(); };
  }, [panel]);
  useEffect(() => {
    if (!panel) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [panel, onClose]);
  const toggleFullscreen = async () => {
    try {
      if (panel) {
        const windowHandle = getCurrentWindow();
        const next = !(await windowHandle.isMaximized());
        if (next) await windowHandle.maximize();
        else await windowHandle.unmaximize();
        setFullscreen(next);
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
        setFullscreen(false);
      } else {
        await document.documentElement.requestFullscreen();
        setFullscreen(true);
      }
    } catch (error) {
      console.error('Orbit fullscreen could not be changed', error);
    }
  };
  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!panel || event.button !== 0 || (event.target as HTMLElement).closest('button,input,select,textarea,a,[role="slider"]')) return;
    void getCurrentWindow().startDragging().catch(() => {});
  };
  if (minimized) return <button className="minimized-orbit-dialog" onClick={() => setMinimized(false)}><OrbitMark /><span>{brand} · {title}</span><MaximizeLabel /></button>;
  return <div className="orbit-dialog-backdrop"><section className={`orbit-dialog ${wide ? 'wide' : ''} ${className}`} role="dialog" aria-modal="true" aria-label={title}>
    <header className="orbit-dialog-titlebar" onPointerDown={startDrag}><div><OrbitMark /><span>{brand}</span></div><div>{toolbar}<IconButton label={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</IconButton><IconButton label="Minimize" onClick={() => { if (panel) void getCurrentWindow().minimize(); else setMinimized(true); }}><Minus size={15} /></IconButton><IconButton label="Close" onClick={onClose}><X size={16} /></IconButton></div></header>
    <div className="orbit-dialog-scroll-region" role="region" aria-label={`${title} panel content; scroll down for more`} tabIndex={0}>
      <div className="orbit-dialog-heading"><div className="muted-icon-chip">{icon}</div><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></div>
      {file && <FileContextRow name={file.name} meta={file.pages ? `${file.pages} pages · ${formatBytes(file.size)}` : `${file.typeLabel || file.kind.toUpperCase()} · ${formatBytes(file.size)}`} />}
      <div className="orbit-dialog-body">{children}</div>
    </div>
    {footer && <footer className="orbit-dialog-footer">{footer}</footer>}
  </section></div>;
}
function OrbitMark() { return <span className="orbit-mark"><img src={appIcon} className="brand-logo" alt="" aria-hidden="true" /></span>; }
function MaximizeLabel() { return <ExternalLink size={14} />; }

export function ShredDialog({ file, onClose, notify, onShred }: DialogProps) {
  const [confirmation, setConfirmation] = useState(''); const [inspection, setInspection] = useState('Inspecting…'); const [working, setWorking] = useState(false);
  useEffect(() => {
    let live = true;
    if (desktop && pathOf(file.file)) {
      void runNative<{ fileCount: number; totalBytes: number; directories: number }>('shred_preview', { path: file.path })
        .then(value => { if (live) setInspection(value.fileCount + ' file(s) · ' + value.directories + ' folder(s) · ' + formatBytes(value.totalBytes) + ' inspected'); })
        .catch(error => { if (live) setInspection('Inspection failed: ' + String(error)); });
    } else {
      setInspection('Desktop selection required for an actual shred inspection.');
    }
    return () => { live = false; };
  }, [file.path, file.file]);
  const shred = async () => {
    setWorking(true);
    try {
      if (desktop && pathOf(file.file)) { await nativeShred(file.path); onShred?.(); notify('Item shredded', 'A single overwrite and deletion completed. Backups or SSD wear-leveling may retain copies.', 'success'); onClose(); }
      else { await new Promise(resolve => setTimeout(resolve, 450)); notify('Desktop filesystem permission required', 'The browser cannot overwrite or permanently delete an arbitrary OS file. Nothing was deleted in this preview.', 'danger'); }
    } catch (error) { notify('Shred failed', error instanceof Error ? error.message : 'The desktop backend rejected the operation.', 'danger'); }
    setWorking(false);
  };
  return <OrbitDialogFrame title="Shred permanently?" icon={<AlertTriangle size={22} />} onClose={onClose} className="shred-dialog" footer={<><KineticButton tone="ghost" onClick={onClose}>Cancel</KineticButton><KineticButton tone="danger" disabled={confirmation !== 'SHRED' || working} onClick={() => void shred()}>{working ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}Shred permanently</KineticButton></>}>
    <FileContextRow name={file.name} meta={inspection} danger /><div className="destructive-copy"><ShieldAlert size={20} /><p>This action attempts one overwrite before permanent deletion. It is <strong>NOT guaranteed secure erasure</strong> on SSDs, USB, cloud-sync or backup systems. There is no Undo.</p></div><InlineNote tone="warning">Shred is limited to 500 files and 1 GB per confirmed operation.</InlineNote><Field label="Type SHRED to confirm"><input autoFocus className="text-input danger-focus" value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder="SHRED" autoComplete="off" /></Field>
  </OrbitDialogFrame>;
}

export function RenameDialog({ file, onClose, onRename, notify }: DialogProps) {
  const [name, setName] = useState(file.name);
  const save = async () => {
    const clean = name.trim();
    if (!clean || /[\\/:*?"<>|]/.test(clean)) { notify('Enter a valid Windows file name', 'Names cannot be empty or contain \\ / : * ? " < > |.', 'danger'); return; }
    try { await onRename?.(clean); notify('File renamed', clean, 'success'); onClose(); } catch(error) { notify('Rename failed', String(error), 'danger'); }
  };
  return <OrbitDialogFrame title="Rename" subtitle="Choose a new file name." icon={<Pencil size={21} />} file={{ ...file, name: file.kind === 'folder' ? 'Folder' : file.name, typeLabel: file.kind === 'folder' ? 'all accessible files included' : file.typeLabel }} onClose={onClose} footer={<><KineticButton tone="ghost" onClick={onClose}>Cancel</KineticButton><KineticButton tone="primary" onClick={() => void save()}><Check size={16} />Save</KineticButton></>}><Field label="New name"><input autoFocus className="text-input" value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void save(); }} /></Field></OrbitDialogFrame>;
}

function usePdf(file?: File) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null); const [error, setError] = useState('');
  useEffect(() => {
    let active = true; let loaded: PDFDocumentProxy | null = null;
    setPdf(null); setError('');
    if (!file || ext(file.name) !== 'pdf') return;
    void file.arrayBuffer().then(data => getDocument({ data: new Uint8Array(data) }).promise).then(document => { if (!active) { void document.destroy(); return; } loaded = document; setPdf(document); }).catch(() => active && setError('PDF preview unavailable'));
    return () => { active = false; if (loaded) void loaded.destroy(); };
  }, [file]);
  return { pdf, error };
}

function PdfPageCanvas({ pdf, page, zoom = 100, className = '' }: { pdf: PDFDocumentProxy | null; page: number; zoom?: number; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let active = true; if (!pdf) return;
    void pdf.getPage(page).then(documentPage => { const viewport = documentPage.getViewport({ scale: zoom / 100 }); const element = canvas.current; if (!element || !active) return; element.width = viewport.width; element.height = viewport.height; return documentPage.render({ canvasContext: element.getContext('2d')!, viewport, canvas: element }).promise; });
    return () => { active = false; };
  }, [pdf, page, zoom]);
  return <canvas ref={canvas} className={`orbit-pdf-canvas ${className}`} />;
}

export function WatermarkDialog({ file, onClose, notify }: DialogProps) {
  const { pdf, error } = usePdf(file.file);
  const [page, setPage] = useState(1); const [zoom, setZoom] = useState(100); const [text, setText] = useState('ReformANY'); const [color, setColor] = useState('#4E8F72');
  const [size, setSize] = useState(36); const [rotation, setRotation] = useState(-35); const [opacity, setOpacity] = useState(25); const [x, setX] = useState(50); const [y, setY] = useState(50); const [applyTo, setApplyTo] = useState('All PDF pages'); const [saving, setSaving] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const pages = pdf?.numPages || file.pages || 1;
  const drag = (event: React.PointerEvent) => {
    if (!viewport.current || event.buttons !== 1) return;
    const rect = viewport.current.getBoundingClientRect(); setX(Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100))); setY(Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100)));
  };
  const save = async () => {
    if (!file.file) { notify('Open a local PDF first', 'Use the Orbit harness to choose a PDF, then watermark it.', 'danger'); return; }
    setSaving(true);
    try {
      if (desktop && pathOf(file.file)) {
        const scope = applyTo === 'All PDF pages' ? null : applyTo === 'Current page' ? String(page) :
          Array.from({ length: pages }, (_, index) => index + 1)
            .filter(n => applyTo === 'Odd pages' ? n % 2 === 1 : n % 2 === 0).join(',');
        if (scope === '') throw new Error('No PDF pages match the selected scope.');
        const saved = await runNative<string>('pdf_add_mark', { path: file.path, destination: null, visualSignature: false,
          mark: { text, color, size: Math.min(108, size), rotation, opacity: opacity / 100,
            x: Math.max(.1, Math.min(.9, x / 100)), y: Math.max(.1, Math.min(.9, y / 100)), pages: scope } });
        notify('Watermarked PDF saved', saved, 'success');
      } else {
        const blob = await watermarkPdf(file.file, { text, color, size, rotation, opacity, x, y, applyTo, currentPage: page });
        await downloadBlob(blob, file.name.replace(/\.pdf$/i, '') + '-watermarked.pdf');
        notify('Watermarked PDF saved', 'A new local PDF was created.', 'success');
      }
      onClose();
    }
    catch (error) { notify('Watermark failed', error instanceof Error ? error.message : 'The PDF could not be processed.', 'danger'); }
    setSaving(false);
  };
  return <OrbitDialogFrame wide title="Watermark PDF" subtitle="Adjust the watermark on the real PDF page. The original remains unchanged." icon={<Stamp size={22} />} file={{ ...file, pages }} onClose={onClose} className="watermark-dialog" footer={<><KineticButton tone="ghost" onClick={onClose}>Cancel</KineticButton><KineticButton tone="primary" disabled={saving || !file.file} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}Save as new PDF</KineticButton></>}>
    <div className="watermark-columns"><section className="watermark-preview"><div className="watermark-preview-toolbar"><IconButton label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /></IconButton><span>{page} / {pages}</span><IconButton label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)}><ChevronRight size={16} /></IconButton><i /><IconButton label="Zoom out" onClick={() => setZoom(Math.max(55, zoom - 10))}><Minus size={15} /></IconButton><button onClick={() => setZoom(100)}>{zoom}%</button><IconButton label="Zoom in" onClick={() => setZoom(Math.min(160, zoom + 10))}><span className="plus-icon">+</span></IconButton></div><div className="watermark-scroll"><div className="watermark-page-wrap" ref={viewport} onPointerMove={drag}>{pdf ? <PdfPageCanvas pdf={pdf} page={page} zoom={zoom} /> : <div className="watermark-page-skeleton">{error || 'Rendering local PDF…'}</div>}<div className="watermark-overlay" onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); drag(event); }} style={{ left: `${x}%`, top: `${y}%`, color, opacity: opacity / 100, fontSize: `${size * zoom / 100}px`, transform: `translate(-50%, -50%) rotate(${rotation}deg)` }}>{text || 'ReformANY'}</div></div></div><p>Drag the mark on the page, or adjust its horizontal and vertical position on the right.</p></section>
      <section className="watermark-settings" role="region" aria-label="Watermark settings; scroll for more controls" tabIndex={0}><Field label="Watermark text"><input className="text-input" value={text} maxLength={80} onChange={event => setText(event.target.value)} /></Field><Field label="Color"><div className="color-picker-bar">{['#4E8F72', '#8B9D77', '#C4886E', '#E1E6D9', '#1A1E15'].map(value => <button aria-label={`Use color ${value}`} className={color === value ? 'active' : ''} key={value} style={{ background: value }} onClick={() => setColor(value)} />)}<input aria-label="Custom watermark color" type="color" value={color} onChange={event => setColor(event.target.value)} /></div></Field><Field label={`Size · ${size} pt`}><SpringSlider label="Watermark size" value={size} onChange={setSize} min={8} max={120} unit=" pt" /></Field><Field label={`Rotation · ${rotation}°`}><SpringSlider label="Watermark rotation" value={rotation} onChange={setRotation} min={-180} max={180} unit="°" /></Field><Field label={`Opacity · ${opacity}%`}><SpringSlider label="Watermark opacity" value={opacity} onChange={setOpacity} min={5} max={100} /></Field><Field label={`Horizontal position · ${Math.round(x)}%`}><SpringSlider label="Horizontal position" value={Math.round(x)} onChange={setX} /></Field><Field label={`Vertical position · ${Math.round(y)}%`}><SpringSlider label="Vertical position" value={Math.round(y)} onChange={setY} /></Field><KineticButton onClick={() => { setSize(36); setRotation(-35); setOpacity(25); setX(50); setY(50); }}><RotateCcw size={15} />Reset size and placement</KineticButton><Field label="Apply to"><Select value={applyTo} onChange={setApplyTo} options={['All PDF pages', 'Current page', 'Odd pages', 'Even pages']} /></Field></section></div>
  </OrbitDialogFrame>;
}

export function SplitPdfDialog({ file, onClose, notify }: DialogProps) {
  const [mode, setMode] = useState<'size' | 'count' | 'pages'>('size'); const [target, setTarget] = useState(5); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(0);
  const run = async () => {
    if (!file.file) { notify('Open a local PDF first', 'The preview harness can load any PDF from this device.', 'danger'); return; }
    setBusy(true); setProgress(20);
    try {
      if (desktop && pathOf(file.file)) {
        const result = await runNative<{ outputPaths: string[]; oversizedPages: number[] }>('pdf_split',
          { path: file.path, destination: null, mode: mode === 'count' ? 'parts' : mode, value: target });
        if (!result.outputPaths.length) throw new Error('The native splitter returned no PDF files.');
        setProgress(100);
        notify('Independent PDFs created', result.outputPaths.length + ' PDF(s) · ' + result.outputPaths[0], 'success');
      } else {
        const outputs = await splitPdf(file.file, mode, target);
        setProgress(75);
        if (outputs.length === 1) await downloadBlob(outputs[0].blob, outputs[0].name);
        else await downloadBlob(await createZip(outputs.map(output => new BrowserFile([output.blob], output.name)), 0), file.name.replace(/\.pdf$/i, '') + '-split.zip');
        setProgress(100);
        notify('Independent PDFs created', outputs.length + ' output(s) downloaded.', 'success');
      }
      onClose();
    }
    catch (error) { notify('Split failed', error instanceof Error ? error.message : 'PDF split failed.', 'danger'); }
    setBusy(false);
  };
  return <OrbitDialogFrame title="Split PDF" subtitle="Create independent PDFs by approximate size, number of parts, or pages per file." icon={<Scissors size={21} />} file={file} onClose={onClose} footer={<><KineticButton tone="ghost" onClick={onClose}>Cancel</KineticButton><KineticButton tone="primary" disabled={busy || !file.file} onClick={() => void run()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Scissors size={16} />}Create PDFs</KineticButton></>}><Field label="Split PDF by"><Select value={mode} onChange={value => setMode(value as typeof mode)} options={[{ value: 'size', label: 'Approximate size MB' }, { value: 'count', label: 'Number of output PDFs' }, { value: 'pages', label: 'Pages per PDF' }]} /></Field><Field label={mode === 'size' ? 'Target size' : mode === 'count' ? 'Number of PDFs' : 'Pages per PDF'}><NumberStepper label="PDF split target" value={target} onChange={setTarget} min={1} max={1000} unit={mode === 'size' ? 'MB' : ''} /></Field>{mode === 'size' && <div className="quick-chips">{[1, 5, 10, 25, 100].map(value => <button className={target === value ? 'active' : ''} key={value} onClick={() => setTarget(value)}>{value} MB</button>)}</div>}{busy && <ProgressBar value={progress} label="Building independent PDF documents" />}</OrbitDialogFrame>;
}

export function HoverDialog({ file, onClose, notify }: DialogProps) {
  const [tab, setTab] = useState<'file' | 'qr'>('file'); const [pinned, setPinned] = useState(false); const [qrText, setQrText] = useState(file.path); const [svg, setSvg] = useState(''); const [text, setText] = useState(''); const [page, setPage] = useState(1); const { pdf } = usePdf(file.file);
  useEffect(() => { if (file.file && ['txt', 'md', 'json', 'csv'].includes(ext(file.name))) void file.file.text().then(setText); }, [file]);
  const generate = async () => { if (!qrText.trim()) { notify('Enter QR content', 'Text, a URL or a local path is required.', 'danger'); return; } try { setSvg(await generateQrSvg(qrText)); } catch { notify('QR generation failed', 'Shorten the content and try again.', 'danger'); } };
  const show = async () => { if (desktop) { try { await nativeReveal(file.path); } catch(error) { notify('Could not reveal file', String(error), 'danger'); } } else notify('Explorer unavailable in browser', 'Open the installed desktop application to reveal local paths.', 'default'); };
  const preview = file.kind === 'image' && (file.url || file.file) ? <img className="hover-image-preview" src={file.url || (file.file ? URL.createObjectURL(file.file) : undefined)} alt={file.name} /> : file.kind === 'pdf' && pdf ? <div className="hover-pdf"><PdfPageCanvas pdf={pdf} page={page} zoom={75} /><div><IconButton label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={15} /></IconButton><span>{page} / {pdf.numPages}</span><IconButton label="Next page" disabled={page >= pdf.numPages} onClick={() => setPage(page + 1)}><ChevronRight size={15} /></IconButton></div></div> : text ? <pre className="hover-text-preview">{text.slice(0, 12000)}</pre> : <div className="hover-generic"><File size={38} /><strong>{file.typeLabel || file.kind}</strong><span>No inline renderer for this container. File metadata and QR tools remain available.</span></div>;
  return <OrbitDialogFrame wide title="HoveR" subtitle="Inspect the source or encode its path—without sending it anywhere." icon={<LocateFixed size={22} />} brand="ReformANY HoveR" onClose={onClose} className={`hover-dialog ${pinned ? 'pinned' : ''}`} toolbar={<IconButton label={pinned ? 'Unpin HoveR' : 'Pin HoveR'} onClick={() => setPinned(!pinned)}>{pinned ? <PinOff size={15} /> : <Pin size={15} />}</IconButton>}>
    <div className="hover-tabs"><button className={tab === 'file' ? 'active' : ''} onClick={() => setTab('file')}><File size={15} />File</button><button className={tab === 'qr' ? 'active' : ''} onClick={() => setTab('qr')}><QrCode size={15} />QR code</button></div>
    {tab === 'file' ? <div className="hover-file-tab"><div className="hover-preview">{preview}</div><div className="hover-file-meta"><h3>{file.name}</h3><span>{formatBytes(file.size)} · {file.typeLabel || file.kind}</span><label>Full path</label><code title={file.path}>{middleEllipsis(file.path, 68)}</code><div><CopyButton value={file.path} label="Copy path" /><KineticButton onClick={() => void show()}><ExternalLink size={15} />Show file</KineticButton></div></div></div> : <div className="qr-tab"><div className="qr-controls"><Field label="Text, URL, or local file path"><textarea className="text-input" value={qrText} onChange={event => setQrText(event.target.value)} rows={4} /></Field><div><KineticButton tone="primary" onClick={() => void generate()}><QrCode size={16} />Generate QR</KineticButton><KineticButton disabled={!svg} onClick={() => void downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), 'reformany-qr.svg')}><Download size={16} />Save SVG</KineticButton></div><InlineNote>A local Windows path is not a file-sharing link. Scanning its QR code does not transfer the file.</InlineNote></div><div className="qr-preview">{svg ? <><div className="qr-code" dangerouslySetInnerHTML={{ __html: svg }} /><span><Check size={14} />QR code generated offline</span></> : <><QrCode size={36} /><p>Generate a QR code to preview it here</p></>}</div>{svg && <div className="qr-generated-actions"><CopyButton value={file.path} label="Copy path" /><KineticButton onClick={() => void show()}><ExternalLink size={15} />Show file</KineticButton></div>}</div>}
  </OrbitDialogFrame>;
}

type PageItem = { id: string; source: number; rotation: number };

function LazyPageReference({ pdf, page }: { pdf: PDFDocumentProxy | null; page: number }) {
  const marker = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!pdf) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '180px' });
    if (marker.current) observer.observe(marker.current);
    return () => observer.disconnect();
  }, [pdf]);
  return <div ref={marker} className="extract-page-paper">{pdf && visible ? <PdfPageCanvas pdf={pdf} page={page} zoom={56} /> : <FileText size={30} />}</div>;
}

/** PDF extraction never calls the Arrange Pages editor or silently reorders pages. */
export function ExtractPagesDialog({ file, onClose, notify }: DialogProps) {
  const { pdf, error } = usePdf(file.file);
  const [count, setCount] = useState(file.pages || 0);
  const [range, setRange] = useState('1');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (pdf) setCount(pdf.numPages); }, [pdf]);
  useEffect(() => {
    if (!desktop || !pathOf(file.file)) return;
    let live = true;
    void runNative<number>('pdf_page_count', { path: file.path })
      .then(value => { if (live) setCount(value); })
      .catch(reason => { if (live) notify('PDF page count failed', String(reason), 'danger'); });
    return () => { live = false; };
  }, [file.path]);
  const selected = (() => {
    const pages: number[] = [], seen = new Set<number>();
    for (const part of range.trim().split(',')) {
      const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part.trim());
      if (!match) return null;
      const start = Number(match[1]), end = match[2] ? Number(match[2]) : start;
      if (start < 1 || end < start || end > count) return null;
      for (let number = start; number <= end; number++) {
        if (seen.has(number)) return null;
        pages.push(number); seen.add(number);
      }
    }
    return pages.length && pages.every((value, index) => index === 0 || value > pages[index - 1]) ? pages : null;
  })();
  const toggle = (page: number) => {
    const next = new Set(selected || []);
    if (next.has(page)) next.delete(page); else next.add(page);
    setRange([...next].sort((a, b) => a - b).join(','));
  };
  const save = async () => {
    if (!selected?.length || !file.file) {
      notify('Select valid page ranges', 'Use an ascending page range, such as 1, 3-5, 9.', 'danger'); return;
    }
    setSaving(true);
    try {
      if (desktop && pathOf(file.file)) {
        const output = await runNative<string>('pdf_extract_pages', {
          path: file.path, pages: selected.join(','), destination: null,
        });
        notify('Extracted PDF saved', output, 'success');
      } else {
        const pages = selected.map(source => ({ id: String(source), source, rotation: 0 }));
        await downloadBlob(await arrangePdf(file.file, pages), file.name.replace(/\.pdf$/i, '') + '-extracted.pdf');
        notify('Extracted PDF saved', selected.length + ' page(s); original unchanged.', 'success');
      }
      onClose();
    } catch (reason) { notify('PDF extraction failed', String(reason), 'danger'); }
    finally { setSaving(false); }
  };
  return <OrbitDialogFrame wide title="Extract Pages" subtitle="Select PDF pages or enter a page range. This creates a new document without touching the original." icon={<FileText size={22} />} file={{ ...file, pages: count }} onClose={onClose} className="extract-dialog" footer={<><KineticButton tone="ghost" onClick={onClose}>Cancel</KineticButton><KineticButton tone="primary" disabled={saving || !selected?.length || !file.file} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}Extract {selected?.length || 0} pages</KineticButton></>}>
    <div className="extract-controls"><Field label="Page range"><input className="text-input" aria-label="Page range" placeholder="1,3-5,9" value={range} onChange={event => setRange(event.target.value)} /></Field><div className="extract-summary"><span>{count ? `${count} pages available` : error || 'Reading pages…'}</span><span>{selected ? `${selected.length} selected` : 'Invalid range'}</span></div><div className="extract-actions"><KineticButton tone="ghost" disabled={!count} onClick={() => setRange(`1-${count}`)}>Select all</KineticButton><KineticButton tone="ghost" onClick={() => setRange('')}>Clear</KineticButton></div></div>
    <div className="extract-grid" role="region" aria-label="PDF page references; scroll to view all pages" tabIndex={0}>{Array.from({ length: count }, (_, index) => index + 1).map(page => <button type="button" key={page} className={`extract-page ${selected?.includes(page) ? 'selected' : ''}`} aria-pressed={!!selected?.includes(page)} onClick={() => toggle(page)}><LazyPageReference pdf={pdf} page={page} /><span className="extract-page-number">Page {page}</span></button>)}</div>
    <div className="arrange-helper">Scroll to view every page. Page numbers are crisp labels, independent of thumbnail resolution.</div>
  </OrbitDialogFrame>;
}

function PdfThumbnail({ pdf, item, selected, onSelect, onDragStart, onDrop }: { pdf: PDFDocumentProxy | null; item: PageItem; selected: boolean; onSelect: (event: React.MouseEvent) => void; onDragStart: () => void; onDrop: () => void }) {
  return <button draggable onDragStart={onDragStart} onDragOver={event => event.preventDefault()} onDrop={onDrop} onClick={onSelect} className={`arrange-page ${selected ? 'selected' : ''}`}><div className="arrange-page-paper" style={{ transform: `rotate(${item.rotation}deg)` }}>{pdf ? <LazyPageReference pdf={pdf} page={item.source} /> : <FileText size={28} />}</div><GripVertical size={14} /><span>Page {item.id.split('-')[0]} · source {item.source}</span></button>;
}

export function ArrangeDialog({ file, onClose, notify }: DialogProps) {
  const { pdf } = usePdf(file.file); const [pages, setPages] = useState<PageItem[]>(() => Array.from({ length: file.pages || 14 }, (_, index) => ({ id: `${index + 1}-${Date.now()}`, source: index + 1, rotation: 0 })));
  const [selected, setSelected] = useState<string[]>([]); const [anchor, setAnchor] = useState<string | null>(null); const [undo, setUndo] = useState<PageItem[][]>([]); const [saving, setSaving] = useState(false); const dragged = useRef<string | null>(null);
  useEffect(() => { if (pdf && pages.length !== pdf.numPages) setPages(Array.from({ length: pdf.numPages }, (_, index) => ({ id: `${index + 1}-${Date.now()}`, source: index + 1, rotation: 0 }))); }, [pdf, pages.length]);
  useEffect(() => {
    if (!desktop || !pathOf(file.file)) return;
    let live = true;
    void runNative<number>('pdf_page_count', { path: file.path })
      .then(count => {
        if (live && count > 0) {
          setPages(Array.from({ length: count }, (_, index) =>
            ({ id: String(index + 1) + '-native', source: index + 1, rotation: 0 })));
        }
      }).catch(error => { if (live) notify('PDF page count unavailable', String(error), 'danger'); });
    return () => { live = false; };
  }, [file.path]);
  const snapshot = () => setUndo(current => [...current.slice(-29), pages.map(item => ({ ...item }))]);
  const select = (event: React.MouseEvent, item: PageItem) => {
    if (event.shiftKey && anchor) { const a = pages.findIndex(page => page.id === anchor), b = pages.findIndex(page => page.id === item.id); setSelected(pages.slice(Math.min(a, b), Math.max(a, b) + 1).map(page => page.id)); }
    else if (event.ctrlKey || event.metaKey) { setSelected(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id]); setAnchor(item.id); }
    else { setSelected([item.id]); setAnchor(item.id); }
  };
  const move = (where: 'start' | 'earlier' | 'later' | 'end') => {
    if (!selected.length) return; snapshot();
    setPages(current => {
      const chosen = current.filter(item => selected.includes(item.id)); const rest = current.filter(item => !selected.includes(item.id));
      if (where === 'start') return [...chosen, ...rest]; if (where === 'end') return [...rest, ...chosen];
      const next = [...current]; const direction = where === 'earlier' ? -1 : 1; const indices = chosen.map(item => next.findIndex(page => page.id === item.id)).sort((a, b) => direction === -1 ? a - b : b - a);
      indices.forEach(index => { const target = index + direction; if (target < 0 || target >= next.length || selected.includes(next[target].id)) return; [next[index], next[target]] = [next[target], next[index]]; }); return next;
    });
  };
  const rotate = (amount: number) => { if (!selected.length) return; snapshot(); setPages(current => current.map(item => selected.includes(item.id) ? { ...item, rotation: (item.rotation + amount + 360) % 360 } : item)); };
  const remove = () => { if (!selected.length || pages.length === selected.length) { if (pages.length === selected.length) notify('Keep at least one page', 'A new PDF cannot contain zero pages.', 'danger'); return; } snapshot(); setPages(current => current.filter(item => !selected.includes(item.id))); setSelected([]); };
  const drop = (target: string) => { if (!dragged.current || dragged.current === target) return; snapshot(); setPages(current => { const next = [...current]; const from = next.findIndex(item => item.id === dragged.current); const to = next.findIndex(item => item.id === target); const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; }); };
  const save = async () => {
    if (!file.file) {
      notify('Open a local PDF first', 'The arrange editor needs a readable PDF source.', 'danger');
      return;
    }
    setSaving(true);
    try {
      if (desktop && pathOf(file.file)) {
        const saved = await runNative<string>('pdf_arrange_pages', {
          path: file.path, destination: null,
          items: pages.map(item => ({ sourcePage: item.source, rotation: item.rotation })),
        });
        notify('Arranged PDF saved', saved, 'success');
      } else {
        const blob = await arrangePdf(file.file, pages);
        await downloadBlob(blob, file.name.replace(/\.pdf$/i, '') + '-arranged.pdf');
        notify('Arranged PDF saved', pages.length + ' pages · source unchanged', 'success');
      }
      onClose();
    } catch (error) {
      notify('Could not save PDF', error instanceof Error ? error.message : 'PDF export failed.', 'danger');
    } finally { setSaving(false); }
  };
  const tools = [
    { label: 'Start', icon: ChevronsLeft, action: () => move('start') }, { label: 'Earlier', icon: ChevronLeft, action: () => move('earlier') },
    { label: 'Later', icon: ChevronRight, action: () => move('later') }, { label: 'End', icon: ChevronsRight, action: () => move('end') },
    { label: 'Left', icon: RotateCcw, action: () => rotate(-90) }, { label: 'Right', icon: RotateCw, action: () => rotate(90) },
  ];
  return <OrbitDialogFrame wide brand="Arrange PDF pages" title="Arrange PDF pages" subtitle="Choose pages, drag to reorder, or use the move buttons. Ctrl/Shift selects multiple pages. Save a new PDF without changing the original." icon={<Move size={22} />} file={{ ...file, name: file.name, pages: pages.length }} onClose={onClose} className="arrange-dialog" footer={<><KineticButton tone="ghost" onClick={onClose}>Cancel</KineticButton><KineticButton tone="primary" disabled={saving || !file.file} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}Save as new PDF</KineticButton></>}>
    <div className="arrange-toolbar">{tools.map(tool => <KineticButton tone="ghost" key={tool.label} disabled={!selected.length} onClick={tool.action}><tool.icon size={15} />{tool.label}</KineticButton>)}<KineticButton tone="ghost" disabled={!selected.length} onClick={remove}><Trash2 size={15} />Delete</KineticButton><KineticButton tone="ghost" disabled={!undo.length} onClick={() => { const previous = undo[undo.length - 1]; if (previous) { setPages(previous); setUndo(current => current.slice(0, -1)); } }}><Undo2 size={15} />Undo</KineticButton></div>
    <div className="arrange-grid" role="region" aria-label="PDF pages; scroll to view all pages" tabIndex={0}>{pages.map(item => <PdfThumbnail key={item.id} pdf={pdf} item={item} selected={selected.includes(item.id)} onSelect={event => select(event, item)} onDragStart={() => { dragged.current = item.id; }} onDrop={() => drop(item.id)} />)}</div><div className="arrange-helper">Select thumbnails to use Move, Rotate or Delete. <span>·</span> {undo.length} undo step(s). Adding other PDFs requires the separate merge tool.</div>
  </OrbitDialogFrame>;
}

export function PasswordZipDialog({ file, onClose, notify }: DialogProps) {
  const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      if (desktop && file.path && pathOf(file.file)) {
        const base = file.kind === 'folder' ? file.name : file.name.replace(/\.[^.]+$/, '');
        const result = await runNative<{ outputPaths: string[] }>('archive_create', { job: {
          paths: [file.path], destination: null, name: base, format: 'zip', password: password || null,
          splitMegabytes: null, level: 6,
        } });
        notify('Encrypted ZIP created', result.outputPaths.join(', '), 'success'); onClose();
      } else {
        if (!file.file || password) throw new Error('Password protection requires the desktop 7-Zip engine and real local file.');
        await downloadBlob(await createZip([file.file], 6), `${file.name}.zip`);
        notify('ZIP created', 'Saved locally without password.', 'success'); onClose();
      }
    } catch (error) { notify('ZIP creation failed', String(error), 'danger'); }
    finally { setBusy(false); }
  };
  return <OrbitDialogFrame title="Password ZIP" subtitle="Compress this item, with optional AES-256 protection on desktop." icon={<LockKeyhole size={21} />} file={file} onClose={onClose} footer={<><KineticButton tone="ghost" onClick={onClose}>Cancel</KineticButton><KineticButton tone="primary" disabled={busy} onClick={() => void run()}><LockKeyhole size={16} />Create ZIP</KineticButton></>}><Field label="AES-256 password" hint="leave empty for standard ZIP"><input className="text-input" type="password" value={password} onChange={event => setPassword(event.target.value)} /></Field><InlineNote>Browser ZIP uses standard DEFLATE and does not pretend to encrypt. Password mode is handed to 7-Zip only in the desktop build.</InlineNote></OrbitDialogFrame>;
}

export function SplitBinaryDialog({ file, onClose, notify }: DialogProps) {
  const [size, setSize] = useState(100); const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      if (desktop && pathOf(file.file)) {
        const result = await runNative<{ manifestPath: string; parts: string[] }>('file_split', { path: file.path, destination: null, partMegabytes: size });
        notify('Binary file split', `${result.parts.length} parts · ${result.manifestPath}`, 'success'); onClose();
      } else {
        if (!file.file) throw new Error('Select a readable file.');
        const result = await splitBinary(file.file, size);
        for (const part of result.parts) await downloadBlob(part.blob, part.name);
        await downloadBlob(result.manifest, result.manifestName);
        notify('Binary parts saved', `${result.parts.length} parts and SHA-256 manifest.`, 'success'); onClose();
      }
    } catch (error) { notify('Binary splitting failed', String(error), 'danger'); }
    finally { setBusy(false); }
  };
  return <OrbitDialogFrame title="Split binary file" subtitle="Create numbered chunks and a verifiable join manifest." icon={<Scissors size={21} />} file={file} onClose={onClose} footer={<><KineticButton tone="ghost" onClick={onClose}>Cancel</KineticButton><KineticButton tone="primary" disabled={busy} onClick={() => void run()}><Scissors size={16} />Split file</KineticButton></>}><Field label="Part size"><NumberStepper label="Binary part size" value={size} onChange={setSize} min={1} max={4096} unit="MB" /></Field><InlineNote>Every part is sliced directly from the source Blob. The manifest records order, original size and SHA-256.</InlineNote></OrbitDialogFrame>;
}

export function MoreToolsDialog({ file, onClose, notify }: DialogProps) {
  const [working, setWorking] = useState<string | null>(null);
  const tools = file.kind === 'pdf' ? ['Extract text as HTML', 'Flatten annotations', 'Optimize embedded images', 'Inspect document metadata'] : ['Remove metadata', 'Normalize loudness', 'Contact-sheet export', 'Inspect container streams'];
  const execute = async (tool: string) => {
    if (working) return;
    setWorking(tool);
    try {
      if (tool === 'Inspect document metadata') {
        if (!file.file || (desktop && !pathOf(file.file))) throw new Error('Choose a readable local PDF.');
        const { PDFDocument } = await import('pdf-lib');
        const doc = await PDFDocument.load(await file.file.arrayBuffer());
        const details = [`${doc.getPageCount()} pages`, doc.getTitle() ? `Title: ${doc.getTitle()}` : '', doc.getAuthor() ? `Author: ${doc.getAuthor()}` : ''].filter(Boolean).join(' · ');
        notify('Document metadata', details, 'success'); return;
      }
      if (desktop && pathOf(file.file)) {
        if (tool === 'Extract text as HTML') {
          const output = await runNative<string>('pdf_to_text_format', { path: file.path, target: 'html', destination: null });
          notify('Extracted text saved', output, 'success'); return;
        }
        if (tool === 'Remove metadata' || tool === 'Normalize loudness') {
          if (file.kind !== 'audio' && file.kind !== 'video') throw new Error('An audio or video file is required.');
          const output = await runNative<string>('media_edit', { job: { paths: [file.path], action: tool === 'Remove metadata' ? 'strip-metadata' : 'normalize-audio', destination: null } });
          notify('Media tool complete', output, 'success'); return;
        }
      }
      throw new Error(`${tool} is not implemented by the installed local engines. Your source was not modified.`);
    } catch (error) { notify('Action not completed', String(error), 'danger'); }
    finally { setWorking(null); }
  };
  return <OrbitDialogFrame title="More tools" subtitle="Native operations keep the original file unchanged." icon={<MoreHorizontal size={22} />} file={file} onClose={onClose} footer={<KineticButton tone="ghost" onClick={onClose}>Close</KineticButton>}><div className="more-tools-list">{tools.map((tool, index) => <button key={tool} disabled={working !== null} onClick={() => void execute(tool)}><span>{String(index + 1).padStart(2, '0')}</span><strong>{tool}</strong>{working === tool ? <LoaderCircle size={16} /> : <ArrowRight size={16} />}</button>)}</div></OrbitDialogFrame>;
}


/** Native visual signature (PDF text overlay), not a cryptographic certificate. */
export function SignDialog({ file, onClose, notify }: DialogProps) {
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(30);
  const [x, setX] = useState(65);
  const [y, setY] = useState(78);
  const [saving, setSaving] = useState(false);
  const { pdf, error } = usePdf(file.file);
  const save = async () => {
    if (!desktop || !pathOf(file.file)) { notify('Desktop signing required', 'Choose a local PDF in the installed desktop application.', 'danger'); return; }
    if (!text.trim() || text.length > 96 || !/^[ -~]+$/.test(text)) { notify('Signature text is invalid', 'Use up to 96 visible ASCII characters.', 'danger'); return; }
    setSaving(true);
    try {
      const output = await runNative<string>('pdf_add_mark', {
        path: file.path, destination: null, visualSignature: true,
        mark: { text, color: '#213C2D', size, opacity: 1, rotation: 0,
          x: x / 100, y: y / 100, pages: String(page) },
      });
      notify('Visual signature saved', output, 'success');
      onClose();
    } catch (reason) { notify('PDF signing failed', String(reason), 'danger'); }
    finally { setSaving(false); }
  };
  return <OrbitDialogFrame wide title="Sign PDF" subtitle="Add a visible signature to a new local PDF. This is not a certificate-based digital signature." icon={<Signature size={22} />} file={file} onClose={onClose}
    footer={<><KineticButton tone="ghost" onClick={onClose}>Cancel</KineticButton><KineticButton tone="primary" disabled={saving || !text.trim()} onClick={() => void save()}>{saving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}Save signed copy</KineticButton></>}>
    <div className="watermark-columns">
      <section className="watermark-preview"><div className="watermark-preview-toolbar">
        <IconButton label="Previous page" disabled={page <= 1} onClick={() => setPage(n => Math.max(1, n - 1))}><ChevronLeft size={16}/></IconButton>
        <span>{page} / {pdf?.numPages || '?'}</span>
        <IconButton label="Next page" disabled={pdf ? page >= pdf.numPages : true} onClick={() => setPage(n => n + 1)}><ChevronRight size={16}/></IconButton>
      </div><div className="watermark-scroll"><div className="watermark-page-wrap">
        {pdf ? <PdfPageCanvas pdf={pdf} page={page} zoom={90} /> :
        <div className="watermark-page-skeleton">{error || 'Preparing source preview…'}</div>}
        {pdf && <div className="watermark-overlay" style={{ left: x + '%', top: y + '%', color: '#213C2D', fontSize: size + 'px', opacity: 1, transform: 'translate(-50%, -50%)' }}>{text || 'Your signature'}</div>}
      </div></div></section>
      <section className="watermark-settings" role="region" aria-label="Signature settings; scroll for more controls" tabIndex={0}>
        <Field label="Visual signature"><input className="text-input" value={text} maxLength={96} onChange={event => setText(event.target.value)} placeholder="Type signature text" /></Field>
        <Field label="Text size"><SpringSlider label="Signature size" value={size} onChange={setSize} min={8} max={108} unit=" pt"/></Field>
        <Field label="Horizontal position"><SpringSlider label="Horizontal signature position" value={x} onChange={setX} min={10} max={90} unit="%"/></Field>
        <Field label="Vertical position"><SpringSlider label="Vertical signature position" value={y} onChange={setY} min={10} max={90} unit="%"/></Field>
        <InlineNote>Signing saves a new PDF; the original remains unchanged. For legally verifiable signatures, use a certificate-based signing application.</InlineNote>
      </section>
    </div>
  </OrbitDialogFrame>;
}


export function PdfPasswordDialog({ file, onClose, notify }: DialogProps) {
  const [mode, setMode] = useState<'protect' | 'unlock'>('protect');
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const act = async () => {
    if (!desktop || !pathOf(file.file)) {
      notify('Native PDF tool required', 'Use the installed Windows desktop application.', 'danger');
      return;
    }
    if (mode === 'protect' && password.length < 8) {
      notify('Stronger password required', 'Use at least eight characters to encrypt the PDF.', 'danger');
      return;
    }
    if (!password) { notify('Password required', 'Enter the current PDF owner password.', 'danger'); return; }
    setWorking(true);
    try {
      const saved = await runNative<string>(mode === 'protect' ? 'pdf_protect' : 'pdf_unlock', {
        path: file.path, password, destination: null,
      });
      setPassword('');
      notify(mode === 'protect' ? 'Protected PDF saved' : 'Unlocked PDF saved', saved, 'success');
      onClose();
    } catch (error) { notify('PDF password operation failed', String(error), 'danger'); }
    finally { setWorking(false); }
  };
  return <OrbitDialogFrame title="PDF protection" subtitle="Encrypt with AES-256 or remove protection using the correct owner password." icon={<LockKeyhole size={22}/>} file={file} onClose={onClose}
    footer={<><KineticButton tone="ghost" onClick={onClose}>Cancel</KineticButton>
      <KineticButton tone="primary" disabled={working || password.length === 0} onClick={() => void act()}>
        {working ? <LoaderCircle size={16} className="spin"/> : <Check size={16}/>}
        {mode === 'protect' ? 'Save protected copy' : 'Save unlocked copy'}
      </KineticButton></>}>
    <div className="dialog-form">
      <Field label="Operation">
        <Select value={mode} onChange={value => { setMode(value as 'protect' | 'unlock'); setPassword(''); }}
          options={[{ value: 'protect', label: 'Encrypt PDF' }, { value: 'unlock', label: 'Remove protection' }]} />
      </Field>
      <Field label={mode === 'protect' ? 'New PDF password' : 'Current owner password'}>
        <input type="password" autoComplete="new-password" className="text-input"
          value={password} minLength={mode === 'protect' ? 8 : undefined} maxLength={127}
          onChange={event => setPassword(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && !working) void act(); }}/>
      </Field>
      <InlineNote>Only a new copy is saved. The source file remains unchanged. Passwords are never written to logs or settings.</InlineNote>
    </div>
  </OrbitDialogFrame>;
}

export function OrbitDialogRouter({ kind, ...props }: DialogProps & { kind: OrbitDialogKind }) {
  if (kind === 'shred') return <ShredDialog {...props} />;
  if (kind === 'rename') return <RenameDialog {...props} />;
  if (kind === 'watermark') return <WatermarkDialog {...props} />;
  if (kind === 'sign') return <SignDialog {...props} />;
  if (kind === 'pdf-password') return <PdfPasswordDialog {...props} />;
  if (kind === 'split-pdf') return <SplitPdfDialog {...props} />;
  if (kind === 'hover') return <HoverDialog {...props} />;
  if (kind === 'arrange') return <ArrangeDialog {...props} />;
  if (kind === 'extract-pages') return <ExtractPagesDialog {...props} />;
  if (kind === 'password-zip') return <PasswordZipDialog {...props} />;
  if (kind === 'split-binary') return <SplitBinaryDialog {...props} />;
  return <MoreToolsDialog {...props} />;
}
