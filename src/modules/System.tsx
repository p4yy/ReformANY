import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { native, runNative, nativeEngineStatus } from '../native/bridge';
import { Activity, ArrowRight, BookOpenCheck, Check, ChevronRight, Clock3, Download, ExternalLink, FileArchive, FileCog, FileInput, FileText, FolderClock, FolderInput, Gauge, HardDrive, Image, Info, Keyboard, Mouse, MousePointer2, MoveHorizontal, Music2, Orbit, Palette, Plus, RefreshCw, RotateCcw, Settings2, ShieldCheck, Trash2, Volume2, X } from 'lucide-react';
import type { ActivityItem, ModuleId, Preferences } from '../types';
import type { ConverterProps } from './Converters';
import { ModuleHeader } from './Converters';
import { CopyButton, EmptyState, Field, IconButton, InlineNote, KineticButton, Segmented, Select, SettingRow, SpringSlider, Toggle } from '../components/UI';
import { playOrbitCue } from '../orbit/sounds';

export function ActivityModule({ items, onClear, navigate }: { items: ActivityItem[]; onClear: () => void; navigate: (module: ModuleId) => void }) {
  const [filter, setFilter] = useState('all');
  const visible = items.filter(item => filter === 'all' || item.status === filter);
  return <div className="module"><ModuleHeader eyebrow="Workspace / Activity" title={<>A local record.<br />Nothing more.</>} description="Recent operations live in this browser profile. Clearing history never touches your files." aside={items.length ? <KineticButton tone="ghost" onClick={onClear}><Trash2 size={15} />Clear history</KineticButton> : undefined} />
    {items.length > 0 && <div className="activity-filter"><Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: `All · ${items.length}` }, { value: 'done', label: 'Completed' }, { value: 'info', label: 'Prepared' }, { value: 'error', label: 'Stopped' }]} /></div>}
    {!items.length ? <EmptyState icon={<Activity size={32} />} title="The workbench is quiet." description="Conversions, exports and stopped jobs will appear here with their actual outcomes." action={<KineticButton tone="primary" onClick={() => navigate('images')}><Image size={16} />Open workspace</KineticButton>} /> : <div className="activity-feed">{visible.map((item, index) => <article key={item.id} className="activity-item reveal-item" style={{ '--i': index } as React.CSSProperties}><div className={`activity-marker ${item.status}`}>{item.status === 'done' ? <Check size={16} /> : item.status === 'error' ? <X size={16} /> : <Clock3 size={16} />}</div><div><span>{item.module}</span><h3>{item.action}</h3><p>{item.detail}</p></div><time>{new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(item.time)}<small>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(item.time)}</small></time></article>)}{!visible.length && <EmptyState icon={<Clock3 size={28} />} title="No entries in this view" description="Choose another activity filter to see your local history." />}</div>}
  </div>;
}

