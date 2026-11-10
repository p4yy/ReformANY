import { useMemo, useState } from 'react';
import { Archive, ArrowDownToLine, ArrowLeftRight, AudioLines, Check, ChevronDown, Combine, FileArchive, FileOutput, Film, FlipHorizontal2, FlipVertical2, FolderInput, Image as ImageIcon, Info, LoaderCircle, LockKeyhole, Music2, RotateCw, Scissors, Settings2, ShieldCheck, Video, Volume2, Wand2 } from 'lucide-react';
import type { ActivityItem, Preferences, QueueItem, ToastMessage } from '../types';
import { convertImage, createZip, downloadBlob, ext, extractZip, formatBytes, joinBinary, splitBinary, uid, type ImageSettings } from '../lib/files';
import { DropZone, Field, FileContextRow, FilePicker, InlineNote, KineticButton, NumberStepper, ProgressBar, QueueList, Segmented, Select, SpringSlider, Toggle } from '../components/UI';
import { native, hasOriginalBytes, nativeConvertImages, resolveNativeDestination, requireNativePath, runNative } from '../native/bridge';

export interface ConverterProps {
  preferences: Preferences;
  updatePreferences: (patch: Partial<Preferences>) => void;
  notify: (title: string, message?: string, tone?: ToastMessage['tone']) => void;
  log: (action: string, detail: string, module: string, status?: ActivityItem['status']) => void;
}

export function ModuleHeader({ eyebrow, title, description, aside }: { eyebrow: string; title: React.ReactNode; description: string; aside?: React.ReactNode }) {
  return <header className="module-header reveal-item"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{aside && <div className="module-header-aside">{aside}</div>}</header>;
}

export function FormatChips({ options, value, onChange }: { options: string[]; value: string; onChange: (value: string) => void }) {
  return <div className="format-selector">{options.map(option => <button type="button" key={option} onClick={() => onChange(option)} className={value === option ? 'active' : ''}>{option}<span /></button>)}</div>;
}

export function EngineLine({ name = 'FFmpeg + FFprobe', detail = 'Desktop engine required in this browser preview' }: { name?: string; detail?: string }) {
  return <div className="engine-line"><span className="status-dot warn" /><strong>{name}</strong><span>{detail}</span></div>;
}

function SourceFile({ file, onFile, accept, label = 'Choose source' }: { file: File | null; onFile: (file: File | null) => void; accept?: string; label?: string }) {
  return <div className="source-file">{file ? <><FileContextRow name={file.name} meta={`${ext(file.name).toUpperCase()} · ${formatBytes(file.size)}`} /><KineticButton tone="ghost" onClick={() => onFile(null)}>Change</KineticButton></> : <FilePicker multiple={false} accept={accept} onFiles={files => onFile(files[0] || null)} tone="default"><FolderInput size={16} />{label}</FilePicker>}</div>;
}

const imageInputs = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tiff', 'ico', 'tga', 'qoi', 'svg'];
const imageOutputs = ['webp', 'png', 'jpeg', 'bmp', 'ico', 'tga', 'qoi', 'avif', 'tiff', 'gif'];

