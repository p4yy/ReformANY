import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, File, FolderOpen, Minus, Plus, Upload, X } from 'lucide-react';
import { ext, formatBytes, middleEllipsis } from '../lib/files';
import { native, selectLocalFiles, loadNativeFile } from '../native/bridge';
import { getCurrentWebview } from '@tauri-apps/api/webview';

export function KineticButton({ children, tone = 'default', icon, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'default' | 'primary' | 'ghost' | 'danger'; icon?: ReactNode }) {
  return <button className={`kinetic-button ${tone} ${className}`} {...props}>{icon}{children}</button>;
}

export function IconButton({ label, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}>{children}</button>;
}

export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return <label className={`field ${className}`}><span className="field-label">{label}{hint && <small>{hint}</small>}</span>{children}</label>;
}

export function Select({ value, options, onChange, label, disabled = false }: { value: string; options: (string | { value: string; label: string; meta?: string })[]; onChange: (value: string) => void; label?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const normalized = options.map(option => typeof option === 'string' ? { value: option, label: option } : option);
  const selected = normalized.find(option => option.value === value) || normalized[0];
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);
  return <div className={`select ${open ? 'open' : ''}`} ref={root}>
    {label && <span className="sr-only" id={id}>{label}</span>}
    <button type="button" aria-labelledby={label ? id : undefined} aria-expanded={open} className="select-trigger" onClick={() => setOpen(!open)} disabled={disabled}>
      <span>{selected?.label || 'Select'}</span><ChevronDown size={14} />
    </button>
    {open && <div className="select-menu" role="listbox">
      {normalized.map(option => <button type="button" role="option" aria-selected={option.value === value} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }}>
        <span>{option.label}{option.meta && <small>{option.meta}</small>}</span>{option.value === value && <Check size={14} />}
      </button>)}
    </div>}
  </div>;
}