const guideSteps = [
  { title: 'Choose a converter', icon: FileCog, module: 'images' as ModuleId, summary: 'Start with the shape of your source, not the extension you want.', detail: 'Images handles pixel formats and resizing. Audio & Video and Media Tools configure FFmpeg. Archives covers containers and binary parts. Documents, Subtitles, Spreadsheets and E-books keep their format-specific limits visible. Press Ctrl+K and type a module name to jump directly.' },
  { title: 'Add files', icon: FileInput, module: 'images' as ModuleId, summary: 'Drop, browse, or bring an entire folder.', detail: 'Drop files on the breathing workbench, use Add files, or choose Add folder. Image queue cards can be dragged to reorder them; arrow buttons provide the same control without a pointer. Rejected types shake the workbench and never enter the queue.' },
  { title: 'Set output', icon: Settings2, module: 'images' as ModuleId, summary: 'Make the trade-offs explicit before you run.', detail: 'Choose a format, destination and quality. Image maximum edge 0 preserves dimensions. Rotation accumulates in 90° steps. ReformANY remembers your most recently used image format in local preferences.' },
  { title: 'Run and inspect', icon: Gauge, module: 'activity' as ModuleId, summary: 'Real progress, real outcomes, no mystery percentages.', detail: 'Image progress follows decode, transform and encode stages. Multi-file output is bundled into a ZIP. Sequential scheduling uses one worker; Balanced uses up to three. If an external engine is missing, the job stops with a clear explanation instead of a fabricated success.' },
  { title: 'Summon Orbit', icon: Orbit, module: 'appearance' as ModuleId, summary: 'Hold and shake a file over Explorer or the desktop.', detail: 'Orbit is a separate transparent always-on-top window in the Tauri build. Scroll to change sections, or use Shift for Convert, Ctrl for Tools and Alt for Actions. Esc collapses it. Use Open Orbit in the top bar to explore the exact overlay in this web preview.' },
  { title: 'Make a password ZIP', icon: FileArchive, module: 'archives' as ModuleId, summary: 'Encryption is a desktop 7-Zip operation.', detail: 'In Archives → Create, add sources, choose ZIP and enter an AES-256 password. The browser engine creates standard ZIPs but deliberately stops encrypted jobs; the desktop backend hands these to 7-Zip. Split volumes produce numbered parts and a SHA-256 manifest.' },
  { title: 'Edit PDF structure', icon: FileText, module: 'documents' as ModuleId, summary: 'Split, arrange, rotate and watermark new copies.', detail: 'Documents → Split PDF supports approximate MB, part count and pages per file. Orbit → Tools on a PDF opens Arrange Pages and Watermark. Both write new PDFs and leave the source unchanged. Text extraction needs a text layer; scanned pages need separate OCR.' },
  { title: 'Troubleshoot engines', icon: HardDrive, module: 'engines' as ModuleId, summary: 'Detect first. Install only what you need.', detail: 'Preferences → Engines separates ready local browser tools from external desktop dependencies. Copy the Calibre or LibreOffice install command, install it yourself, then Refresh status. FFmpeg, FFprobe and 7-Zip must be visible on PATH or configured in the desktop backend.' },
];

export function GuideModule({ navigate }: { navigate: (module: ModuleId) => void }) {
  const [open, setOpen] = useState(0);
  return <div className="module guide-module"><ModuleHeader eyebrow="Workspace / Field Guide" title={<>Eight moves.<br />Total control.</>} description="A practical manual for the workbench, Orbit and external engines." aside={<div className="guide-shortcut"><Keyboard size={20} /><span>Quick nav</span><kbd>Ctrl K</kbd></div>} /><div className="guide-list">{guideSteps.map((step, index) => { const Icon = step.icon; const expanded = open === index; return <article key={step.title} className={`guide-step ${expanded ? 'open' : ''}`}><button onClick={() => setOpen(expanded ? -1 : index)} aria-expanded={expanded}><span className="guide-number">{String(index + 1).padStart(2, '0')}</span><Icon size={20} /><div><h2>{step.title}</h2><p>{step.summary}</p></div><ChevronRight size={18} /></button>{expanded && <div className="guide-detail"><p>{step.detail}</p><KineticButton tone="ghost" onClick={() => navigate(step.module)}>Open related module<ArrowRight size={15} /></KineticButton></div>}</article>; })}</div></div>;
}