export function ImagesModule({ preferences, updatePreferences, notify, log, queue, setQueue }: ConverterProps & { queue: QueueItem[]; setQueue: React.Dispatch<React.SetStateAction<QueueItem[]>> }) {
  const [settings, setSettings] = useState<ImageSettings>({ format: preferences.recentFormats.images || 'webp', quality: 86, background: 'Transparent', maxEdge: 0, rotate: 0, grayscale: false });
  const [fineTune, setFineTune] = useState(true);
  const [working, setWorking] = useState(false);
  const [destination, setDestination] = useState(preferences.destination);
  const special = queue.filter(item => ['gif', 'tiff'].includes(ext(item.name)));
  const addFiles = (files: File[]) => {
    const items = files.map(file => ({ id: uid(), file, name: file.name, size: file.size, kind: ext(file.name), status: 'queued' as const, progress: 0, previewUrl: hasOriginalBytes(file) && ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'ico'].includes(ext(file.name)) ? URL.createObjectURL(file) : undefined }));
    setQueue(current => [...current, ...items]);
    notify(`${items.length} ${items.length === 1 ? 'file' : 'files'} added`, 'Order the queue or fine-tune the output.', 'success');
  };
  const patch = (id: string, value: Partial<QueueItem>) => setQueue(current => current.map(item => item.id === id ? { ...item, ...value } : item));
  const run = async () => {
    const runnable = queue.filter(item => item.status !== 'done');
    if (!runnable.length) { notify('Your queue is empty', 'Add at least one image to begin.', 'danger'); return; }
    if (!settings.maxEdge || (settings.maxEdge >= 128 && settings.maxEdge <= 8192)) { setWorking(true); } else { notify('Maximum edge is too small', 'Use 0 for original size or 128–8192 pixels.', 'danger'); return; }
    if (native) {
      setWorking(true);
      try {
        const dest = await resolveNativeDestination(destination);
        const outcome = await nativeConvertImages(runnable.map(item => ({ id: item.id, path: requireNativePath(item.file) })), {
          target: settings.format, quality: settings.quality,
          matte: settings.background === '#11140E' ? 'black' : 'white',
          maxDimension: settings.maxEdge || undefined, rotation: settings.rotate,
          grayscale: settings.grayscale, destination: dest,
        }, event => patch(event.id, {
          status: event.status === 'completed' ? 'done' : event.status === 'failed' || event.status === 'cancelled' ? 'error' : 'working',
          progress: event.status === 'processing' ? 15 : event.status === 'completed' ? 100 : 0,
          output: event.outputPath || undefined,
          message: event.error || (event.outputPath ? `Saved to ${event.outputPath}` : undefined),
        }));
        updatePreferences({ recentFormats: { ...preferences.recentFormats, images: settings.format } });
        log('Images converted', `${outcome.completed} completed · ${outcome.failed} failed · ${settings.format.toUpperCase()}`, 'Images', outcome.failed ? 'info' : 'done');
        notify(outcome.failed ? 'Some images could not be converted' : 'Conversion complete', `${outcome.completed} files saved beside originals or to the chosen destination.`, outcome.failed ? 'default' : 'success');
      } catch (error) { notify('Native conversion failed', String(error), 'danger'); log('Image conversion stopped', String(error), 'Images', 'error'); }
      finally { setWorking(false); }
      return;
    }
    const outputs: File[] = []; let completed = 0; let failed = 0;
    const process = async (item: QueueItem) => {
      patch(item.id, { status: 'working', progress: 4, message: undefined });
      try {
        const result = await convertImage(item.file, settings, progress => patch(item.id, { progress }));
        outputs.push(new File([result.blob], result.name, { type: result.blob.type }));
        patch(item.id, { status: 'done', progress: 100, output: result.name, message: `${formatBytes(item.size)} → ${formatBytes(result.blob.size)}` });
        completed++;
      } catch (error) {
        patch(item.id, { status: 'error', progress: 0, message: error instanceof Error ? error.message : 'Conversion failed.' }); failed++;
      }
    };
    if (preferences.scheduling === 'sequential') for (const item of runnable) await process(item);
    else {
      const pools = [...runnable]; const workers = Array.from({ length: Math.min(3, pools.length) }, async () => { while (pools.length) await process(pools.shift()!); });
      await Promise.all(workers);
    }
    if (outputs.length === 1) await downloadBlob(outputs[0], outputs[0].name);
    if (outputs.length > 1) await downloadBlob(await createZip(outputs, 6), `reformany-images-${Date.now()}.zip`);
    setWorking(false); updatePreferences({ recentFormats: { ...preferences.recentFormats, images: settings.format } });
    log('Images converted', `${completed} completed · ${failed} needs attention · ${settings.format.toUpperCase()}`, 'Images', failed ? 'info' : 'done');
    notify(failed ? 'Conversion finished with notes' : 'Conversion complete', `${completed} output${completed === 1 ? '' : 's'} ready${outputs.length ? ' and downloaded' : ''}.`, failed ? 'default' : 'success');
  };
  return <div className="module images-module">
    <ModuleHeader eyebrow="Workspace / Images" title={<>A new shape<br />for every image.</>} description="Convert, resize and finish images without sending a pixel anywhere. Your queue stays on this device." aside={<div className="metric-block"><span>LOCAL QUEUE</span><strong>{String(queue.length).padStart(2, '0')}</strong><small>{queue.filter(item => item.status === 'done').length} outputs ready</small></div>} />
    <div className="images-bento reveal-item">
      <DropZone onFiles={addFiles} accept={imageInputs} formats={imageInputs.map(item => item.toUpperCase())} count={queue.length} />
      <section className="output-instrument panel">
        <div className="panel-kicker"><span>01</span> Output instrument</div>
        <Field label="Convert to"><FormatChips options={imageOutputs} value={settings.format} onChange={format => setSettings({ ...settings, format })} /></Field>
        <div className="quality-row"><div><span>JPEG / WebP quality</span><small>{settings.quality < 60 ? 'Smaller file' : settings.quality > 90 ? 'Near original' : 'Balanced'}</small></div><SpringSlider label="Image quality" value={settings.quality} onChange={quality => setSettings({ ...settings, quality })} /></div>
        <button type="button" className="fine-tune-toggle" onClick={() => setFineTune(!fineTune)} aria-expanded={fineTune}><Settings2 size={16} />Fine-tune output<ChevronDown size={16} /></button>
        {fineTune && <div className="fine-tune-body">
          <Field label="Destination"><Select value={destination} onChange={value => { setDestination(value); updatePreferences({ destination: value }); }} options={['Next to original', 'Desktop', 'Downloads', 'Choose folder']} /></Field>
          <Field label="Background"><Select value={settings.background} onChange={background => setSettings({ ...settings, background })} options={[{ value: 'Transparent', label: 'Transparent' }, { value: '#E1E6D9', label: 'Warm paper' }, { value: '#11140E', label: 'Deep olive' }, { value: '#F4F3EA', label: 'Warm white' }]} /></Field>
          <Field label="Resize max edge" hint="0 keeps original"><NumberStepper label="Maximum edge in pixels" value={settings.maxEdge} onChange={maxEdge => setSettings({ ...settings, maxEdge })} min={0} max={8192} unit="px" /></Field>
          <Field label="Rotation"><KineticButton onClick={() => setSettings({ ...settings, rotate: (settings.rotate + 90) % 360 })}><RotateCw size={16} />Clockwise · {settings.rotate}°</KineticButton></Field>
          <div className="check-setting"><div><strong>Grayscale</strong><small>Perceptual luminance</small></div><Toggle label="Grayscale" checked={settings.grayscale} onChange={grayscale => setSettings({ ...settings, grayscale })} /></div>
        </div>}
      </section>
    </div>
    {special.length > 0 && <InlineNote tone="warning"><strong>Animation & multipage notice.</strong> Browser encoding uses the first decodable frame. Animated GIF and multipage TIFF preservation requires the desktop image engine.</InlineNote>}
    <section className="queue-section reveal-item">
      <div className="section-heading"><div><span className="eyebrow">02 / Conversion queue</span><h2>{queue.length ? 'Ready when you are.' : 'Your work appears here.'}</h2></div>{queue.length > 0 && <KineticButton tone="ghost" onClick={() => setQueue([])}>Clear queue</KineticButton>}</div>
      <QueueList items={queue} onRemove={id => setQueue(current => current.filter(item => item.id !== id))} onReorder={(from, to) => setQueue(current => { const next = [...current]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); return next; })} />
      {!queue.length && <div className="queue-empty"><ImageIcon size={24} /><span>Drop a PNG, JPEG, WebP, TIFF, QOI or SVG above. Nothing uploads.</span></div>}
      <div className="run-bar"><div><ShieldCheck size={16} /><span><strong>Local processing</strong><small>{preferences.scheduling === 'balanced' ? 'Up to 3 concurrent workers' : 'One file at a time'} · {destination === 'Choose folder' ? 'Download prompted by browser' : destination}</small></span></div><KineticButton tone="primary" disabled={working || !queue.length} onClick={run} icon={working ? <LoaderCircle className="spin" size={17} /> : <ArrowLeftRight className="convert-icon" size={17} />}>{working ? 'Converting…' : `Convert ${queue.filter(item => item.status !== 'done').length || queue.length} ${queue.length === 1 ? 'file' : 'files'}`}</KineticButton></div>
    </section>
  </div>;
}