export function SpringSlider({ value, onChange, min = 0, max = 100, step = 1, unit = '%', label, disabled = false }: { value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; unit?: string; label?: string; disabled?: boolean }) {
  const fill = ((value - min) / (max - min)) * 100;
  return <div className={`spring-slider ${disabled ? 'disabled' : ''}`}>
    {label && <span className="sr-only">{label}</span>}
    <input aria-label={label} type="range" min={min} max={max} step={step} value={value} disabled={disabled} style={{ '--fill': `${fill}%` } as CSSProperties} onChange={event => onChange(Number(event.target.value))} />
    <output>{value}{unit}</output>
  </div>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? 'checked' : ''}`} onClick={() => onChange(!checked)}><span /></button>;
}

export function SettingRow({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <div className="setting-row"><div><strong>{title}</strong>{description && <p>{description}</p>}</div><div className="setting-control">{children}</div></div>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; label?: string }) {
  return <div className="segmented" role="group" aria-label={label} style={{ '--count': options.length, '--active': options.findIndex(option => option.value === value) } as CSSProperties}>
    <span className="segment-indicator" />{options.map(option => <button type="button" key={option.value} className={value === option.value ? 'active' : ''} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}

export function NumberStepper({ value, onChange, min = 0, max = 99999, unit, label }: { value: number; onChange: (value: number) => void; min?: number; max?: number; unit?: string; label: string }) {
  return <div className="number-stepper"><input aria-label={label} type="number" min={min} max={max} value={value} onChange={event => onChange(Math.max(min, Math.min(max, Number(event.target.value))))} />
    {unit && <span>{unit}</span>}<div><IconButton label="Increase" onClick={() => onChange(Math.min(max, value + 1))}><ChevronUp size={14} /></IconButton><IconButton label="Decrease" onClick={() => onChange(Math.max(min, value - 1))}><ChevronDown size={14} /></IconButton></div>
  </div>;
}

export function FilePicker({ onFiles, accept, multiple = true, children, tone = 'ghost', directory = false, disabled = false }: { onFiles: (files: File[]) => void; accept?: string; multiple?: boolean; children: ReactNode; tone?: 'ghost' | 'primary' | 'default'; directory?: boolean; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return <><input ref={input} className="sr-only" type="file" accept={accept} multiple={multiple} disabled={disabled} {...(directory ? { webkitdirectory: '', directory: '' } : {})} onChange={event => { onFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />
    <KineticButton tone={tone} disabled={disabled} onClick={() => { if (native) void selectLocalFiles({ multiple, directory, accept }).then(onFiles).catch(error => window.dispatchEvent(new CustomEvent('reformany:notice', { detail: String(error) }))); else input.current?.click(); }}>{children}</KineticButton></>;
}

export function DropZone({ onFiles, accept, formats, maxMb = 150, count = 0, title = 'Drop files into the workbench', subtitle }: { onFiles: (files: File[]) => void; accept: string[]; formats: string[]; maxMb?: number; count?: number; title?: string; subtitle?: string }) {
  const [dragging, setDragging] = useState(false);
  const [reject, setReject] = useState(false);
  const [ripple, setRipple] = useState({ x: 50, y: 50 });
  const root = useRef<HTMLDivElement>(null);
  const validate = (files: File[]) => {
    const valid = files.filter(file => (accept.includes('*') || accept.includes(ext(file.name))) && file.size <= maxMb * 1024 * 1024);
    if (!valid.length) { setReject(true); setTimeout(() => setReject(false), 500); return; }
    onFiles(valid);
    if (valid.length !== files.length) { setReject(true); setTimeout(() => setReject(false), 500); }
  };
  useEffect(() => {
    if (!native) return;
    let active = true; let unlisten: (() => void) | null = null;
    void getCurrentWebview().onDragDropEvent(event => {
      if (!active || event.payload.type !== 'drop') return;
      void Promise.all(event.payload.paths.slice(0, 300).map(path => loadNativeFile(path).catch(() => null)))
        .then(files => { if (active) validate(files.filter((file): file is File => file !== null)); });
    }).then(stop => { if (active) unlisten = stop; else stop(); });
    return () => { active = false; unlisten?.(); };
  }, [onFiles, maxMb, accept.join('|')]);
  const dragOver = (event: DragEvent) => {
    event.preventDefault(); setDragging(true);
    const rect = root.current?.getBoundingClientRect();
    if (rect) setRipple({ x: (event.clientX - rect.left) / rect.width * 100, y: (event.clientY - rect.top) / rect.height * 100 });
  };
  return <div ref={root} className={`dropzone ${dragging ? 'dragging' : ''} ${reject ? 'reject' : ''}`} style={{ '--rx': `${ripple.x}%`, '--ry': `${ripple.y}%` } as CSSProperties}
    onDragOver={dragOver} onDragLeave={event => { if (!root.current?.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); validate(Array.from(event.dataTransfer.files)); }}>
    <div className="drop-ripple" /><div className="dropzone-content">
      <div className="drop-glyph"><Upload size={24} /><span /></div>
      <div><h3>{title}</h3><p>{subtitle || `${formats.join(' · ')} — up to ${maxMb} MB each`}</p></div>
      <div className="drop-actions"><FilePicker accept={accept.map(item => `.${item}`).join(',')} onFiles={validate} tone="primary"><Plus size={16} />Add files</FilePicker><FilePicker directory onFiles={validate}><FolderOpen size={16} />Add folder</FilePicker></div>
    </div>
    <div className="format-chips">{formats.slice(0, 8).map((format, index) => <span key={format} style={{ '--i': index } as CSSProperties}>{format}</span>)}</div>
    <div className="drop-count"><strong>{String(count).padStart(2, '0')}</strong><span>files in queue</span></div>
  </div>;
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  return <div className="progress-wrap" aria-label={label}><div className="progress-track"><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }}><i /><i /><i /></span></div>{label && <small>{label}</small>}</div>;
}

export function FileContextRow({ name, meta, danger = false }: { name: string; meta: string; danger?: boolean }) {
  return <div className={`file-context-row ${danger ? 'danger' : ''}`}><File size={16} /><span title={name}>{middleEllipsis(name, 42)}</span><small>{meta}</small></div>;
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-orbit"><span />{icon}</div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return <KineticButton tone="ghost" onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : label}</KineticButton>;
}

export function QueueList({ items, onRemove, onReorder }: { items: { id: string; name: string; size: number; status: string; progress: number; output?: string; message?: string; previewUrl?: string }[]; onRemove: (id: string) => void; onReorder?: (from: number, to: number) => void }) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  if (!items.length) return null;
  return <div className="queue-list">{items.map((item, index) => <div key={item.id} draggable={!!onReorder && item.status === 'queued'} onDragStart={() => setDragIndex(index)} onDragOver={event => event.preventDefault()} onDrop={() => { if (dragIndex !== null && dragIndex !== index) onReorder?.(dragIndex, index); setDragIndex(null); }} className={`queue-card ${item.status}`} style={{ '--i': index } as CSSProperties}>
    <div className="file-tonal-icon">{item.previewUrl ? <img src={item.previewUrl} alt="" /> : <File size={20} />}</div>
    <div className="queue-info"><div><strong title={item.name}>{item.name}</strong><small>{formatBytes(item.size)} · {ext(item.name).toUpperCase() || 'FILE'}</small></div>{item.message && <p>{item.message}</p>}{(item.status === 'working' || item.status === 'done') && <ProgressBar value={item.progress} label={item.output || `${item.progress}%`} />}</div>
    <span className={`status-word ${item.status}`}>{item.status === 'done' ? 'Ready' : item.status === 'working' ? `${item.progress}%` : item.status === 'blocked' ? 'Engine needed' : item.status}</span>
    <div className="queue-reorder">{onReorder && <><IconButton label="Move earlier" disabled={index === 0} onClick={() => onReorder(index, index - 1)}><ChevronUp size={14} /></IconButton><IconButton label="Move later" disabled={index === items.length - 1} onClick={() => onReorder(index, index + 1)}><ChevronDown size={14} /></IconButton></>}<IconButton label="Remove file" onClick={() => onRemove(item.id)}><X size={14} /></IconButton></div>
  </div>)}</div>;
}

export function InlineNote({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'warning' }) {
  return <div className={`inline-note ${tone}`}><Minus size={14} /> <div>{children}</div></div>;
}
