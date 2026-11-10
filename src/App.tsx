import { useCallback, useEffect, useState } from 'react';
import { Check, Orbit, ShieldCheck, X } from 'lucide-react';
import { AppShell, Brand } from './components/AppShell';
import { CommandPalette } from './components/CommandPalette';
import { IconButton, KineticButton } from './components/UI';
import { ArchivesModule, ImagesModule, MediaModule, MediaToolsModule } from './modules/Converters';
import { DocumentsModule, EbooksModule, PreviewModule, SpreadsheetsModule, SubtitlesModule } from './modules/Documents';
import { ActivityModule, AppearanceModule, EnginesModule, FilesJobsModule, GuideModule } from './modules/System';
import { OverviewModule } from './modules/Overview';
import { OrbitHUD } from './orbit/OrbitHUD';
import HoveRView from './HoveRView';
import OrbitPanelWindow from './native/OrbitPanelWindow';
import { defaultPreferences, type ActivityItem, type ModuleId, type Preferences, type QueueItem, type ToastMessage } from './types';
import { uid } from './lib/files';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { setDestinationPreference, runNative } from './native/bridge';
import { closeCurrentNativeWindow, isNativeFloatRoute, isNativeOrbitRoute, isNativePanelRoute, isTauri, openNativeOrbit } from './lib/desktop';

function loadPreferences(): Preferences {
  try { const stored = JSON.parse(localStorage.getItem('reformany.preferences') || '{}') as Partial<Preferences>; return { ...defaultPreferences, ...stored, orbitModifiers: { ...defaultPreferences.orbitModifiers, ...stored.orbitModifiers }, recentFormats: { ...defaultPreferences.recentFormats, ...stored.recentFormats }, watchRules: stored.watchRules || [] }; } catch { return defaultPreferences; }
}
function loadActivity(): ActivityItem[] { try { return JSON.parse(localStorage.getItem('reformany.activity') || '[]') as ActivityItem[]; } catch { return []; } }