const videoOutputs = ['MP4', 'WEBM', 'MKV', 'MOV', 'AVI'];
const audioOutputs = ['MP3', 'M4A', 'WAV', 'FLAC', 'OGG', 'OPUS'];

export function MediaModule(props: ConverterProps) {
  const [file, setFile] = useState<File | null>(null);
  const [group, setGroup] = useState<'video' | 'audio'>('video');
  const [format, setFormat] = useState('MP4');
  const [quality, setQuality] = useState<'smaller' | 'balanced' | 'higher'>('balanced');
  const [start, setStart] = useState('00:00:00'); const [duration, setDuration] = useState(''); const [about, setAbout] = useState(false);
  const [busy, setBusy] = useState(false);
  const toSeconds = (value: string): number | null => {
    if (!value.trim()) return null;
    const parts = value.split(':').map(Number);
    if (parts.length !== 3 || parts.some(x => !Number.isFinite(x) || x < 0)) throw new Error('Enter times as HH:MM:SS.');
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  };
  const run = async () => {
    if (!file) { props.notify('Choose a media source', 'MP4, MOV, MKV, WebM and common audio files are accepted.', 'danger'); return; }
    if (!native) { props.notify('Desktop engine required', 'Run ReformANY as a Windows desktop app to encode media.', 'danger'); return; }
    setBusy(true);
    try {
      const output = await runNative<string>('media_convert', { job: {
        path: requireNativePath(file), target: format.toLowerCase(),
        destination: await resolveNativeDestination(props.preferences.destination),
        profile: quality === 'higher' ? 'high' : quality === 'smaller' ? 'small' : 'standard',
        startSeconds: toSeconds(start), durationSeconds: toSeconds(duration),
      } });
      props.log('Media converted', `${file.name} → ${output}`, 'Audio & Video');
      props.notify('Media export complete', `Saved: ${output}`, 'success');
    } catch (error) { props.log('Media conversion failed', String(error), 'Audio & Video', 'error'); props.notify('Media conversion failed', String(error), 'danger'); }
    finally { setBusy(false); }
  };
  return <div className="module"><ModuleHeader eyebrow="Workspace / Audio & Video" title={<>Cut. Tune.<br />Keep the motion.</>} description="A precise front end for FFmpeg, with deliberate trimming and readable quality choices." aside={<EngineLine />} />
    <div className="two-column-workbench reveal-item"><section className="panel media-source"><div className="panel-kicker"><span>01</span> Source</div><SourceFile file={file} onFile={setFile} accept="video/*,audio/*" label="Choose audio or video" />{file && <div className="media-file-visual">{file.type.startsWith('audio') ? <AudioLines size={40} /> : <Film size={40} />}<strong>{file.name}</strong><span>{formatBytes(file.size)}</span><div className="waveform">{Array.from({ length: 42 }, (_, i) => <i key={i} style={{ height: `${18 + (Math.sin(i * 1.7) + 1) * 20}%` }} />)}</div></div>}</section>
      <section className="panel"><div className="panel-kicker"><span>02</span> Delivery</div><Segmented value={group} onChange={value => { setGroup(value); setFormat(value === 'video' ? 'MP4' : 'MP3'); }} options={[{ value: 'video', label: 'Video' }, { value: 'audio', label: 'Audio' }]} label="Media output group" />
        <Field label="Convert to"><FormatChips options={group === 'video' ? videoOutputs : audioOutputs} value={format} onChange={setFormat} /></Field>
        <Field label="Quality"><Segmented value={quality} onChange={setQuality} options={[{ value: 'smaller', label: 'Smaller' }, { value: 'balanced', label: 'Balanced' }, { value: 'higher', label: 'Higher' }]} /></Field>
        <div className="field-grid"><Field label="Start time"><input className="text-input" value={start} onChange={event => setStart(event.target.value)} placeholder="00:00:00" /></Field><Field label="Duration" hint="optional"><input className="text-input" value={duration} onChange={event => setDuration(event.target.value)} placeholder="00:00:30" /></Field></div>
        <Field label="Destination"><Select value={props.preferences.destination} onChange={destination => props.updatePreferences({ destination })} options={['Next to original', 'Desktop', 'Downloads', 'Choose folder']} /></Field>
      </section></div>
    <button className="expandable-note" onClick={() => setAbout(!about)}><Info size={16} /><span>About progress and trimming</span><ChevronDown size={16} /></button>{about && <InlineNote>Progress is read from FFmpeg frame and time output in the desktop build. Start time uses accurate seek before encoding; duration is measured from that point. Browser preview does not invent a percentage when no encoder is present.</InlineNote>}
    <div className="run-bar"><EngineLine /><KineticButton tone="primary" onClick={() => void run()} disabled={busy}>{busy ? <LoaderCircle size={17} className="spin" /> : <ArrowLeftRight size={17} />}{busy ? "Encoding…" : "Convert media"}</KineticButton></div>
  </div>;
}

