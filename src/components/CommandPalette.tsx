import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Command, Eraser, Moon, Orbit, PanelLeftClose, Search, Sun, X, type LucideIcon } from 'lucide-react';
import type { ModuleId } from '../types';
import { moduleLabels } from './AppShell';
import { IconButton } from './UI';

const moduleOrder: ModuleId[] = ['workspace', 'images', 'media', 'media-tools', 'archives', 'documents', 'subtitles', 'spreadsheets', 'preview', 'ebooks', 'activity', 'guide', 'appearance', 'files-jobs', 'engines'];
type SearchRoute = { title: string; detail: string; group: string; module: ModuleId; keywords: string; section?: string };
type Action = { id: string; title: string; detail: string; group: string; keywords: string; run: () => void; icon?: LucideIcon };
const ROUTES: SearchRoute[] = [
  { title: 'Extract PDF pages', detail: 'Choose ranges and selected pages · Orbit Tools', group: 'PDF tools', module: 'documents', keywords: 'range pages extract pdf orbit selection thumbnails' },
  { title: 'Arrange PDF pages', detail: 'Reorder, rotate and delete PDF pages · Orbit Tools', group: 'PDF tools', module: 'documents', keywords: 'organize drag reorder rotate pages orbit' },
  { title: 'Rotate PDF pages', detail: 'Rotate document pages · Orbit Tools', group: 'PDF tools', module: 'documents', keywords: '90 180 rotation pdf orbit' },
  { title: 'Watermark PDF', detail: 'Add text, color, opacity and position to PDF', group: 'PDF tools', module: 'documents', keywords: 'watermark overlay stamp rotate page' },
  { title: 'Sign PDF', detail: 'Apply a visible PDF signature', group: 'PDF tools', module: 'documents', keywords: 'sign signature mark orbit documents' },
  { title: 'Protect and unlock PDF', detail: 'PDF passwords and encryption', group: 'PDF tools', module: 'documents', keywords: 'password aes protect secure unlock decrypt' },
  { title: 'Split PDF', detail: 'Create independent PDF files', group: 'PDF tools', module: 'documents', keywords: 'split by size parts page documents' },
  { title: 'Extract embedded PDF images', detail: 'Save pictures embedded in a PDF', group: 'PDF tools', module: 'documents', keywords: 'image pictures extract embedded' },
  { title: 'PDF to DOCX', detail: 'Export editable or layout DOCX files', group: 'Document converters', module: 'documents', keywords: 'pdf word docx layout edit' },
  { title: 'PDF to text', detail: 'Export the readable text from a PDF', group: 'Document converters', module: 'documents', keywords: 'extract txt markdown html' },
  { title: 'TXT to PDF', detail: 'Create a real PDF from a plain-text document', group: 'Document converters', module: 'documents', keywords: 'text txt pdf convert document' },
  { title: 'TXT to DOCX', detail: 'Convert plain text to a Word document', group: 'Document converters', module: 'documents', keywords: 'text txt word docx export' },
  { title: 'Images to PDF', detail: 'Combine photos into a PDF', group: 'Document converters', module: 'documents', keywords: 'image png jpeg jpg photo pdf' },
  { title: 'Office to PDF', detail: 'Use the installed LibreOffice conversion engine', group: 'Document converters', module: 'documents', keywords: 'docx doc office word document pdf libreoffice' },
  { title: 'Image conversion', detail: 'PNG, JPG, JPEG, WebP, AVIF, GIF, BMP, TIFF and more', group: 'Converters', module: 'images', keywords: 'photo picture image convert compress size quality rotate' },
  { title: 'Video conversion', detail: 'MP4, H.265, MKV, MOV, WebM, AVI and more', group: 'Converters', module: 'media', keywords: 'video movie ffmpeg encode h264 h265 mp4 mov mkv webm gif' },
  { title: 'Audio conversion', detail: 'MP3, WAV, FLAC, M4A, Opus, OGG and more', group: 'Converters', module: 'media', keywords: 'sound music audio extract ffmpeg wav ogg flac' },
  { title: 'Archive tools', detail: 'ZIP, 7Z, RAR, TAR and file extraction', group: 'Tools', module: 'archives', keywords: 'compress unzip archive password pack unpack zip tar rar' },
  { title: 'Subtitle conversion', detail: 'Convert SRT and WebVTT captions', group: 'Converters', module: 'subtitles', keywords: 'srt vtt subtitles timing video captions' },
  { title: 'Spreadsheet conversion', detail: 'CSV, TSV, XLSX, JSON tables', group: 'Converters', module: 'spreadsheets', keywords: 'excel data sheet workbook csv json xlsx' },
  { title: 'E-book conversion', detail: 'EPUB and other book formats', group: 'Converters', module: 'ebooks', keywords: 'book epub mobi azw calibre' },
  { title: 'HoveR preview', detail: 'Local preview for images, PDF, audio and video', group: 'Tools', module: 'preview', keywords: 'hover view photo pdf preview player' },
  { title: 'Files and jobs', detail: 'Auto Convert folders, queue policy and schedules', group: 'Tools', module: 'files-jobs', keywords: 'watch folder jobs scheduling processing balance batch' },
  { title: 'Dark and light themes', detail: 'Switch or follow system colors', group: 'Settings', module: 'appearance', section: 'settings-interface', keywords: 'appearance color dark light theme mode display' },
  { title: 'Language', detail: 'English-only interface settings', group: 'Settings', module: 'appearance', section: 'settings-interface', keywords: 'english translation locale' },
  { title: 'Orbit sounds', detail: 'Opening, closing, hover and volume controls', group: 'Settings', module: 'appearance', section: 'settings-sounds', keywords: 'sound audio mute chime volume cue' },
  { title: 'Hold and Shake', detail: 'Windows Explorer shake activation', group: 'Settings', module: 'appearance', section: 'settings-mouse', keywords: 'mouse shake hold gesture explorer enable disable' },
  { title: 'Shake sensitivity', detail: 'Adjust how much motion activates Orbit', group: 'Settings', module: 'appearance', section: 'settings-mouse', keywords: 'mouse hold gesture sensitivity movement' },
  { title: 'Orbit mouse controls', detail: 'Scroll sections and pointer loading ring', group: 'Settings', module: 'appearance', section: 'settings-mouse', keywords: 'pointer cursor mouse scroll wheel actions tools orbit ring' },
  { title: 'Orbit keyboard shortcuts', detail: 'Change Shift, Ctrl and Alt modifiers', group: 'Settings', module: 'appearance', section: 'settings-mouse', keywords: 'rebind hotkeys keyboard shortcuts convert tools actions modifier' },
  { title: 'Explorer context menu', detail: 'Enable or disable the Orbit right-click shortcut', group: 'Settings', module: 'appearance', section: 'settings-interface', keywords: 'file windows right click registry portable shell folder' },
  { title: 'Close to tray', detail: 'Set what happens when the window closes', group: 'Settings', module: 'appearance', section: 'settings-interface', keywords: 'system tray minimize window hide close settings' },
  { title: 'Conversion engines', detail: 'Inspect FFmpeg, FFprobe and other local tools', group: 'Settings', module: 'engines', keywords: 'encoder engine availability binary ffmpeg ffprobe calibre libreoffice' },
];

