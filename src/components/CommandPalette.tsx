import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Command, Eraser, Moon, Orbit, PanelLeftClose, Search, Sun, X } from 'lucide-react';
import type { ModuleId } from '../types';
import { moduleLabels } from './AppShell';
import { IconButton } from './UI';

const moduleOrder: ModuleId[] = ['workspace', 'images', 'media', 'media-tools', 'archives', 'documents', 'subtitles', 'spreadsheets', 'preview', 'ebooks', 'activity', 'guide', 'appearance', 'files-jobs', 'engines'];
type Action = { id: string; title: string; detail: string; group: string; run: () => void; icon?: typeof Orbit };

export function CommandPalette({ open, onClose, navigate, onOrbit, onToggleCollapsed, onToggleTheme, onClearQueue, queueCount, theme }: { open: boolean; onClose: () => void; navigate: (module: ModuleId) => void; onOrbit: () => void; onToggleCollapsed: () => void; onToggleTheme: () => void; onClearQueue: () => void; queueCount: number; theme: string }) {
  const [query, setQuery] = useState(''); const [selected, setSelected] = useState(0); const input = useRef<HTMLInputElement>(null);
  const actions: Action[] = [
    ...moduleOrder.map(id => ({ id: `module-${id}`, title: moduleLabels[id], detail: `Open ${moduleLabels[id]}`, group: 'Navigate', run: () => navigate(id) })),
    { id: 'orbit', title: 'Open Orbit HUD', detail: 'Explore the separate floating overlay and every file context', group: 'Actions', icon: Orbit, run: onOrbit },
    { id: 'theme', title: theme === 'dark' ? 'Use warm light theme' : 'Use Dark Graphite', detail: 'Switch the persisted appearance preference', group: 'Actions', icon: theme === 'dark' ? Sun : Moon, run: onToggleTheme },
    { id: 'sidebar', title: 'Toggle sidebar rail', detail: 'Switch between full navigation and the 64 px icon rail', group: 'Actions', icon: PanelLeftClose, run: onToggleCollapsed },
    { id: 'clear', title: 'Clear image queue', detail: queueCount ? `Remove ${queueCount} queued image${queueCount === 1 ? '' : 's'} · source files stay untouched` : 'Image queue is already empty', group: 'Actions', icon: Eraser, run: onClearQueue },
  ];
  const filtered = actions.filter(action => `${action.title} ${action.detail} ${action.group}`.toLowerCase().includes(query.toLowerCase().trim())).slice(0, 12);
  useEffect(() => { if (open) { setQuery(''); setSelected(0); setTimeout(() => input.current?.focus(), 40); } }, [open]);
  useEffect(() => setSelected(0), [query]);
  if (!open) return null;
  const execute = (action?: Action) => { if (!action) return; action.run(); onClose(); };
  return <div className="command-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette"><header><Command size={18} /><input ref={input} value={query} onChange={event => setQuery(event.target.value)} placeholder="Type a converter, setting, or action…" onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(Math.min(filtered.length - 1, selected + 1)); } if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(Math.max(0, selected - 1)); } if (event.key === 'Enter') execute(filtered[selected]); if (event.key === 'Escape') onClose(); }} /><kbd>ESC</kbd><IconButton label="Close command palette" onClick={onClose}><X size={16} /></IconButton></header><div className="command-results">{filtered.map((action, index) => { const Icon = action.icon || Search; return <button className={selected === index ? 'selected' : ''} key={action.id} onMouseEnter={() => setSelected(index)} onClick={() => execute(action)}><Icon size={17} /><div><strong>{action.title}</strong><span>{action.detail}</span></div><small>{action.group}</small><ArrowRight size={15} /></button>; })}{!filtered.length && <div className="command-empty"><Search size={26} /><strong>No matching command</strong><span>Try “PDF”, “Orbit”, “theme”, or “queue”.</span></div>}</div><footer><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>↵</kbd> Run command</span><span>15 destinations · local actions</span></footer></section></div>;
}