const mediaTools = [
  { id: 'compress-video', name: 'Compress video', icon: Video, detail: 'H.264 · CRF 28', accept: 'video/*', output: 'MP4' },
  { id: 'compress-audio', name: 'Compress audio', icon: Music2, detail: 'Bitrate 128 kb/s', accept: 'audio/*', output: 'MP3' },
  { id: 'normalize', name: 'Normalize loudness', icon: Volume2, detail: 'EBU R128 · −16 LUFS', accept: 'audio/*', output: 'WAV' },
  { id: 'merge-audio', name: 'Merge audio', icon: Combine, detail: '2–12 sources', accept: 'audio/*', output: 'MP3' },
  { id: 'merge-video', name: 'Merge video', icon: Film, detail: 'Scale to 720p', accept: 'video/*', output: 'MP4' },
  { id: 'rotate', name: 'Rotate 90°', icon: RotateCw, detail: 'Clockwise transform', accept: 'video/*', output: 'MP4' },
  { id: 'flip-h', name: 'Flip horizontal', icon: FlipHorizontal2, detail: 'Mirror on X axis', accept: 'video/*', output: 'MP4' },
  { id: 'flip-v', name: 'Flip vertical', icon: FlipVertical2, detail: 'Mirror on Y axis', accept: 'video/*', output: 'MP4' },
  { id: 'metadata', name: 'Remove metadata', icon: Wand2, detail: 'Clean container tags', accept: 'video/*,audio/*', output: 'Same format' },
];