export function AppearanceModule({ preferences, updatePreferences }: ConverterProps) {
  const [intro, setIntro] = useState(false); const [introPage, setIntroPage] = useState(0);
  const [realVolume, setRealVolume] = useState(preferences.orbitVolume);
  const [portableMode, setPortableMode] = useState(false);
  useEffect(() => {
    if (!native) return;
    let live = true;
    void runNative<boolean>('portable_context_supported', {})
      .then(supported => { if (live) setPortableMode(supported); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!native) return;
    let live = true;
    void runNative<number>('get_system_volume', {})
      .then(level => { if (live) setRealVolume(level); })
      .catch(error => window.dispatchEvent(new CustomEvent('reformany:notice', {
        detail: 'Windows audio device unavailable: ' + String(error),
      })));
    return () => { live = false; };
  }, []);
  const changeVolume = (level: number) => {
    setRealVolume(level);
    // Preserve the independently working Orbit cue-volume setting.
    updatePreferences({ orbitVolume: level });
    if (native) void runNative<number>('set_system_volume', { level })
      .then(actual => setRealVolume(actual))
      .catch(error => window.dispatchEvent(new CustomEvent('reformany:notice', {
        detail: 'Windows master volume could not be changed: ' + String(error),
      })));
  };
  const setModifier = (key: keyof Preferences['orbitModifiers'], value: string) => {
    const mapping = { ...preferences.orbitModifiers };
    const collision = (Object.keys(mapping) as Array<keyof typeof mapping>)
      .find(item => item !== key && mapping[item] === value);
    if (collision) mapping[collision] = mapping[key];
    mapping[key] = value;
    updatePreferences({ orbitModifiers: mapping });
  };
  const shakeWrite = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (shakeWrite.current) clearTimeout(shakeWrite.current); }, []);
  const updateShake = (enabled: boolean) => {
    if (!native) { updatePreferences({ holdShake: enabled }); return; }
    if (shakeWrite.current) { clearTimeout(shakeWrite.current); shakeWrite.current = null; }
    void runNative<{enabled: boolean; sensitivity: number}>('set_shake_settings', {
      enabled, sensitivity: Math.max(1, Math.min(5, Math.round(preferences.shakeSensitivity / 20))),
    }).then(actual => updatePreferences({ holdShake: actual.enabled, shakeSensitivity: actual.sensitivity * 20 }))
      .catch(error => window.dispatchEvent(new CustomEvent('reformany:notice', { detail: 'Could not change the native Shake listener: ' + String(error) })));
  };
  const updateShakeSensitivity = (value: number) => {
    updatePreferences({ shakeSensitivity: value });
    if (!native) return;
    if (shakeWrite.current) clearTimeout(shakeWrite.current);
    shakeWrite.current = setTimeout(() => {
      shakeWrite.current = null;
      void runNative('set_shake_settings', {
        enabled: preferences.holdShake, sensitivity: Math.max(1, Math.min(5, Math.round(value / 20))),
      }).catch(error => window.dispatchEvent(new CustomEvent('reformany:notice', { detail: 'Shake sensitivity was not saved: ' + String(error) })));
    }, 350);
  };

  return <div className="module preferences-module"><ModuleHeader eyebrow="Preferences / Settings" title={<>Tune the<br />instrument.</>} description="The interface, mouse behavior, Orbit, and desktop preferences in one place. Changes are saved locally." />
    <div className="preference-layout"><div className="preference-main">
      <section id="settings-interface" className="preference-section reveal-item"><div className="preference-title"><Palette size={20} /><div><h2>Interface</h2><p>Warm surfaces, readable type, no remote themes.</p></div></div><SettingRow title="Theme" description="Dark Graphite is ReformANY’s olive graphite, not blue-black."><Segmented value={preferences.theme} onChange={theme => updatePreferences({ theme })} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark Graphite' }]} /></SettingRow><SettingRow title="Language" description="English is the only currently supported interface language."><span className="setting-language-current">English</span></SettingRow><SettingRow title="Accent" description="Calibrated for text contrast on olive surfaces."><div className="accent-official"><span /><strong>Sage · Official</strong><Check size={15} /></div></SettingRow><SettingRow title="Close to Tray" description="The main window hides instead of quitting. Restore it from the Windows tray; use Quit in its menu to exit."><Toggle label="Close to tray" checked={preferences.closeToTray} onChange={closeToTray => updatePreferences({ closeToTray })} /></SettingRow>{portableMode && <SettingRow title="Explorer right-click Orbit" description="Register file and folder shortcuts for this portable EXE in your Windows user profile. No administrator access or installer needed."><Toggle label="Explorer right-click Orbit" checked={preferences.portableOrbitContext} onChange={portableOrbitContext => updatePreferences({ portableOrbitContext })} /></SettingRow>}</section>
      <section id="settings-sounds" className="preference-section reveal-item"><div className="preference-title"><Orbit size={20} /><div><h2>Orbit sound</h2><p>Soft opening, closing and hover cues designed for Orbit.</p></div></div><SettingRow title="Orbit sounds"><Toggle label="Orbit sounds" checked={preferences.orbitSounds} onChange={orbitSounds => updatePreferences({ orbitSounds })} /></SettingRow><SettingRow title="Opening sound" description="Subtle rising chime when Orbit appears."><Toggle label="Orbit opening sound" checked={preferences.orbitOpeningSound} onChange={orbitOpeningSound => updatePreferences({ orbitOpeningSound })} /></SettingRow><SettingRow title="Closing sound" description="Short, warm descending tone when Orbit closes."><Toggle label="Orbit closing sound" checked={preferences.orbitClosingSound} onChange={orbitClosingSound => updatePreferences({ orbitClosingSound })} /></SettingRow><SettingRow title="Wedge hover sound" description="Quiet tactile feedback when moving between formats."><Toggle label="Orbit wedge hover sound" checked={preferences.orbitHoverSound} onChange={orbitHoverSound => updatePreferences({ orbitHoverSound })} /></SettingRow><SettingRow title="Windows output volume" description={native ? `${realVolume}% · controls the real default audio endpoint` : "Requires the Windows desktop application"}><div className="slider-with-test"><SpringSlider label="Windows output volume" value={realVolume} onChange={changeVolume} disabled={!native} /><KineticButton tone="ghost" onClick={() => playOrbitCue(preferences, 'open')}><Volume2 size={15} />Test</KineticButton></div></SettingRow></section>
      <section id="settings-mouse" className="preference-section reveal-item"><div className="preference-title"><MousePointer2 size={20} /><div><h2>Orbit mouse control</h2><p>Modifier mappings apply to the floating overlay immediately.</p></div></div><SettingRow title="Starting section"><Select value={preferences.orbitStart} onChange={value => updatePreferences({ orbitStart: value as Preferences['orbitStart'] })} options={[{ value: 'convert', label: 'Convert' }, { value: 'tools', label: 'Tools' }, { value: 'actions', label: 'Actions' }]} /></SettingRow><SettingRow title="Scroll to change section" description="Wheel down moves Convert → Tools → Actions."><Toggle label="Scroll to change Orbit section" checked={preferences.orbitScroll} onChange={orbitScroll => updatePreferences({ orbitScroll })} /></SettingRow><div className="modifier-grid">{(['convert', 'tools', 'actions'] as const).map(section => <Field label={section[0].toUpperCase() + section.slice(1)} key={section}><Select value={preferences.orbitModifiers[section]} onChange={value => setModifier(section, value)} options={['Shift', 'Ctrl', 'Alt', 'Alt+X', 'Alt+T', 'Alt+A', 'Ctrl+Shift+X', 'Ctrl+Shift+T', 'Ctrl+Shift+A']} /></Field>)}<KineticButton tone="ghost" onClick={() => updatePreferences({ orbitModifiers: { convert: 'Shift', tools: 'Ctrl', actions: 'Alt' } })}><RotateCcw size={14} />Reset</KineticButton></div><SettingRow title="Hold-and-shake to open" description="Uses the existing native Explorer gesture listener. Enabled by default; disable at any time."><div className="shake-toggle-control"><MoveHorizontal size={16} aria-hidden="true" /><Mouse size={17} aria-hidden="true" /><Toggle label="Hold and shake" checked={preferences.holdShake} onChange={updateShake} /></div></SettingRow><SettingRow title="Shake sensitivity" description={preferences.shakeSensitivity > 70 ? 'Light movement' : preferences.shakeSensitivity < 35 ? 'Deliberate movement' : 'Balanced movement'}><SpringSlider label="Shake sensitivity" value={preferences.shakeSensitivity} onChange={updateShakeSensitivity} /></SettingRow><SettingRow title="Pointer loading ring" description="Shows asynchronous wedge operations around the pointer."><Toggle label="Pointer loading ring" checked={preferences.pointerRing} onChange={pointerRing => updatePreferences({ pointerRing })} /></SettingRow></section>
      <section className="preference-section"><SettingRow title="Show introduction" description="Replay the three-part orientation at any time."><KineticButton onClick={() => { setIntro(true); setIntroPage(0); }}><BookOpenCheck size={16} />Show introduction</KineticButton></SettingRow><InlineNote><ShieldCheck size={15} /><strong>Privacy by architecture.</strong> Preferences and history stay in local storage. Conversion engines run on this device. The web preview performs no uploads and includes no analytics.</InlineNote></section>
    </div><aside className="preference-aside"><div className="orbit-mini-diagram"><span /><span /><span /><Orbit size={32} /></div><h3>Precision, not play.</h3><p>Orbit opens without bounce. Wedges fan in clockwise, labels remain upright, and every angle is recalculated from its ring’s item count.</p><div className="aside-meta"><span>Disc<strong>520 px</strong></span><span>Small screens<strong>420 px</strong></span><span>Motion<strong>200 ms</strong></span></div></aside></div>
    {intro && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setIntro(false); }}><section className="intro-dialog"><IconButton label="Close introduction" onClick={() => setIntro(false)}><X size={18} /></IconButton><span className="eyebrow">INTRODUCTION · {introPage + 1} / 3</span>{introPage === 0 ? <><Orbit size={36} /><h2>Files stay files.<br />Not uploads.</h2><p>ReformANY is a local workbench. Choose a converter, add your sources and inspect every output option before anything runs.</p></> : introPage === 1 ? <><MousePointer2 size={36} /><h2>Your next action,<br />arranged in a circle.</h2><p>Open Orbit directly from Explorer, then choose a format or tool. Scroll Orbit to move between Convert, Tools and Actions, or hold its section modifier.</p></> : <><HardDrive size={36} /><h2>Only the engines<br />you choose.</h2><p>Image, PDF, ZIP and data tools work locally in this preview. FFmpeg, Calibre and LibreOffice remain explicit desktop dependencies.</p></>}<div className="intro-footer"><div>{[0, 1, 2].map(index => <button aria-label={`Introduction page ${index + 1}`} className={introPage === index ? 'active' : ''} key={index} onClick={() => setIntroPage(index)} />)}</div><KineticButton tone="primary" onClick={() => introPage === 2 ? (setIntro(false), updatePreferences({ showIntroduction: false })) : setIntroPage(introPage + 1)}>{introPage === 2 ? 'Enter workspace' : 'Continue'}<ArrowRight size={16} /></KineticButton></div></section></div>}
  </div>;
}

