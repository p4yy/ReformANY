import { useEffect, useRef, useState } from 'react';
import { BookOpen, Braces, ChevronLeft, ChevronRight, Download, FileText, Fullscreen, Info, LoaderCircle, Plus, Sheet, Split, Type, ZoomIn, ZoomOut } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getDocument } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ConverterProps } from './Converters';
import { EngineLine, FormatChips, ModuleHeader } from './Converters';
import { convertSpreadsheet, convertSubtitles, createSamplePdf, createZip, downloadBlob, ext, extractPdfText, formatBytes, imagesToPdf, splitPdf } from '../lib/files';
import { DropZone, EmptyState, Field, FileContextRow, FilePicker, IconButton, InlineNote, KineticButton, NumberStepper, ProgressBar, Select } from '../components/UI';
import { native, requireNativePath, resolveNativeDestination, runNative, hasOriginalBytes } from '../native/bridge';

function SingleSource({ file, setFile, accept, label }: { file: File | null; setFile: (file: File | null) => void; accept?: string; label: string }) {
  return file ? <div className="selected-source"><FileContextRow name={file.name} meta={`${ext(file.name).toUpperCase()} · ${formatBytes(file.size)}`} /><KineticButton tone="ghost" onClick={() => setFile(null)}>Change source</KineticButton></div> : <FilePicker multiple={false} accept={accept} onFiles={files => setFile(files[0] || null)}><Plus size={16} />{label}</FilePicker>;
}

type DocumentTab = 'images-pdf' | 'pdf-text' | 'txt' | 'office' | 'split';
const documentTabs: { id: DocumentTab; label: string }[] = [
  { id: 'images-pdf', label: 'Images → PDF' }, { id: 'pdf-text', label: 'PDF → Text' },
  { id: 'txt', label: 'TXT → Formats' }, { id: 'office', label: 'Office → PDF' }, { id: 'split', label: 'Split PDF' },
];