export function MediaToolsModule(props: ConverterProps) {
  const [sources, setSources] = useState<Record<string, File[]>>({});
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const apply = async (id: string, name: string) => {
    const files = sources[id] || []; const minimum = id.startsWith('merge') ? 2 : 1;
    if (files.length < minimum) { props.notify(`${name} needs ${minimum === 2 ? '2–12 sources' : 'a source'}`, 'Choose files directly on this tool card.', 'danger'); return; }
    if (!native) { props.notify('Native FFmpeg required', 'Install the Windows application to run media tools.', 'danger'); return; }
    const actions: Record<string, string> = { normalize: 'normalize-audio', rotate: 'rotate-video', 'flip-h': 'flip-video', 'flip-v': 'flip-vertical', metadata: 'strip-metadata' };
    setBusy(id);
    try {
      const output = await runNative<string>('media_edit', { job: { paths: files.map(requireNativePath), action: actions[id] || id,
        destination: await resolveNativeDestination(destinations[id] || props.preferences.destination) } });
      props.log(name, `${files.length} source(s) → ${output}`, 'Media Tools');
      props.notify(`${name} complete`, `Saved: ${output}`, 'success');
    } catch (error) { props.log(`${name} failed`, String(error), 'Media Tools', 'error'); props.notify(`${name} failed`, String(error), 'danger'); }
    finally { setBusy(null); }
  };
  return <div className="module"><ModuleHeader eyebrow="Workspace / Media Tools" title={<>Nine tools.<br />One quiet workbench.</>} description="Focused FFmpeg operations with explicit inputs and predictable output names." aside={<EngineLine />} />
    <div className="tools-bento">{mediaTools.map((tool, index) => { const Icon = tool.icon; const files = sources[tool.id] || []; return <section className="tool-card panel reveal-item" key={tool.id} style={{ '--i': index } as React.CSSProperties}><div className="tool-card-top"><div className="tool-icon"><Icon size={22} /></div><span>{String(index + 1).padStart(2, '0')}</span></div><h3>{tool.name}</h3><p>{tool.detail}</p><FileContextRow name={files.length ? files.length === 1 ? files[0].name : `${files.length} sources selected` : 'No source selected'} meta={files.length ? formatBytes(files.reduce((sum, file) => sum + file.size, 0)) : tool.output} /><div className="tool-card-controls"><FilePicker accept={tool.accept} multiple={tool.id.startsWith('merge')} onFiles={selected => setSources(current => ({ ...current, [tool.id]: tool.id.startsWith('merge') ? selected.slice(0, 12) : selected.slice(0, 1) }))}><FolderInput size={15} />Source</FilePicker><Select value={destinations[tool.id] || props.preferences.destination} onChange={destination => setDestinations(current => ({ ...current, [tool.id]: destination }))} options={['Next to original', 'Desktop', 'Downloads']} /></div><KineticButton tone="primary" disabled={busy !== null} onClick={() => void apply(tool.id, tool.name)}>{busy === tool.id ? "Processing…" : "Apply"} <ArrowDownToLine size={15} /></KineticButton></section>; })}</div>
  </div>;
}