function normalize(text: string): string {
  return text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function matchScore(action: Action, query: string): number {
  const title = normalize(action.title), body = normalize(action.detail + ' ' + action.keywords + ' ' + action.group);
  if (!query) return 1;
  const terms = query.split(' ').filter(Boolean);
  if (!terms.every(term => title.includes(term) || body.includes(term))) return -1;
  return (title === query ? 200 : 0) + (title.startsWith(query) ? 100 : 0) +
    (title.includes(query) ? 70 : 0) + terms.reduce((score, term) => score + (title.includes(term) ? 12 : 3), 0);
}

export function CommandPalette({ open, onClose, navigate, onOrbit, onToggleCollapsed, onToggleTheme, onClearQueue, queueCount, theme }: {
  open: boolean; onClose: () => void; navigate: (module: ModuleId) => void; onOrbit: () => void;
  onToggleCollapsed: () => void; onToggleTheme: () => void; onClearQueue: () => void;
  queueCount: number; theme: string;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const actions: Action[] = useMemo(() => {
    const openSection = (id: ModuleId, section?: string) => {
      navigate(id);
      if (section) requestAnimationFrame(() => requestAnimationFrame(() =>
        document.getElementById(section)?.scrollIntoView({ block: 'start', behavior: 'smooth' })));
    };
    return [
      ...moduleOrder.map(id => ({ id: 'module-' + id, title: moduleLabels[id], detail: 'Open ' + moduleLabels[id], group: 'Navigate', keywords: id === 'appearance' ? 'settings preferences appearance' : id, run: () => openSection(id) })),
      ...ROUTES.map((item, index) => ({ id: 'route-' + index, title: item.title, detail: item.detail, group: item.group, keywords: item.keywords, run: () => openSection(item.module, item.section) })),
      { id: 'orbit', title: 'Open Orbit', detail: 'Open the native circular file action menu', group: 'Actions', keywords: 'wheel floating desktop explorer quick convert', icon: Orbit, run: onOrbit },
      { id: 'theme', title: theme === 'dark' ? 'Use light mode' : 'Use dark mode', detail: 'Toggle the window theme', group: 'Actions', keywords: 'appearance settings colors sun moon', icon: theme === 'dark' ? Sun : Moon, run: onToggleTheme },
      { id: 'sidebar', title: 'Collapse or expand sidebar', detail: 'Show or hide navigation labels', group: 'Actions', keywords: 'layout rail menu navigation', icon: PanelLeftClose, run: onToggleCollapsed },
      { id: 'clear', title: 'Clear image queue', detail: queueCount ? 'Remove ' + queueCount + ' queued items' : 'Queue is already empty', group: 'Actions', keywords: 'jobs remove clear', icon: Eraser, run: onClearQueue },
    ];
  }, [navigate, onOrbit, onToggleCollapsed, onToggleTheme, onClearQueue, queueCount, theme]);

  const filtered = useMemo(() => {
    const normalized = normalize(query);
    return actions.map(action => ({ action, score: matchScore(action, normalized) }))
      .filter(item => item.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20).map(item => item.action);
  }, [actions, query]);

  useEffect(() => { if (open) { setQuery(''); setSelected(0); const timer = window.setTimeout(() => input.current?.focus(), 30); return () => clearTimeout(timer); } }, [open]);
  useEffect(() => setSelected(0), [query]);
  if (!open) return null;
  const execute = (action?: Action) => { if (!action) return; action.run(); onClose(); };
  return <div className="command-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="command-palette" role="dialog" aria-modal="true" aria-label="Search ReformANY">
      <header><Command size={18}/><input ref={input} value={query} onChange={event => setQuery(event.target.value)}
        placeholder="Search tools, formats, mouse, shake, settings…"
        onKeyDown={event => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(Math.min(Math.max(0, filtered.length - 1), selected + 1)); }
          if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(Math.max(0, selected - 1)); }
          if (event.key === 'Enter') execute(filtered[selected]);
          if (event.key === 'Escape') onClose();
        }} /><kbd>ESC</kbd><IconButton label="Close search" onClick={onClose}><X size={16}/></IconButton></header>
      <div className="command-results">{filtered.map((action, index) => {
        const Icon = action.icon || Search;
        return <button className={selected === index ? 'selected' : ''} key={action.id}
          onMouseEnter={() => setSelected(index)} onClick={() => execute(action)}><Icon size={17}/><div>
            <strong>{action.title}</strong><span>{action.detail}</span></div><small>{action.group}</small><ArrowRight size={15}/></button>;
      })}
      {!filtered.length && <div className="command-empty"><Search size={26}/><strong>No matching result</strong><span>Try PDF, TXT, Shake, mouse, or volume.</span></div>}</div>
      <footer><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>↵</kbd> Open</span><span>{actions.length} indexed tools and actions · local search</span></footer>
    </section>
  </div>;
}