type NativeWatchRule = {
  id: string;
  folder: string;
  inputExt: string;
  target: string;
  destination: string | null;
};
type NativeWatchEvent = {
  id: string;
  path: string;
  status: 'processing' | 'completed' | 'failed';
  outputPath: string | null;
  error: string | null;
};

export function FilesJobsModule({ preferences, updatePreferences, notify }: ConverterProps) {
  const [folder, setFolder] = useState('');
  const [incoming, setIncoming] = useState('PNG');
  const [output, setOutput] = useState('WEBP');
  const [rules, setRules] = useState<NativeWatchRule[]>([]);
  const [loading, setLoading] = useState(native);
  const [busy, setBusy] = useState(false);
  const inputs = ['PNG', 'JPG', 'JPEG', 'WEBP', 'BMP', 'TIFF'];
  const formats = ['PDF', 'PNG', 'JPEG', 'WEBP', 'BMP', 'TIFF'];
  const supportedOutputs = formats.filter(format =>
    (format === 'JPEG' ? 'JPG' : format) !== (incoming === 'JPEG' ? 'JPG' : incoming)
  );
  useEffect(() => {
    if (!native) return;
    let alive = true;
    void Promise.all([
      runNative<NativeWatchRule[]>('get_watch_rules', {}),
      runNative<{ mode: 'balanced' | 'sequential' }>('get_queue_policy', {}),
    ]).then(([nativeRules, queuePolicy]) => {
      if (!alive) return;
      setRules(nativeRules);
      updatePreferences({ scheduling: queuePolicy.mode });
    }).catch(error => {
      if (alive) notify('Native preferences unavailable', String(error), 'danger');
    }).finally(() => { if (alive) setLoading(false); });
    let dispose: (() => void) | null = null;
    void listen<NativeWatchEvent>('reformany:watch-job', event => {
      if (!alive) return;
      const job = event.payload;
      if (job.status === 'completed' && job.outputPath) {
        notify('Auto Convert complete', job.outputPath, 'success');
      } else if (job.status === 'failed') {
        notify('Auto Convert failed', job.error || job.path, 'danger');
      }
    }).then(unlisten => { if (alive) dispose = unlisten; else unlisten(); })
      .catch(error => { if (alive) notify('Watcher events unavailable', String(error), 'danger'); });
    return () => { alive = false; dispose?.(); };
  }, [updatePreferences, notify]);

  const setSchedule = async (mode: Preferences['scheduling']) => {
    if (!native) { updatePreferences({ scheduling: mode }); return; }
    try {
      const saved = await runNative<{ mode: Preferences['scheduling'] }>('set_queue_policy', { mode });
      updatePreferences({ scheduling: saved.mode });
    } catch (error) { notify('Queue scheduling was not saved', String(error), 'danger'); }
  };
  const chooseSource = async () => {
    if (!native) { notify('Desktop required', 'Watched folders require ReformANY for Windows.', 'default'); return; }
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === 'string') setFolder(selected);
    } catch (error) { notify('Folder selection failed', String(error), 'danger'); }
  };
  const addRule = async () => {
    if (!native) { notify('Desktop required', 'A native Windows watcher is required; no rule has been created.', 'danger'); return; }
    if (!folder) { notify('Select a folder', 'Choose an existing local folder to monitor.', 'danger'); return; }
    if (busy || loading) return;
    setBusy(true);
    try {
      const nativeRules = await runNative<NativeWatchRule[]>('add_watch_rule', {
        folder,
        inputExt: incoming.toLowerCase(),
        target: output.toLowerCase(),
        destination: null,
      });
      setRules(nativeRules);
      setFolder('');
      notify('Auto Convert activated', incoming + ' → ' + output + ' · ' + folder, 'success');
    } catch (error) { notify('Could not start watched folder', String(error), 'danger'); }
    finally { setBusy(false); }
  };
  const removeRule = async (rule: NativeWatchRule) => {
    if (!native || busy) return;
    setBusy(true);
    try {
      const remaining = await runNative<NativeWatchRule[]>('remove_watch_rule', { id: rule.id });
      setRules(remaining);
      notify('Folder monitoring stopped', rule.folder, 'success');
    } catch (error) { notify('Could not stop watched folder', String(error), 'danger'); }
    finally { setBusy(false); }
  };
  return <div className="module preferences-module">
    <ModuleHeader eyebrow="Preferences / Files & Jobs" title={<>Set the flow.<br />Keep the receipts.</>} description="Real output locations, native worker scheduling, and automatic local image conversions." />
    <section className="preference-section">
      <div className="preference-title"><FolderInput size={20} /><div><h2>Output destination</h2><p>Choose where newly converted files are saved.</p></div></div>
      <SettingRow title="Save converted files to" description="Choose folder opens the native folder picker when an export runs.">
        <Select value={preferences.destination} onChange={destination => updatePreferences({ destination })}
          options={['Next to original', 'Desktop', 'Downloads', 'Choose folder']} />
      </SettingRow>
    </section>
    <section className="preference-section">
      <div className="preference-title"><Gauge size={20} /><div><h2>Batch scheduling</h2><p>Shared with the native conversion engine and Orbit.</p></div></div>
      <SettingRow title="Worker strategy" description={preferences.scheduling === 'balanced' ? 'Balanced: parallel jobs where supported.' : 'Sequential: process jobs in order.'}>
        <Segmented value={preferences.scheduling} onChange={value => { void setSchedule(value as Preferences['scheduling']); }}
          options={[{ value: 'sequential', label: 'Sequential' }, { value: 'balanced', label: 'Balanced' }]} />
      </SettingRow>
    </section>
    <section className="preference-section">
      <div className="preference-title"><FolderClock size={20} /><div><h2>Auto Convert watched folders</h2><p>Real Windows folder watches. Files stay local; outputs never overwrite the source.</p></div></div>
      <div className="watch-builder">
        <Field label="Watched folder"><div className="folder-rule-input">
          {folder ? <span title={folder}>{folder}</span> : <span>No folder selected</span>}
          <KineticButton onClick={() => { void chooseSource(); }}><FolderInput size={15} />Pick folder</KineticButton>
        </div></Field>
        <Field label="Incoming image type">
          <Select value={incoming} onChange={value => {
            setIncoming(value);
            const next = formats.filter(format => (format === 'JPEG' ? 'JPG' : format) !== (value === 'JPEG' ? 'JPG' : value));
            if (!next.includes(output)) setOutput(next[0]);
          }} options={inputs} />
        </Field>
        <Field label="Convert to"><Select value={output} onChange={setOutput} options={supportedOutputs} /></Field>
        <KineticButton tone="primary" disabled={busy || loading || !native || !folder}
          onClick={() => { void addRule(); }}><Plus size={16} />{busy ? 'Working…' : 'Start watching'}</KineticButton>
      </div>
      <div className="watch-rules">
        {rules.map(rule => <div className="watch-rule" key={rule.id}>
          <div className="watch-rule-icon"><FolderClock size={18} /></div>
          <div><strong title={rule.folder}>{rule.folder}</strong><span>{rule.inputExt.toUpperCase()} <ArrowRight size={13} /> {rule.target.toUpperCase()}</span></div>
          <span className="desktop-service-label">Active native watch</span>
          <IconButton label={'Stop watching ' + rule.folder} onClick={() => { void removeRule(rule); }}><Trash2 size={16} /></IconButton>
        </div>)}
        {loading && <div className="rules-empty"><FolderClock size={24}/><span>Loading native folder watches…</span></div>}
        {!loading && !rules.length && <div className="rules-empty"><FolderClock size={24}/><span>No active folder watches. Choose a local folder and format to start the native service.</span></div>}
      </div>
      <InlineNote>Auto Convert supports PNG, JPG, JPEG, WebP, BMP, and TIFF inputs. PDFs and images can be outputs. Files are processed after they finish writing. Removing a watch stops future conversions.</InlineNote>
    </section>
  </div>;
}