export default function App() {
  const [active, setActive] = useState<ModuleId>('images');
  const [preferences, setPreferences] = useState<Preferences>(loadPreferences);
  const [activity, setActivity] = useState<ActivityItem[]>(loadActivity);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [orbitOpen, setOrbitOpen] = useState(false); const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false); const [autoCompact, setAutoCompact] = useState(false); const [mobileOpen, setMobileOpen] = useState(false);
  const [altDown, setAltDown] = useState(false); const [maximized, setMaximized] = useState(false); const [focused, setFocused] = useState(true);
  const [fullscreen, setFullscreen] = useState(false); const [minimized, setMinimized] = useState(false); const [closeState, setCloseState] = useState<'open' | 'confirm' | 'closed'>('open');
  const updatePreferences = useCallback((patch: Partial<Preferences>) => setPreferences(current => ({ ...current, ...patch })), []);
  const notify = useCallback((title: string, message?: string, tone: ToastMessage['tone'] = 'default') => {
    const id = uid(); setToasts(current => [...current.slice(-3), { id, title, message, tone }]); setTimeout(() => setToasts(current => current.filter(item => item.id !== id)), 4800);
  }, []);
  const log = useCallback((action: string, detail: string, module: string, status: ActivityItem['status'] = 'done') => setActivity(current => [{ id: uid(), action, detail, module, status, time: Date.now() }, ...current].slice(0, 100)), []);
  const navigate = useCallback((module: ModuleId) => { setActive(module); setMobileOpen(false); }, []);
  const openOrbit = useCallback(() => {
    if (isTauri && !isNativeOrbitRoute) void openNativeOrbit().catch(error => notify('Orbit window could not open', error instanceof Error ? error.message : 'The native window was rejected.', 'danger'));
    else setOrbitOpen(true);
  }, [notify]);
  useEffect(() => { if (isNativeOrbitRoute) document.documentElement.classList.add('reformany-orbit-window'); if (isNativePanelRoute) document.documentElement.classList.add('reformany-panel-window'); }, []);
  useEffect(() => { localStorage.setItem('reformany.preferences', JSON.stringify(preferences)); const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches; const theme = preferences.theme === 'system' ? systemDark ? 'dark' : 'light' : preferences.theme; document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; setDestinationPreference(preferences.destination); }, [preferences]);
  useEffect(() => { localStorage.setItem('reformany.activity', JSON.stringify(activity)); }, [activity]);
  // Native listener configuration, not web-local fake settings. The Windows
  // listener is opt-in and persists independently of the window's WebView.
  useEffect(() => {
    if (!isTauri || isNativeOrbitRoute || isNativePanelRoute || isNativeFloatRoute) return;
    let live = true;
    void runNative<{ enabled: boolean; sensitivity: number }>('get_shake_settings', {})
      .then(saved => { if (live) updatePreferences({ holdShake: saved.enabled, shakeSensitivity: saved.sensitivity * 20 }); })
      .catch(error => { if (live) notify('Shake preferences unavailable', String(error), 'danger'); });
    return () => { live = false; };
  }, [notify, updatePreferences]);
  // The Orbit wheel runs in its own native process. Refresh shared settings
  // while it is open so hotkey tooltips and actual shortcuts update live.
  useEffect(() => {
    if (!isNativeOrbitRoute) return;
    let previous = localStorage.getItem('reformany.preferences');
    const refresh = () => {
      const next = localStorage.getItem('reformany.preferences');
      if (next && next !== previous) {
        previous = next;
        setPreferences(loadPreferences());
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'reformany.preferences') refresh();
    };
    window.addEventListener('storage', onStorage);
    const timer = window.setInterval(refresh, 250);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.clearInterval(timer);
    };
  }, []);

  // Portable EXE self-registers its per-user Explorer file/folder verbs
  // without a separate NSIS installer. Users may disable this in Appearance.
  useEffect(() => {
    if (!isTauri || isNativeOrbitRoute || isNativePanelRoute || isNativeFloatRoute) return;
    void runNative('set_portable_orbit_context', {
      enabled: preferences.portableOrbitContext,
    }).catch(error => notify('Explorer integration could not be updated', String(error), 'danger'));
  }, [preferences.portableOrbitContext, notify]);

  // Keep the main-window close behavior in sync with the native Windows tray.
  useEffect(() => {
    if (!isTauri || isNativeOrbitRoute || isNativePanelRoute || isNativeFloatRoute) return;
    void runNative('set_close_to_tray', { enabled: preferences.closeToTray })
      .catch(error => notify('Could not update tray behavior', String(error), 'danger'));
  }, [preferences.closeToTray, notify]);

  // Mirror separate Orbit process audio settings to the native playback engine.
  useEffect(() => {
    if (!isTauri || isNativeOrbitRoute || isNativePanelRoute || isNativeFloatRoute) return;
    void runNative('set_orbit_sound_preferences', {
      enabled: preferences.orbitSounds, volume: preferences.orbitVolume,
      openEnabled: preferences.orbitOpeningSound,
      closeEnabled: preferences.orbitClosingSound,
      hoverEnabled: preferences.orbitHoverSound,
    }).catch(error => notify('Could not save native Orbit audio', String(error), 'danger'));
  }, [preferences.orbitSounds, preferences.orbitVolume, preferences.orbitOpeningSound,
      preferences.orbitClosingSound, preferences.orbitHoverSound, notify]);

  useEffect(() => {
    const resize = () => setAutoCompact(window.innerWidth < 1100); resize(); window.addEventListener('resize', resize);
    const focus = () => setFocused(true), blur = () => setFocused(false); window.addEventListener('focus', focus); window.addEventListener('blur', blur);
    const full = () => setFullscreen(!!document.fullscreenElement); document.addEventListener('fullscreenchange', full);
    return () => { window.removeEventListener('resize', resize); window.removeEventListener('focus', focus); window.removeEventListener('blur', blur); document.removeEventListener('fullscreenchange', full); };
  }, []);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key === 'Alt') setAltDown(true);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPaletteOpen(current => !current); }
      if (event.ctrlKey && /^[0-5]$/.test(event.key)) { const modules: ModuleId[] = ['activity', 'images', 'media', 'media-tools', 'archives', 'documents']; event.preventDefault(); navigate(modules[Number(event.key)]); }
      if (event.key === 'F11') { event.preventDefault(); if (isTauri) void getCurrentWindow().setFullscreen(!fullscreen).then(() => setFullscreen(!fullscreen)); else if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen(); }
      if (event.key === 'Escape') { setPaletteOpen(false); if (closeState === 'confirm') setCloseState('open'); }
    };
    const up = (event: KeyboardEvent) => { if (event.key === 'Alt') setAltDown(false); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [closeState, navigate, fullscreen]);
  useEffect(() => { const handler = (event: Event) => notify('File operation', (event as CustomEvent<string>).detail, 'danger'); window.addEventListener('reformany:notice', handler); return () => window.removeEventListener('reformany:notice', handler); }, [notify]);
  const common = { preferences, updatePreferences, notify, log };
  if (isNativeFloatRoute) return <HoveRView />;
  if (isNativePanelRoute) return <OrbitPanelWindow />;
  if (isNativeOrbitRoute) return <>
    <OrbitHUD native preferences={preferences} onClose={() => void closeCurrentNativeWindow()} notify={notify} log={log} />
    <div className="toast-stack" aria-live="polite">{toasts.map(toast => <div className={`toast ${toast.tone || 'default'}`} key={toast.id}><div className="toast-icon">{toast.tone === 'danger' ? <X size={16} /> : <Check size={16} />}</div><div><strong>{toast.title}</strong>{toast.message && <p>{toast.message}</p>}</div><IconButton label="Dismiss notification" onClick={() => setToasts(current => current.filter(item => item.id !== toast.id))}><X size={14} /></IconButton></div>)}</div>
  </>;
  const module = (() => {
    switch (active) {
      case 'workspace': return <OverviewModule queue={queue} activity={activity} preferences={preferences} navigate={navigate} openOrbit={openOrbit} />;
      case 'images': return <ImagesModule {...common} queue={queue} setQueue={setQueue} />;
      case 'media': return <MediaModule {...common} />;
      case 'media-tools': return <MediaToolsModule {...common} />;
      case 'archives': return <ArchivesModule {...common} />;
      case 'documents': return <DocumentsModule {...common} />;
      case 'subtitles': return <SubtitlesModule {...common} />;
      case 'spreadsheets': return <SpreadsheetsModule {...common} />;
      case 'preview': return <PreviewModule {...common} />;
      case 'ebooks': return <EbooksModule {...common} />;
      case 'activity': return <ActivityModule items={activity} onClear={() => setActivity([])} navigate={navigate} />;
      case 'guide': return <GuideModule navigate={navigate} />;
      case 'appearance': return <AppearanceModule {...common} />;
      case 'files-jobs': return <FilesJobsModule {...common} />;
      case 'engines': return <EnginesModule {...common} />;
    }
  })();
  if (closeState === 'closed') return <div className="closed-desktop"><div className="closed-window"><Brand /><div className="closed-orbit"><Orbit size={36} /></div><h1>ReformANY is closed.</h1><p>Your preferences and local activity remain in this browser profile. No conversion is running.</p><KineticButton tone="primary" onClick={() => { setCloseState('open'); setMinimized(false); }}>Reopen ReformANY</KineticButton></div></div>;
  return <>
    <div className={minimized ? 'app-minimized' : ''}>
      <AppShell active={active} navigate={navigate} queueCount={queue.filter(item => item.status === 'queued' || item.status === 'working').length} activityCount={activity.length} collapsed={collapsed} onToggleCollapsed={() => setCollapsed(!collapsed)} mobileOpen={mobileOpen} onToggleMobile={() => setMobileOpen(!mobileOpen)} autoCompact={autoCompact} altDown={altDown} onCommand={() => setPaletteOpen(true)} onOrbit={openOrbit} maximized={maximized} onMaximize={() => { if (isTauri) void getCurrentWindow().isMaximized().then(async current => { if (current) await getCurrentWindow().unmaximize(); else await getCurrentWindow().maximize(); setMaximized(!current); }); else setMaximized(!maximized); }} onMinimize={() => { if (isTauri) void getCurrentWindow().minimize(); else setMinimized(true); }} onClose={() => {
        if (isTauri && preferences.closeToTray) void getCurrentWindow().close();
        else setCloseState('confirm');
      }} focused={focused} fullscreen={fullscreen}>{module}</AppShell>
    </div>
    {minimized && <button className="minimized-dock" onClick={() => setMinimized(false)}><Brand /><span>Restore window</span></button>}
    <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} navigate={navigate} onOrbit={openOrbit} onToggleCollapsed={() => setCollapsed(!collapsed)} onToggleTheme={() => updatePreferences({ theme: preferences.theme === 'dark' ? 'light' : 'dark' })} onClearQueue={() => { setQueue([]); notify('Image queue cleared', 'Source files were not modified.'); }} queueCount={queue.length} theme={preferences.theme} />
    {orbitOpen && <OrbitHUD preferences={preferences} onClose={() => setOrbitOpen(false)} notify={notify} log={log} />}
    {closeState === 'confirm' && <div className="dialog-backdrop close-confirm-backdrop"><section className="close-confirm"><IconButton label="Cancel close" onClick={() => setCloseState('open')}><X size={17} /></IconButton><ShieldCheck size={28} /><h2>Close ReformANY?</h2><p>Preferences and activity are saved. File objects in the active queue will be released; originals stay unchanged.</p><div><KineticButton tone="ghost" onClick={() => setCloseState('open')}>Keep working</KineticButton><KineticButton tone="primary" onClick={() => { if (isTauri) void getCurrentWindow().close(); else setCloseState('closed'); }}>Close ReformANY</KineticButton></div></section></div>}
    <div className="toast-stack" aria-live="polite">{toasts.map(toast => <div className={`toast ${toast.tone || 'default'}`} key={toast.id}><div className="toast-icon">{toast.tone === 'danger' ? <X size={16} /> : <Check size={16} />}</div><div><strong>{toast.title}</strong>{toast.message && <p>{toast.message}</p>}</div><IconButton label="Dismiss notification" onClick={() => setToasts(current => current.filter(item => item.id !== toast.id))}><X size={14} /></IconButton></div>)}</div>
  </>;
}