type ArchiveTab = 'create' | 'extract' | 'split' | 'join';
export function ArchivesModule(props: ConverterProps) {
  const [tab, setTab] = useState<ArchiveTab>('create');
  const [files, setFiles] = useState<File[]>([]); const [archive, setArchive] = useState<File | null>(null);
  const [manifest, setManifest] = useState<File | null>(null); const [parts, setParts] = useState<File[]>([]);
  const [name, setName] = useState('reformany-archive'); const [format, setFormat] = useState('ZIP'); const [level, setLevel] = useState(6);
  const [volumeMb, setVolumeMb] = useState(0); const [partMb, setPartMb] = useState(100); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(0);
  const resetSources = () => { setFiles([]); setArchive(null); setManifest(null); setParts([]); setProgress(0); };
  const execute = async () => {
    setBusy(true); setProgress(15);
    try {
      if (native) {
        const destination = await resolveNativeDestination(props.preferences.destination);
        let output = '';
        if (tab === 'create') {
          if (!files.length) throw new Error('Add at least one source.');
          const result = await runNative<{ outputPaths: string[] }>('archive_create', { job: {
            paths: files.map(requireNativePath), destination, name,
            format: format.toLowerCase(), level,
            password: password || null, splitMegabytes: volumeMb || null,
          } });
          output = result.outputPaths.join(' · ');
        } else if (tab === 'extract') {
          if (!archive) throw new Error('Choose an archive first.');
          output = await runNative<string>('archive_extract', { job: { path: requireNativePath(archive), destination, password: password || null } });
        } else if (tab === 'split') {
          if (!archive) throw new Error('Choose a file to split.');
          const result = await runNative<{ manifestPath: string; parts: string[] }>('file_split', { path: requireNativePath(archive), destination, partMegabytes: partMb });
          output = `${result.parts.length} parts · ${result.manifestPath}`;
        } else {
          if (!manifest) throw new Error('Choose the parts manifest.');
          output = await runNative<string>('file_join', { manifestPath: requireNativePath(manifest), destination });
        }
        setProgress(100);
        props.log('Archive operation completed', output, 'Archives');
        props.notify('Archive operation complete', `Saved: ${output}`, 'success');
        setBusy(false);
        return;
      }
      if (tab === 'create') {
        if (!files.length) throw new Error('Add files or a folder first.');
        if (format !== 'ZIP') throw new Error(`${format} creation requires the desktop 7-Zip engine. No output was created.`);
        if (password) throw new Error('AES-256 encrypted ZIP creation requires desktop 7-Zip. Clear the password for a standard local ZIP.');
        const zip = await createZip(files, level); setProgress(65);
        if (volumeMb > 0) {
          const splitFile = new File([zip], `${name}.zip`); const result = await splitBinary(splitFile, volumeMb);
          for (const part of result.parts) await downloadBlob(part.blob, part.name); await downloadBlob(result.manifest, result.manifestName);
        } else await downloadBlob(zip, `${name}.zip`);
        props.log('Archive created', `${files.length} sources · ZIP · level ${level}${volumeMb ? ` · ${volumeMb} MB volumes` : ''}`, 'Archives');
      } else if (tab === 'extract') {
        if (!archive) throw new Error('Choose an archive first.');
        if (password) throw new Error('Password-protected archive extraction requires the desktop engine.');
        if (ext(archive.name) !== 'zip') throw new Error('Browser extraction supports ZIP. Use the desktop app for 7Z, RAR and TAR.');
        const entries = await extractZip(archive); for (const entry of entries) await downloadBlob(entry.blob, entry.name.split('/').pop() || entry.name);
        props.log('Archive extracted', `${entries.length} files from ${archive.name}`, 'Archives');
      } else if (tab === 'split') {
        if (!archive) throw new Error('Choose a file to split.');
        const result = await splitBinary(archive, partMb); setProgress(70);
        for (const part of result.parts) await downloadBlob(part.blob, part.name); await downloadBlob(result.manifest, result.manifestName);
        props.log('Binary file split', `${result.parts.length} parts · SHA-256 manifest`, 'Archives');
      } else {
        if (!manifest || !parts.length) throw new Error('Choose the .reformany.parts.json manifest and every numbered part.');
        const result = await joinBinary(manifest, parts); await downloadBlob(result.blob, result.name);
        props.log('Binary file joined', `${result.name} · SHA-256 verified`, 'Archives');
      }
      setProgress(100); props.notify('Archive operation complete', 'Output was generated locally and downloaded.', 'success');
    } catch (error) { setProgress(0); props.notify('Archive operation stopped', error instanceof Error ? error.message : 'Unknown error', 'danger'); props.log('Archive operation stopped', error instanceof Error ? error.message : 'Unknown error', 'Archives', 'error'); }
    setBusy(false);
  };
  const tabDescription = useMemo(() => ({ create: 'Build a clean archive from mixed sources.', extract: 'Unpack an archive into individual downloads.', split: 'Divide any binary into verifiable parts.', join: 'Reassemble and authenticate every byte.' }[tab]), [tab]);
  return <div className="module"><ModuleHeader eyebrow="Workspace / Archives" title={<>Pack small.<br />Prove every byte.</>} description={tabDescription} aside={<div className="engine-line"><span className="status-dot ready" /><strong>ZIP + SHA-256</strong><span>Browser engine ready</span></div>} />
    <div className="module-tabs">{(['create', 'extract', 'split', 'join'] as ArchiveTab[]).map(item => <button className={tab === item ? 'active' : ''} key={item} onClick={() => { setTab(item); resetSources(); }}>{item === 'create' ? <Archive size={16} /> : item === 'extract' ? <FileOutput size={16} /> : item === 'split' ? <Scissors size={16} /> : <Combine size={16} />}{item[0].toUpperCase() + item.slice(1)}</button>)}</div>
    <section className="panel archive-workbench reveal-item" key={tab}>
      {tab === 'create' && <><div className="archive-primary"><Field label="Files or folder"><FilePicker onFiles={setFiles}><FolderInput size={16} />Add files</FilePicker></Field><FilePicker directory onFiles={setFiles}><FolderInput size={16} />Add folder</FilePicker><Field label="Archive name"><input className="text-input" value={name} onChange={event => setName(event.target.value.replace(/[\\/:*?"<>|]/g, '-'))} /></Field></div>{files.length > 0 && <div className="compact-file-list">{files.map(file => <FileContextRow key={`${file.name}-${file.size}`} name={(file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name} meta={formatBytes(file.size)} />)}</div>}<div className="field-grid three"><Field label="Format"><Select value={format} onChange={setFormat} options={['ZIP', '7Z', 'TAR']} /></Field><Field label={`Compression · ${level}`}><SpringSlider value={level} onChange={setLevel} min={0} max={9} unit="" /></Field><Field label="Split volumes" hint="0 = off"><NumberStepper label="Volume size" value={volumeMb} onChange={setVolumeMb} min={0} max={4096} unit="MB" /></Field></div><Field label="AES-256 password" hint="desktop 7-Zip"><div className="input-with-icon"><LockKeyhole size={16} /><input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Optional encryption password" /></div></Field></>}
      {tab === 'extract' && <><SourceFile file={archive} onFile={setArchive} accept=".zip,.7z,.rar,.tar" label="Choose archive" /><Field label="Password" hint="if protected"><div className="input-with-icon"><LockKeyhole size={16} /><input type="password" value={password} onChange={event => setPassword(event.target.value)} /></div></Field></>}
      {tab === 'split' && <><SourceFile file={archive} onFile={setArchive} label="Choose any file" /><Field label="Part size"><NumberStepper label="Part size" value={partMb} onChange={setPartMb} min={1} max={4096} unit="MB" /></Field><InlineNote>Outputs are numbered .001, .002 and so on. A .reformany.parts.json manifest records the original size, order and SHA-256 digest.</InlineNote></>}
      {tab === 'join' && <><SourceFile file={manifest} onFile={setManifest} accept=".json" label="Choose parts manifest" /><Field label="Numbered parts"><FilePicker multiple onFiles={setParts}><FileArchive size={16} />{parts.length ? `${parts.length} parts selected` : 'Add .001, .002…'}</FilePicker></Field><InlineNote><ShieldCheck size={15} />The joined output downloads only after its size and SHA-256 hash match the manifest.</InlineNote></>}
      <Field label="Destination"><Select value={props.preferences.destination} onChange={destination => props.updatePreferences({ destination })} options={['Next to original', 'Desktop', 'Downloads', 'Choose folder']} /></Field>
      {busy && <ProgressBar value={progress} label="Processing local bytes" />}<div className="panel-footer"><span>{tab === 'join' ? 'SHA-256 verification on' : 'Original sources remain unchanged'}</span><KineticButton tone="primary" disabled={busy} onClick={execute}>{busy ? <LoaderCircle className="spin" size={16} /> : tab === 'create' ? <Archive size={16} /> : tab === 'extract' ? <FileOutput size={16} /> : tab === 'split' ? <Scissors size={16} /> : <Check size={16} />}{busy ? 'Working…' : tab === 'create' ? 'Create archive' : tab === 'extract' ? 'Extract archive' : tab === 'split' ? 'Split file' : 'Verify & join'}</KineticButton></div>
    </section>
  </div>;
}
