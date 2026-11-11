import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Activity, AudioLines, BookOpen, BookOpenCheck, ChevronRight, FileArchive, FileText, FolderCog, Image, Images, LayoutDashboard, Maximize2, Menu, Minimize2, Minus, Orbit, PanelLeftClose, PanelLeftOpen, Search, Settings2, Sun, Moon, Sheet, SlidersHorizontal, Subtitles, Video, X } from 'lucide-react';
import type { ModuleId } from '../types';
import { IconButton } from './UI';

export const moduleLabels: Record<ModuleId, string> = {
  workspace: 'Overview', images: 'Images', media: 'Audio & Video', 'media-tools': 'Media Tools', archives: 'Archives', documents: 'Documents', subtitles: 'Subtitles', spreadsheets: 'Spreadsheets', preview: 'Preview', ebooks: 'E-books', activity: 'Activity', guide: 'Guide', appearance: 'Settings', 'files-jobs': 'Files & Jobs', engines: 'Engines',
};
const converters: { id: ModuleId; icon: typeof Image; shortcut?: string }[] = [
  { id: 'images', icon: Images, shortcut: '1' }, { id: 'media', icon: AudioLines, shortcut: '2' }, { id: 'media-tools', icon: Video, shortcut: '3' },
  { id: 'archives', icon: FileArchive, shortcut: '4' }, { id: 'documents', icon: FileText, shortcut: '5' }, { id: 'subtitles', icon: Subtitles },
  { id: 'spreadsheets', icon: Sheet }, { id: 'preview', icon: BookOpen }, { id: 'ebooks', icon: BookOpenCheck },
];

export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? 'compact' : ''}`}><div className="brand-symbol"><img src="/brand/reformany-icon.png" alt="" /></div>{!compact && <><strong>Reform<span>ANY</span></strong><small>LOCAL FILE INSTRUMENT</small></>}</div>;
}

interface ShellProps {
  active: ModuleId; navigate: (module: ModuleId) => void; children: ReactNode;
  queueCount: number; activityCount: number; collapsed: boolean; onToggleCollapsed: () => void;
  mobileOpen: boolean; onToggleMobile: () => void; autoCompact: boolean; altDown: boolean;
  onCommand: () => void; onOrbit: () => void; theme: string; onToggleTheme: () => void; maximized: boolean; onMaximize: () => void;
  onMinimize: () => void; onClose: () => void; focused: boolean; fullscreen: boolean;
}

export function AppShell({ active, navigate, children, queueCount, activityCount, collapsed, onToggleCollapsed, mobileOpen, onToggleMobile, autoCompact, altDown, onCommand, onOrbit, theme, onToggleTheme, maximized, onMaximize, onMinimize, onClose, focused, fullscreen }: ShellProps) {
  const nav = useRef<HTMLElement>(null); const marker = useRef<HTMLSpanElement>(null);
  const rail = collapsed || autoCompact;
  useLayoutEffect(() => {
    const current = nav.current?.querySelector(`[data-module="${active}"]`) as HTMLElement | null;
    if (current && marker.current) { marker.current.style.transform = `translateY(${current.offsetTop}px)`; marker.current.style.height = `${current.offsetHeight}px`; }
  }, [active, rail, mobileOpen]);
  const navItem = (id: ModuleId, icon: typeof Image, shortcut?: string, badge?: number) => {
    const Icon = icon;
    return <button key={id} data-module={id} className={`nav-item ${active === id ? 'active' : ''}`} onClick={() => { navigate(id); if (mobileOpen) onToggleMobile(); }} title={rail ? moduleLabels[id] : undefined}><Icon size={18} strokeWidth={1.5} /><span className="nav-label">{moduleLabels[id]}</span>{badge !== undefined && badge > 0 && <small className="micro-badge">{badge}</small>}{altDown && shortcut && <kbd>{shortcut}</kbd>}</button>;
  };
  return <div className={`app-shell ${rail ? 'rail' : ''} ${mobileOpen ? 'mobile-nav-open' : ''} ${maximized ? 'maximized' : ''} ${focused ? '' : 'unfocused'} ${fullscreen ? 'fullscreen' : ''}`}>
    <aside className="sidebar"><div className="sidebar-brand"><Brand compact={rail} /><IconButton label={rail ? 'Expand sidebar' : 'Collapse sidebar'} onClick={onToggleCollapsed}>{rail ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</IconButton></div>
      <nav className="sidebar-nav" ref={nav}><span className="active-nav-marker" ref={marker} /><span className="nav-section-label">Workspace</span>{navItem('workspace', LayoutDashboard)}<span className="nav-section-label converters-label">Converters</span>{converters.map(item => navItem(item.id, item.icon, item.shortcut, item.id === 'images' ? queueCount : undefined))}<span className="nav-section-label">Records</span>{navItem('activity', Activity, '0', activityCount)}{navItem('guide', BookOpenCheck)}<span className="nav-section-label">Preferences</span>{navItem('appearance', SlidersHorizontal)}{navItem('files-jobs', FolderCog)}{navItem('engines', Settings2)}</nav>
      <div className="sidebar-foot"><div className="local-seal"><span className="status-dot ready" /><div><strong>Local by default</strong><small>No cloud fallback</small></div></div><button className="sidebar-orbit" onClick={onOrbit} title="Open Orbit overlay"><Orbit size={19} /><span>Open Orbit</span><ChevronRight size={14} /></button></div>
    </aside>{mobileOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={onToggleMobile} />}
    <div className="app-main"><header className="window-bar"><div className="window-drag-region" data-tauri-drag-region><IconButton label="Open navigation" className="mobile-menu" onClick={onToggleMobile}><Menu size={18} /></IconButton><div className="breadcrumbs"><span>{['appearance', 'files-jobs', 'engines'].includes(active) ? 'Preferences' : 'Workspace'}</span><ChevronRight size={13} /><strong>{moduleLabels[active]}</strong></div></div><div className="window-actions"><button className="command-trigger" onClick={onCommand}><Search size={15} /><span>Search anything</span><kbd>Ctrl K</kbd></button><button type="button" className="theme-top-button" title={theme === "dark" ? "Light mode" : "Dark mode"} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={onToggleTheme}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button><button className="orbit-top-button" onClick={onOrbit}><Orbit size={16} /><span>Orbit</span></button><div className="local-status"><span className="status-dot ready" /><span>Local processing</span><i />Desktop</div>{!fullscreen && <div className="window-controls"><IconButton label="Minimize window" onClick={onMinimize}><Minus size={15} /></IconButton><IconButton label={maximized ? 'Restore window' : 'Maximize window'} onClick={onMaximize}>{maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</IconButton><IconButton label="Close window" className="window-close" onClick={onClose}><X size={16} /></IconButton></div>}</div></header>
      <main className="content-scroll" onScroll={event => { const value = Math.min(1, event.currentTarget.scrollTop / 320); event.currentTarget.style.setProperty('--scroll', String(value)); }}><div className="content-inner" key={active}>{children}</div><footer className="app-footer"><Brand /><span>Local file conversion · ReformANY desktop</span><button onClick={() => navigate('engines')}>Engine status<ChevronRight size={13} /></button></footer></main>
    </div>
  </div>;
}