export function DocumentsModule(props: ConverterProps) {
  const [tab, setTab] = useState<DocumentTab>('images-pdf');
  const [files, setFiles] = useState<File[]>([]); const [file, setFile] = useState<File | null>(null);
  const [output, setOutput] = useState('md'); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(0);
  const [splitMode, setSplitMode] = useState<'size' | 'count' | 'pages'>('size'); const [target, setTarget] = useState(5);
  const switchTab = (value: DocumentTab) => { setTab(value); setFile(null); setFiles([]); setProgress(0); };
  const run = async () => {
    setBusy(true); setProgress(10);
    try {
      if (native && ['images-pdf', 'pdf-text', 'txt', 'office', 'split'].includes(tab)) {
        let outputPath = '';
        const destination = await resolveNativeDestination(props.preferences.destination);
        if (tab === 'images-pdf') {
          if (!files.length) throw new Error('Add at least one image.');
          outputPath = await runNative<string>('images_to_pdf', { paths: files.map(requireNativePath), destination });
        } else if (tab === 'pdf-text') {
          if (!file) throw new Error('Choose a PDF first.');
          outputPath = await runNative<string>('pdf_to_text_format', { path: requireNativePath(file), target: 'txt', destination });
        } else if (tab === 'txt') {
          if (!file) throw new Error('Choose a TXT source document.');
          const saved = await runNative<string[]>('text_convert', { path: requireNativePath(file), target: output, destination });
          if (!saved.length) throw new Error('Native text conversion did not produce an output.');
          outputPath = saved[0];
          props.log('Text converted', `${file.name} → ${saved.join(' · ')}`, 'Documents');
        } else if (tab === 'split') {
          if (!file) throw new Error('Choose a PDF to split.');
          const result = await runNative<{ outputPaths: string[]; oversizedPages: number[] }>('pdf_split', {
            path: requireNativePath(file), destination,
            mode: splitMode === 'count' ? 'parts' : splitMode, value: target,
          });
          if (!result.outputPaths.length) throw new Error('The native PDF splitter did not produce any output.');
          outputPath = result.outputPaths[0];
          props.log('PDF split', result.outputPaths.length + ' verified PDF parts · ' + result.outputPaths.join(' · '), 'Documents');
          if (result.oversizedPages.length) {
            props.notify('Some pages exceed the target size',
              'Indivisible PDF pages: ' + result.oversizedPages.join(', '), 'default');
          }
        } else {
          if (!file) throw new Error('Choose an Office document first.');
          outputPath = await runNative<string>('office_to_pdf', { path: requireNativePath(file), destination });
        }
        setProgress(100); props.log('Document output saved', outputPath, 'Documents');
        props.notify('Document output ready', `Saved: ${outputPath}`, 'success');
        setBusy(false);
        return;
      }
      if (tab === 'images-pdf') {
        if (!files.length) throw new Error('Add at least one image.');
        const blob = await imagesToPdf(files); await downloadBlob(blob, 'reformany-images.pdf');
        props.log('PDF created', `${files.length} image${files.length === 1 ? '' : 's'} · one page per image`, 'Documents');
      } else if (tab === 'pdf-text') {
        if (!file) throw new Error('Choose a PDF first.');
        const text = await extractPdfText(file, (page, total) => setProgress(Math.round(page / total * 90)));
        await downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${file.name.replace(/\.pdf$/i, '')}.txt`);
        props.log('PDF text extracted', `${file.name} · ${text.length.toLocaleString()} characters`, 'Documents');
      } else if (tab === 'txt') {
        if (!file) throw new Error('Choose a TXT or Markdown file.');
        const text = await file.text(); let blob: Blob;
        if (output === 'html') blob = new Blob([`<!doctype html><html><head><meta charset="utf-8"><title>${file.name}</title><style>body{max-width:720px;margin:48px auto;font:16px/1.7 system-ui;white-space:pre-wrap}</style></head><body>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</body></html>`], { type: 'text/html' });
        else if (output === 'json') blob = new Blob([JSON.stringify({ source: file.name, created: new Date().toISOString(), text }, null, 2)], { type: 'application/json' });
        else blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        await downloadBlob(blob, `${file.name.replace(/\.[^.]+$/, '')}.${output}`); props.log('Text converted', `${file.name} → ${output.toUpperCase()}`, 'Documents');
      } else if (tab === 'office') {
        if (!file) throw new Error('Choose an Office document first.');
        throw new Error('Office → PDF requires LibreOffice in the Tauri desktop build. No output was generated.');
      } else {
        if (!file) throw new Error('Choose a PDF to split.');
        if (!hasOriginalBytes(file)) throw new Error('PDF exceeds the safe 48 MB in-memory editor limit.');
        const outputs = await splitPdf(file, splitMode, target); setProgress(80);
        if (outputs.length === 1) await downloadBlob(outputs[0].blob, outputs[0].name);
        else await downloadBlob(await createZip(outputs.map(item => new File([item.blob], item.name)), 0), `${file.name.replace(/\.pdf$/i, '')}-split.zip`);
        props.log('PDF split', `${outputs.length} independent PDF${outputs.length === 1 ? '' : 's'} · original unchanged`, 'Documents');
      }
      setProgress(100); props.notify('Document output ready', 'Generated locally and downloaded.', 'success');
    } catch (error) { props.notify('Document operation stopped', error instanceof Error ? error.message : 'Unknown error', 'danger'); props.log('Document operation stopped', error instanceof Error ? error.message : 'Unknown error', 'Documents', 'error'); }
    setBusy(false);
  };
  return <div className="module"><ModuleHeader eyebrow="Workspace / Documents" title={<>Documents,<br />without the detour.</>} description="Assemble, extract and divide documents locally. Originals are never overwritten." aside={<div className="engine-line"><span className="status-dot ready" /><strong>PDF tools</strong><span>{native ? 'Native PDF engine ready' : 'Browser editor ready'}</span></div>} />
    <div className="module-tabs document-tabs">{documentTabs.map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => switchTab(item.id)}>{item.label}</button>)}</div>
    <section className="panel document-workbench reveal-item" key={tab}>
      {tab === 'images-pdf' && <><DropZone title="Drop images to build a PDF" subtitle="Each image becomes one fitted page · original order is preserved" accept={['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'svg']} formats={['PNG', 'JPG', 'WEBP', 'BMP', 'SVG']} count={files.length} onFiles={selected => setFiles(current => [...current, ...selected])} />{files.length > 0 && <div className="compact-file-list">{files.map((item, index) => <FileContextRow key={`${item.name}-${index}`} name={`${index + 1}. ${item.name}`} meta={formatBytes(item.size)} />)}</div>}</>}
      {tab === 'pdf-text' && <><SingleSource file={file} setFile={setFile} accept=".pdf" label="Choose PDF" /><InlineNote>Text is extracted page by page with PDF.js. Scanned pages without a text layer need OCR, which is not included.</InlineNote></>}
      {tab === 'txt' && <><SingleSource file={file} setFile={setFile} accept={native ? '.txt' : '.txt,.md,.markdown'} label="Choose text document" /><Field label="Output format"><FormatChips options={native ? ['pdf', 'docx', 'rtf', 'odt', 'html', 'md', 'epub', 'png', 'jpg'] : ['md', 'html', 'json', 'txt']} value={output} onChange={setOutput} /></Field></>}
      {tab === 'office' && <><SingleSource file={file} setFile={setFile} accept=".doc,.docx,.odt,.rtf,.xls,.xlsx,.ppt,.pptx" label="Choose Office document" /><EngineLine name="LibreOffice" detail="Not available to this browser window" /></>}
      {tab === 'split' && <><SingleSource file={file} setFile={setFile} accept=".pdf" label="Choose PDF" /><div className="field-grid"><Field label="Split PDF by"><Select value={splitMode} onChange={value => setSplitMode(value as typeof splitMode)} options={[{ value: 'size', label: 'Approximate size MB' }, { value: 'count', label: 'Number of output PDFs' }, { value: 'pages', label: 'Pages per PDF' }]} /></Field><Field label={splitMode === 'size' ? 'Target size' : splitMode === 'count' ? 'Output PDFs' : 'Pages per file'}><NumberStepper label="Split target" value={target} onChange={setTarget} min={1} max={1000} unit={splitMode === 'size' ? 'MB' : ''} /></Field></div>{splitMode === 'size' && <div className="quick-chips">{[1, 5, 10, 25, 100].map(value => <button className={target === value ? 'active' : ''} key={value} onClick={() => setTarget(value)}>{value} MB</button>)}</div>}<InlineNote>On Windows, native size splitting measures generated PDF parts; large individual pages may exceed a target. The browser preview uses an approximate estimate.</InlineNote></>}
      {busy && <ProgressBar value={progress} label="Document processing" />}<div className="panel-footer"><span>{tab === 'office' ? 'External engine required' : 'Read-only source handling'}</span><KineticButton tone="primary" disabled={busy} onClick={run}>{busy ? <LoaderCircle className="spin" size={16} /> : tab === 'split' ? <Split size={16} /> : <Download size={16} />}{tab === 'images-pdf' ? 'Create PDF' : tab === 'pdf-text' ? 'Extract text' : tab === 'txt' ? 'Convert text' : tab === 'office' ? 'Convert to PDF' : 'Create PDFs'}</KineticButton></div>
    </section><InlineNote><Info size={14} />Office conversion uses LibreOffice headless mode in the desktop app. It must be installed separately; ReformANY never downloads it silently.</InlineNote>
  </div>;
}

export function SubtitlesModule(props: ConverterProps) {
  const [file, setFile] = useState<File | null>(null); const [output, setOutput] = useState<'vtt' | 'srt'>('vtt'); const [text, setText] = useState('');
  useEffect(() => { if (file) { file.text().then(setText); setOutput(ext(file.name) === 'vtt' ? 'srt' : 'vtt'); } else setText(''); }, [file]);
  const run = async () => {
    if (!file) { props.notify('Choose a subtitle source', 'SRT and WebVTT files are supported.', 'danger'); return; }
    try {
      if (native) {
        const path = await runNative<string>('subtitle_convert', { job: { path: requireNativePath(file), target: output, destination: await resolveNativeDestination(props.preferences.destination) } });
        props.log('Subtitles converted', `${file.name} → ${path}`, 'Subtitles'); props.notify('Subtitle file ready', `Saved: ${path}`, 'success');
        return;
      }
      const converted = convertSubtitles(text, output);
      await downloadBlob(new Blob([converted], { type: 'text/plain;charset=utf-8' }), `${file.name.replace(/\.[^.]+$/, '')}.${output}`);
      props.log('Subtitles converted', `${file.name} → ${output.toUpperCase()}`, 'Subtitles');
      props.notify('Subtitle file ready', 'Timestamps and cue text were preserved.', 'success');
    } catch (error) { props.notify('Subtitle conversion failed', String(error), 'danger'); }
  };
  return <div className="module"><ModuleHeader eyebrow="Workspace / Subtitles" title={<>Every cue.<br />Right on time.</>} description="Convert SRT and WebVTT timing syntax without touching your video." />
    <div className="two-column-workbench"><section className="panel"><div className="panel-kicker"><span>01</span> Source & output</div><SingleSource file={file} setFile={setFile} accept=".srt,.vtt" label="Choose SRT or VTT" /><Field label="Convert to"><FormatChips options={['srt', 'vtt']} value={output} onChange={value => setOutput(value as 'srt' | 'vtt')} /></Field><Field label="Destination"><Select value={props.preferences.destination} onChange={destination => props.updatePreferences({ destination })} options={['Next to original', 'Desktop', 'Downloads']} /></Field><InlineNote>This converter changes timestamp separators and the WEBVTT header. It does not translate, retime, repair overlapping cues, or preserve every vendor-specific VTT style block.</InlineNote><KineticButton tone="primary" onClick={() => void run()}><Download size={16} />Convert subtitles</KineticButton></section>
      <section className="panel subtitle-preview"><div className="panel-kicker"><span>02</span> Cue preview</div>{text ? <pre>{text.slice(0, 5000)}</pre> : <EmptyState icon={<Type size={28} />} title="Timing, made legible" description="Choose a subtitle file to inspect its cues before conversion." />}</section></div>
  </div>;
}

export function SpreadsheetsModule(props: ConverterProps) {
  const [file, setFile] = useState<File | null>(null); const [output, setOutput] = useState<'xlsx' | 'csv' | 'tsv' | 'json'>('xlsx'); const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!file) { props.notify('Choose a spreadsheet', 'CSV, TSV, JSON, XLSX, XLS and ODS are accepted.', 'danger'); return; }
    if (file.size > 24 * 1024 * 1024) { props.notify('File exceeds 24 MB', 'Split the workbook before converting it.', 'danger'); return; }
    setBusy(true);
    try {
      if (native) { const path = await runNative<string>('spreadsheet_convert', { job: { path: requireNativePath(file), target: output, destination: await resolveNativeDestination(props.preferences.destination) } }); props.log('Spreadsheet converted', path, 'Spreadsheets'); props.notify('Workbook exported', `Saved: ${path}`, 'success'); setBusy(false); return; }
      const blob = await convertSpreadsheet(file, output); await downloadBlob(blob, `${file.name.replace(/\.[^.]+$/, '')}.${output}`);
      props.log('Spreadsheet converted', `${file.name} → ${output.toUpperCase()} · first sheet`, 'Spreadsheets'); props.notify('Workbook exported', `${output.toUpperCase()} downloaded from the first worksheet.`, 'success');
    } catch (error) { props.notify('Spreadsheet could not be converted', error instanceof Error ? error.message : 'Check the input structure.', 'danger'); }
    setBusy(false);
  };
  return <div className="module"><ModuleHeader eyebrow="Workspace / Spreadsheets" title={<>Rows in.<br />Useful data out.</>} description="Move between workbook and open data formats with deliberate, visible limits." aside={<div className="limit-grid"><span><strong>50k</strong> rows</span><span><strong>128</strong> columns</span><span><strong>24</strong> MB</span></div>} />
    <section className="panel spreadsheet-bench"><SingleSource file={file} setFile={setFile} accept=".csv,.tsv,.json,.xlsx,.xls,.ods" label="Choose spreadsheet" /><Field label="Output"><FormatChips options={['xlsx', 'csv', 'tsv', 'json']} value={output} onChange={value => setOutput(value as typeof output)} /></Field><div className="spreadsheet-diagram"><div><Sheet size={26} /><span>INPUT</span><strong>{file ? ext(file.name).toUpperCase() : '—'}</strong></div><div className="data-lines">{Array.from({ length: 6 }, (_, index) => <i key={index} style={{ width: `${92 - index * 8}%` }} />)}</div><div><Braces size={26} /><span>OUTPUT</span><strong>{output.toUpperCase()}</strong></div></div><InlineNote>The first worksheet is exported. Formulas become their cached values where available; macros, charts, comments and workbook styling are not carried into CSV, TSV or JSON. Rows beyond 50,000 or columns beyond 128 should be split before import.</InlineNote><KineticButton tone="primary" disabled={busy} onClick={run}>{busy ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}Convert spreadsheet</KineticButton></section>
  </div>;
}

function PdfCanvas({ file, pageNumber, zoom, onPages }: { file: File; pageNumber: number; zoom: number; onPages: (pages: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true; let loaded: PDFDocumentProxy | null = null;
    setError(''); setPdf(null);
    void file.arrayBuffer().then(data => getDocument({ data: new Uint8Array(data) }).promise).then(document => {
      if (!active) { void document.destroy(); return; }
      loaded = document; setPdf(document); onPages(document.numPages);
    }).catch(() => { if (active) setError('This PDF could not be rendered.'); });
    return () => { active = false; if (loaded) void loaded.destroy(); };
  }, [file, onPages]);
  useEffect(() => {
    let active = true;
    if (!pdf) return;
    void pdf.getPage(pageNumber).then(page => {
      const viewport = page.getViewport({ scale: zoom / 100 * 1.35 });
      const element = canvas.current;
      if (!element || !active) return;
      element.width = viewport.width; element.height = viewport.height;
      return page.render({ canvasContext: element.getContext('2d')!, viewport, canvas: element }).promise;
    }).catch(() => { if (active) setError('This page could not be rendered.'); });
    return () => { active = false; };
  }, [pdf, pageNumber, zoom]);
  return error ? <div className="pdf-error">{error}</div> : pdf ? <canvas ref={canvas} className="pdf-canvas" /> : <div className="skeleton-page"><span /><span /><span /></div>;
}

export function PreviewModule(props: ConverterProps) {
  const [file, setFile] = useState<File | null>(null); const [text, setText] = useState(''); const [page, setPage] = useState(1); const [pages, setPages] = useState(1); const [zoom, setZoom] = useState(100); const root = useRef<HTMLDivElement>(null);
  useEffect(() => { if (file && ['txt', 'md', 'markdown'].includes(ext(file.name))) file.text().then(setText); else setText(''); setPage(1); }, [file]);
  const open = async (selected: File | null) => { setFile(selected); if (selected) props.log('Preview opened', `${selected.name} · read-only`, 'Preview', 'info'); };
  const sample = async () => { const blob = await createSamplePdf(6); void open(new File([blob], 'ReformANY-field-notes.pdf', { type: 'application/pdf' })); };
  if (!file) return <div className="module preview-module"><ModuleHeader eyebrow="Workspace / Preview" title={<>Your document,<br />without distractions.</>} description="A calm, read-only surface for PDF, plain text and Markdown." /><EmptyState icon={<BookOpen size={32} />} title="Nothing open. Everything local." description="Open a document to read it here. The original file remains untouched." action={<div className="empty-actions"><FilePicker multiple={false} accept=".pdf,.txt,.md,.markdown" onFiles={files => void open(files[0] || null)} tone="primary"><Plus size={16} />Open file</FilePicker><KineticButton onClick={sample}>Load local sample</KineticButton></div>} /><div className="preview-footer">Read-only · Fully local · original file unchanged</div></div>;
  const isPdf = ext(file.name) === 'pdf'; const isMarkdown = ['md', 'markdown'].includes(ext(file.name));
  return <div className="module preview-module active" ref={root}><div className="preview-toolbar"><div><FileText size={18} /><span title={file.name}>{file.name}</span><small>{formatBytes(file.size)} · {isPdf ? `${pages} pages` : `${text.length.toLocaleString()} characters`}</small></div><div>{isPdf && <><IconButton label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /></IconButton><span className="page-indicator">{page} / {pages}</span><IconButton label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)}><ChevronRight size={16} /></IconButton></>}<IconButton label="Zoom out" onClick={() => setZoom(Math.max(50, zoom - 10))}><ZoomOut size={16} /></IconButton><button className="zoom-value" onClick={() => setZoom(100)}>{zoom}%</button><IconButton label="Zoom in" onClick={() => setZoom(Math.min(220, zoom + 10))}><ZoomIn size={16} /></IconButton><IconButton label="Fullscreen preview" onClick={() => root.current?.requestFullscreen()}><Fullscreen size={16} /></IconButton><FilePicker multiple={false} accept=".pdf,.txt,.md,.markdown" onFiles={files => void open(files[0] || null)}><Plus size={15} />Open file</FilePicker></div></div>
    <div className={`document-viewport ${isPdf ? 'pdf' : 'text'}`}>{isPdf ? <PdfCanvas file={file} pageNumber={page} zoom={zoom} onPages={setPages} /> : <article style={{ fontSize: `${zoom / 100}rem` }}>{isMarkdown ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown> : <pre>{text}</pre>}</article>}</div><div className="preview-footer">Read-only · Fully local · original file unchanged</div>
  </div>;
}

export function EbooksModule(props: ConverterProps) {
  const [file, setFile] = useState<File | null>(null);
  const run = async () => {
    if (!file) { props.notify('Choose an e-book', 'EPUB, MOBI, FB2, AZW3, CBZ, CBR, PDF and DOCX are accepted.', 'danger'); return; }
    try {
      if (native) {
        if (ext(file.name) === 'epub') { props.notify('Already EPUB', 'This source is already in the requested format.', 'default'); return; }
        const path = await runNative<string>('ebook_convert_file', { job: { path: requireNativePath(file), target: 'epub', destination: await resolveNativeDestination(props.preferences.destination) } });
        props.log('E-book converted', `${file.name} → ${path}`, 'E-books'); props.notify('E-book exported', `Saved: ${path}`, 'success');
        return;
      }
      if (ext(file.name) === 'epub') { await downloadBlob(file, file.name); props.notify('EPUB copied locally', 'No re-encoding was needed.', 'success'); return; }
      props.notify('Calibre is required', 'E-book conversion requires the Windows desktop app.', 'danger');
    } catch (error) { props.notify('E-book conversion failed', String(error), 'danger'); }
  };
  return <div className="module"><ModuleHeader eyebrow="Workspace / E-books" title={<>A library that<br />travels well.</>} description="Bring common book and comic containers into a consistent EPUB library." aside={<EngineLine name="Calibre" detail="ebook-convert not detected in browser" />} /><section className="panel ebook-bench"><div className="ebook-visual"><BookOpen size={48} /><span>EPUB</span></div><div><SingleSource file={file} setFile={setFile} accept=".epub,.mobi,.fb2,.azw3,.cbz,.cbr,.pdf,.docx" label="Choose e-book" /><Field label="Convert to"><Select value="EPUB" onChange={() => undefined} options={['EPUB']} /></Field><Field label="Destination"><Select value={props.preferences.destination} onChange={destination => props.updatePreferences({ destination })} options={['Next to original', 'Desktop', 'Downloads', 'Choose folder']} /></Field><InlineNote>Calibre is an optional external engine. ReformANY checks for ebook-convert on PATH and never installs it without your consent.</InlineNote><KineticButton tone="primary" onClick={() => void run()}><BookOpen size={16} />Convert to EPUB</KineticButton></div></section></div>;
}