type EngineState = { name: string; description: string; status: 'ready' | 'missing' | 'optional'; detail: string; icon: typeof Image; command?: string };
export function EnginesModule(props: ConverterProps) {
  const [checking, setChecking] = useState(false); const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({});
  const detected = (key: string) => capabilities[key] === true || capabilities[key.toLowerCase()] === true;
  const refresh = async () => { setChecking(true); try { if (!native) throw new Error('Desktop capabilities are unavailable in this browser.'); const result = await nativeEngineStatus(); result.calibre = await runNative<boolean>('ebook_engine_available', {}); result.libreoffice = await runNative<boolean>('office_available', {}); setCapabilities(result); setCheckedAt(Date.now()); props.notify('Engine status refreshed', 'Detected actual local executables. No installation changes were made.', 'success'); } catch(error) { props.notify('Engine check failed', String(error), 'danger'); } finally { setChecking(false); } };
  useEffect(() => { if (native) void refresh(); }, []);
  const engines: EngineState[] = [
    { name: 'Image / PDF tools', description: 'Canvas, binary encoders, PDF-lib and PDF.js', status: 'ready', detail: 'Ready · local processing engines', icon: Image },
    { name: 'FFmpeg + FFprobe', description: 'Media conversion, trimming and all nine media tools', status: detected('ffmpeg') && detected('ffprobe') ? 'ready' : 'missing', detail: detected('ffmpeg') && detected('ffprobe') ? 'Both engines detected and executable' : 'FFmpeg: ' + (detected('ffmpeg') ? 'ready' : 'missing') + ' · FFprobe: ' + (detected('ffprobe') ? 'ready' : 'missing'), icon: Music2 },
    { name: '7-Zip', description: '7Z, TAR, RAR and AES-256 archive operations', status: detected('sevenZip') ? 'ready' : 'missing', detail: detected('sevenZip') ? 'Ready · reported by desktop bridge' : 'Not detected · standard ZIP still ready', icon: FileArchive },
    { name: 'WinRAR', description: 'Optional RAR compatibility on Windows', status: detected('winrar') ? 'ready' : 'optional', detail: detected('winrar') ? 'Ready · optional engine' : 'Optional · not detected', icon: FileArchive },
    { name: 'Calibre', description: 'ebook-convert for EPUB library normalization', status: detected('calibre') ? 'ready' : 'missing', detail: detected('calibre') ? 'Ready · ebook-convert found' : 'Not detected · optional install', icon: BookOpenCheck, command: 'winget install calibre.calibre' },
    { name: 'LibreOffice', description: 'Headless Office document rendering to PDF', status: detected('libreoffice') ? 'ready' : 'missing', detail: detected('libreoffice') ? 'Ready · soffice found' : 'Not detected · optional install', icon: FileText, command: 'winget install TheDocumentFoundation.LibreOffice' },
  ];
  const updates = async () => { try { if (!native) throw new Error('Open the installed desktop app to manage updates.'); await runNative('open_manual_updates', {}); props.notify('Update page opened', 'The release page is ready for manual verification.', 'success'); } catch(error) { props.notify('Update action failed', String(error), 'danger'); } };
  return <div className="module preferences-module"><ModuleHeader eyebrow="Preferences / Engines" title={<>Know what<br />powers the work.</>} description="Capability status is reported, never guessed. External tools remain independently installed." aside={<KineticButton onClick={refresh} disabled={checking}><RefreshCw size={16} className={checking ? 'spin' : ''} />{checking ? 'Checking…' : 'Refresh status'}</KineticButton>} />
    <div className="engine-grid">{engines.map((engine, index) => { const Icon = engine.icon; return <article className="engine-card reveal-item" key={engine.name} style={{ '--i': index } as React.CSSProperties}><div className="engine-card-head"><div className="engine-icon"><Icon size={21} /></div><span className={`status-dot ${engine.status === 'ready' ? 'ready' : 'warn'}`} /></div><h3>{engine.name}</h3><p>{engine.description}</p><div className={`engine-status ${engine.status}`}><strong>{engine.status === 'ready' ? 'Ready' : engine.status === 'optional' ? 'Optional' : 'Not detected'}</strong><span>{engine.detail}</span></div>{engine.command && <div className="install-command"><code>{engine.command}</code><CopyButton value={engine.command} label="Copy install command" /></div>}</article>; })}</div>
    <div className="updates-row"><div><Download size={20} /><span><strong>Application updates</strong><small>{checkedAt ? `Last capability check ${new Date(checkedAt).toLocaleTimeString()}` : 'Signed update checks use the desktop release channel.'}</small></span></div><KineticButton onClick={() => void updates()}>Check for updates<ExternalLink size={15} /></KineticButton></div><InlineNote><Info size={15} />ReformANY's original Windows installer includes an optional, verified offline FFmpeg and FFprobe component. Calibre and LibreOffice remain separate optional installs. The current status is verified by executing detected binaries.</InlineNote>
  </div>;
}
